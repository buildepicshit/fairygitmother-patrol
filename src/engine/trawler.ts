import { eq } from "drizzle-orm";
import type { PatrolConfig } from "../config.js";
import type { PatrolDb } from "../store/db.js";
import { tasks, trawlState } from "../store/schema.js";
import { generateId } from "./tracker.js";

interface GitHubIssue {
	number: number;
	title: string;
	body: string | null;
	labels: Array<{ name: string }>;
}

/**
 * Trawl a repo's issue tracker and create patrol tasks for matching issues.
 * Only picks up issues newer than the last trawl.
 */
export async function trawlRepo(
	db: PatrolDb,
	owner: string,
	repo: string,
	config: PatrolConfig,
	githubToken: string,
): Promise<number> {
	const repoKey = `${owner}/${repo}`;
	const bugTrawlConfig = config.patrols.bug_trawl;
	if (!bugTrawlConfig.enabled) return 0;

	// Get last trawl state
	const state = await db.select().from(trawlState).where(eq(trawlState.repo, repoKey)).limit(1);
	const sinceNumber = state.length > 0 ? state[0].lastIssueNumber : 0;

	// Fetch open issues from GitHub
	const issues = await fetchIssues(owner, repo, githubToken, bugTrawlConfig.labels);

	let created = 0;
	let maxIssueNumber = sinceNumber;

	for (const issue of issues) {
		if (issue.number <= sinceNumber) continue;
		if (issue.number > maxIssueNumber) maxIssueNumber = issue.number;

		const now = new Date().toISOString();
		await db.insert(tasks).values({
			id: generateId("tsk"),
			repo: repoKey,
			type: "bug_trawl",
			status: "queued",
			priority: 50,
			title: issue.title,
			description: issue.body || "",
			issueNumber: issue.number,
			labels: JSON.stringify(issue.labels.map((l) => l.name)),
			createdAt: now,
			updatedAt: now,
		});
		created++;
	}

	// Update trawl state
	const now = new Date().toISOString();
	if (state.length > 0) {
		await db
			.update(trawlState)
			.set({ lastTrawledAt: now, lastIssueNumber: maxIssueNumber })
			.where(eq(trawlState.repo, repoKey));
	} else {
		await db.insert(trawlState).values({
			repo: repoKey,
			lastTrawledAt: now,
			lastIssueNumber: maxIssueNumber,
		});
	}

	return created;
}

/**
 * Fetch open issues from GitHub, optionally filtered by labels.
 */
async function fetchIssues(
	owner: string,
	repo: string,
	token: string,
	labels?: string[],
): Promise<GitHubIssue[]> {
	const params = new URLSearchParams({
		state: "open",
		sort: "created",
		direction: "asc",
		per_page: "50",
	});
	if (labels && labels.length > 0) {
		params.set("labels", labels.join(","));
	}

	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?${params}`, {
		headers: {
			Accept: "application/vnd.github.v3+json",
			Authorization: `Bearer ${token}`,
			"User-Agent": "FairygitMother-Patrol",
		},
		signal: AbortSignal.timeout(10000),
	});

	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as Array<GitHubIssue & { pull_request?: unknown }>;
	// Filter out pull requests (GitHub returns them in the issues endpoint)
	return data.filter((issue) => !issue.pull_request);
}
