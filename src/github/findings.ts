import { type PatrolConfig, resolveToken } from "../config.js";

interface FindingResult {
	url: string;
	number: number;
}

/**
 * Create a GitHub Issue for a patrol finding that doesn't have an auto-fix.
 * Tagged with "patrol" label so the user can filter/track them.
 */
export async function createFinding(
	owner: string,
	repo: string,
	opts: {
		title: string;
		body: string;
		taskType: string;
		agentId: string;
		severity: "info" | "warning" | "critical";
	},
	config: PatrolConfig,
): Promise<FindingResult> {
	const token = resolveToken(config.github.token);
	const headers = {
		Accept: "application/vnd.github.v3+json",
		Authorization: `Bearer ${token}`,
		"User-Agent": "FairygitMother-Patrol",
		"Content-Type": "application/json",
	};

	// Ensure "patrol" label exists
	await ensureLabel(owner, repo, token);

	const labels = ["patrol", `patrol:${opts.taskType}`];
	if (opts.severity === "critical") labels.push("priority:critical");

	const body = [
		opts.body,
		"",
		"---",
		"",
		"| Field | Value |",
		"|-------|-------|",
		`| Patrol Type | \`${opts.taskType}\` |`,
		`| Found By | \`${opts.agentId}\` |`,
		`| Severity | \`${opts.severity}\` |`,
		"",
		"*This issue was created by [FairygitMother Patrol](https://fairygitmother.ai) — a codebase guardian that monitors code quality.*",
	].join("\n");

	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			title: `[Patrol] ${opts.title}`,
			body,
			labels,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Failed to create issue: ${res.status} ${err}`);
	}

	const data = (await res.json()) as { html_url: string; number: number };
	return { url: data.html_url, number: data.number };
}

/**
 * Ensure the "patrol" label exists on the repo.
 */
async function ensureLabel(owner: string, repo: string, token: string): Promise<void> {
	const headers = {
		Accept: "application/vnd.github.v3+json",
		Authorization: `Bearer ${token}`,
		"User-Agent": "FairygitMother-Patrol",
		"Content-Type": "application/json",
	};

	const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels/patrol`, {
		headers,
	});

	if (checkRes.status === 404) {
		await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				name: "patrol",
				color: "2ecc71",
				description: "Created by FairygitMother Patrol — automated codebase guardian",
			}),
		});
	}
}
