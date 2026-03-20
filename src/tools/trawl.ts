import type { PatrolConfig } from "../config.js";
import { resolveToken } from "../config.js";
import { trawlRepo } from "../engine/trawler.js";
import { parseRepo } from "../github/issues.js";
import type { PatrolDb } from "../store/db.js";

export async function handleTrawl(
	db: PatrolDb,
	config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const repoArg = args.repo as string | undefined;

	let token: string;
	try {
		token = resolveToken(config.github.token);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { content: [{ type: "text", text: `Error: ${message}` }] };
	}

	// Trawl specific repo or all configured repos
	let repos: Array<{ owner: string; repo: string }>;
	if (repoArg) {
		try {
			const parsed = parseRepo(repoArg);
			repos = [parsed];
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { content: [{ type: "text", text: `Error: ${message}` }] };
		}
	} else {
		repos = config.repos;
	}

	if (repos.length === 0) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						status: "no_repos",
						message: "No repos configured. Use patrol_configure to add repos, or pass a repo argument.",
					}),
				},
			],
		};
	}

	const results: Array<{ repo: string; issuesFound: number }> = [];

	for (const r of repos) {
		const count = await trawlRepo(db, r.owner, r.repo, config, token);
		results.push({ repo: `${r.owner}/${r.repo}`, issuesFound: count });
	}

	const totalFound = results.reduce((sum, r) => sum + r.issuesFound, 0);

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					status: "trawled",
					totalIssuesFound: totalFound,
					repos: results,
					message:
						totalFound > 0
							? `Found ${totalFound} new issue(s) across ${results.length} repo(s). Tasks queued.`
							: "No new issues found.",
				}),
			},
		],
	};
}
