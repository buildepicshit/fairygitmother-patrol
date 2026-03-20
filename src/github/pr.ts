import { type PatrolConfig, resolveToken } from "../config.js";

interface PrResult {
	url: string;
	number: number;
}

/**
 * Create a PR for an approved patrol task.
 *
 * NOTE: Full diff-to-commit via Git Trees/Blobs API is not yet implemented.
 * This function will throw until that's built. The approved task stays in
 * "approved" status and the diff is preserved for manual application.
 */
export async function createPullRequest(
	_owner: string,
	_repo: string,
	_opts: {
		title: string;
		body: string;
		branch: string;
		diff: string;
		baseBranch?: string;
	},
	_config: PatrolConfig,
): Promise<PrResult> {
	// TODO: Implement diff-to-commit via GitHub Git Trees/Blobs API.
	// See MoltForge's submitter.ts for reference implementation:
	//   1. Get base tree SHA from HEAD
	//   2. Parse unified diff into per-file changes
	//   3. For each file: fetch original, apply patch, create blob
	//   4. Create tree from base tree + new blobs
	//   5. Create commit referencing new tree
	//   6. Create branch pointing to commit
	//   7. Open PR
	throw new Error(
		"PR auto-creation not yet implemented — diff-to-commit via Git Trees/Blobs API is pending. " +
			"The approved task and diff are preserved. Apply the diff manually or wait for this feature.",
	);
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
