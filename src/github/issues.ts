import type { PatrolConfig } from "../config.js";
import { resolveToken } from "../config.js";

export interface RepoIssue {
	number: number;
	title: string;
	body: string | null;
	labels: string[];
	state: string;
}

/**
 * Check if a GitHub issue is still open.
 */
export async function isIssueOpen(
	owner: string,
	repo: string,
	issueNumber: number,
	config: PatrolConfig,
): Promise<boolean> {
	const token = resolveToken(config.github.token);

	try {
		const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
			headers: {
				Accept: "application/vnd.github.v3+json",
				Authorization: `Bearer ${token}`,
				"User-Agent": "FairygitMother-Patrol",
			},
			signal: AbortSignal.timeout(5000),
		});

		if (!res.ok) return true; // Fail-open
		const data = (await res.json()) as { state: string };
		return data.state === "open";
	} catch {
		return true; // Fail-open on network errors
	}
}

/**
 * Parse "owner/repo" into components.
 */
export function parseRepo(repoStr: string): { owner: string; repo: string } {
	const [owner, repo] = repoStr.split("/");
	if (!owner || !repo) throw new Error(`Invalid repo format: ${repoStr}. Expected "owner/repo".`);
	return { owner, repo };
}
