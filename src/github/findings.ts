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
		signal: AbortSignal.timeout(10000),
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
		signal: AbortSignal.timeout(5000),
	});

	if (checkRes.status === 404) {
		const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
			method: "POST",
			headers,
			signal: AbortSignal.timeout(5000),
			body: JSON.stringify({
				name: "patrol",
				color: "2ecc71",
				description: "Created by FairygitMother Patrol — automated codebase guardian",
			}),
		});
		// Non-fatal: if label creation fails (permissions, etc.), issue creation
		// will still work — the labels just won't be applied.
		if (!createRes.ok) {
			process.stderr.write(`[patrol] Warning: failed to create 'patrol' label: ${createRes.status}\n`);
		}
	}
}
