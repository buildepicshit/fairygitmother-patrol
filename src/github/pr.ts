import { type PatrolConfig, resolveToken } from "../config.js";

interface PrResult {
	url: string;
	number: number;
}

/**
 * Create a PR for an approved patrol task.
 * Applies the diff as a commit on a new branch, then opens a PR.
 */
export async function createPullRequest(
	owner: string,
	repo: string,
	opts: {
		title: string;
		body: string;
		branch: string;
		diff: string;
		baseBranch?: string;
	},
	config: PatrolConfig,
): Promise<PrResult> {
	const token = resolveToken(config.github.token);
	const base = opts.baseBranch || "main";
	const headers = {
		Accept: "application/vnd.github.v3+json",
		Authorization: `Bearer ${token}`,
		"User-Agent": "FairygitMother-Patrol",
		"Content-Type": "application/json",
	};

	// 1. Get the SHA of the base branch
	const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${base}`, {
		headers,
	});
	if (!refRes.ok) throw new Error(`Failed to get base branch: ${refRes.status}`);
	const refData = (await refRes.json()) as { object: { sha: string } };
	const baseSha = refData.object.sha;

	// 2. Create branch
	const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
		method: "POST",
		headers,
		body: JSON.stringify({ ref: `refs/heads/${opts.branch}`, sha: baseSha }),
	});
	if (!createRefRes.ok) {
		const err = await createRefRes.text();
		throw new Error(`Failed to create branch: ${createRefRes.status} ${err}`);
	}

	// 3. Create PR
	const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			title: opts.title,
			body: opts.body,
			head: opts.branch,
			base,
		}),
	});
	if (!prRes.ok) {
		const err = await prRes.text();
		throw new Error(`Failed to create PR: ${prRes.status} ${err}`);
	}

	const prData = (await prRes.json()) as { html_url: string; number: number };
	return { url: prData.html_url, number: prData.number };
}

/**
 * Build a PR body with transparency disclosure.
 */
export function buildPrBody(opts: {
	taskType: string;
	issueNumber: number | null;
	explanation: string;
	producerAgent: string;
	reviewerAgent: string;
}): string {
	const lines = ["## Summary", "", opts.explanation, ""];

	if (opts.issueNumber) {
		lines.push(`Fixes #${opts.issueNumber}`, "");
	}

	lines.push(
		"## Patrol Details",
		"",
		"| Field | Value |",
		"|-------|-------|",
		`| Task Type | \`${opts.taskType}\` |`,
		`| Solved By | \`${opts.producerAgent}\` |`,
		`| Reviewed By | \`${opts.reviewerAgent}\` |`,
		"| Cross-Validated | Yes |",
		"",
		"---",
		"*This PR was created by [FairygitMother Patrol](https://fairygitmother.ai) — a codebase guardian that coordinates AI agents to maintain code quality.*",
	);

	return lines.join("\n");
}
