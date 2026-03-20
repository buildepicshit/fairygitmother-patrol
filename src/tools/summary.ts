import { and, desc, eq, gte } from "drizzle-orm";
import type { PatrolConfig } from "../config.js";
import { resolveToken } from "../config.js";
import type { PatrolDb } from "../store/db.js";
import { agents, tasks } from "../store/schema.js";

/**
 * Parse a human-readable duration string into milliseconds.
 * Supports: "24 hours", "7 days", "1 hour", "30 minutes", "2 days"
 */
function parseSinceDuration(since: string): number {
	const match = since.match(/^(\d+)\s*(hour|hours|day|days|minute|minutes|min|mins|h|d|m)$/i);
	if (!match) return 24 * 60 * 60 * 1000; // default 24 hours

	const value = Number.parseInt(match[1], 10);
	const unit = match[2].toLowerCase();

	if (unit.startsWith("h")) return value * 60 * 60 * 1000;
	if (unit.startsWith("d")) return value * 24 * 60 * 60 * 1000;
	if (unit.startsWith("m")) return value * 60 * 1000;
	return 24 * 60 * 60 * 1000;
}

export async function handleSummary(
	db: PatrolDb,
	config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const since = (args.since as string) || "24 hours";
	const sinceMs = parseSinceDuration(since);
	const sinceDate = new Date(Date.now() - sinceMs).toISOString();

	// Gather stats from local DB — filtered by time window
	const allTasks = await db
		.select()
		.from(tasks)
		.where(gte(tasks.updatedAt, sinceDate))
		.orderBy(desc(tasks.updatedAt))
		.limit(100);
	const agentList = await db.select().from(agents);

	// Categorize
	const prsCreated = allTasks.filter((t) => t.status === "pr_created");
	const approved = allTasks.filter((t) => t.status === "approved");
	const inReview = allTasks.filter((t) => t.status === "review_pending" || t.status === "review_assigned");
	const queued = allTasks.filter((t) => t.status === "queued");
	const rejected = allTasks.filter((t) => t.reviewDecision === "rejected");
	const assigned = allTasks.filter((t) => t.status === "assigned");

	// Fetch open patrol issues from GitHub for each configured repo
	const patrolIssues: Array<{ repo: string; title: string; url: string; number: number }> = [];

	for (const repo of config.repos) {
		try {
			const token = resolveToken(config.github.token);
			const res = await fetch(
				`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues?labels=patrol&state=open&per_page=20`,
				{
					headers: {
						Accept: "application/vnd.github.v3+json",
						Authorization: `Bearer ${token}`,
						"User-Agent": "FairygitMother-Patrol",
					},
					signal: AbortSignal.timeout(5000),
				},
			);
			if (res.ok) {
				const issues = (await res.json()) as Array<{
					title: string;
					html_url: string;
					number: number;
				}>;
				for (const issue of issues) {
					patrolIssues.push({
						repo: `${repo.owner}/${repo.repo}`,
						title: issue.title,
						url: issue.html_url,
						number: issue.number,
					});
				}
			}
		} catch {
			// Skip repos that fail — don't block the summary
		}
	}

	// Fetch open patrol PRs from GitHub
	const patrolPrs: Array<{ repo: string; title: string; url: string; number: number; state: string }> = [];

	for (const repo of config.repos) {
		try {
			const token = resolveToken(config.github.token);
			const res = await fetch(
				`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls?state=open&per_page=20`,
				{
					headers: {
						Accept: "application/vnd.github.v3+json",
						Authorization: `Bearer ${token}`,
						"User-Agent": "FairygitMother-Patrol",
					},
					signal: AbortSignal.timeout(5000),
				},
			);
			if (res.ok) {
				const prs = (await res.json()) as Array<{
					title: string;
					html_url: string;
					number: number;
					head: { ref: string };
				}>;
				// Filter to patrol PRs by branch prefix
				for (const pr of prs) {
					if (pr.head.ref.startsWith(config.pr.branchPrefix)) {
						patrolPrs.push({
							repo: `${repo.owner}/${repo.repo}`,
							title: pr.title,
							url: pr.html_url,
							number: pr.number,
							state: "open",
						});
					}
				}
			}
		} catch {
			// Skip repos that fail
		}
	}

	const summary = {
		overview: {
			totalTasks: allTasks.length,
			queued: queued.length,
			inProgress: assigned.length,
			awaitingReview: inReview.length,
			approved: approved.length,
			prsCreated: prsCreated.length,
			rejected: rejected.length,
		},
		proposedPrs: patrolPrs.map((pr) => ({
			repo: pr.repo,
			title: pr.title,
			url: pr.url,
		})),
		openFindings: patrolIssues.map((i) => ({
			repo: i.repo,
			title: i.title,
			url: i.url,
		})),
		recentActivity: allTasks.slice(0, 10).map((t) => ({
			id: t.id,
			repo: t.repo,
			type: t.type,
			title: t.title,
			status: t.status,
			solvedBy: t.producerAgentId,
			reviewedBy: t.reviewerAgentId,
			reviewDecision: t.reviewDecision,
			prUrl: t.prUrl,
			updatedAt: t.updatedAt,
		})),
		agents: agentList.map((a) => ({
			id: a.id,
			model: a.model,
			tasksCompleted: a.tasksCompleted,
			reviewsCompleted: a.reviewsCompleted,
			lastSeen: a.lastSeen,
		})),
	};

	// Format as readable text
	const lines: string[] = [];
	lines.push("# FairygitMother Patrol Summary\n");

	lines.push(
		`## Queue: ${queued.length} queued, ${assigned.length} in progress, ${inReview.length} awaiting review\n`,
	);

	if (patrolPrs.length > 0) {
		lines.push("## Proposed PRs\n");
		for (const pr of patrolPrs) {
			lines.push(`- **${pr.repo}**: [${pr.title}](${pr.url})`);
		}
		lines.push("");
	} else {
		lines.push("## Proposed PRs\n\nNone currently open.\n");
	}

	if (patrolIssues.length > 0) {
		lines.push("## Open Findings\n");
		for (const issue of patrolIssues) {
			lines.push(`- **${issue.repo}**: [${issue.title}](${issue.url})`);
		}
		lines.push("");
	} else {
		lines.push("## Open Findings\n\nNo open findings.\n");
	}

	if (agentList.length > 0) {
		lines.push("## Agents\n");
		for (const a of agentList) {
			lines.push(
				`- **${a.id}** (${a.model || "unknown model"}): ${a.tasksCompleted} tasks, ${a.reviewsCompleted} reviews`,
			);
		}
		lines.push("");
	}

	return { content: [{ type: "text", text: lines.join("\n") }] };
}
