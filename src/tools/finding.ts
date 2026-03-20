import type { PatrolConfig } from "../config.js";
import { resolveToken } from "../config.js";
import { createFinding } from "../github/findings.js";
import { parseRepo } from "../github/issues.js";
import type { PatrolDb } from "../store/db.js";

export async function handleFinding(
	_db: PatrolDb,
	config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const repo = args.repo as string;
	const title = args.title as string;
	const body = args.body as string;
	const agentId = args.agentId as string;
	const taskType = (args.taskType as string) || "code_drift";
	const severity = (args.severity as "info" | "warning" | "critical") || "warning";

	if (!repo || !title || !body || !agentId) {
		return {
			content: [{ type: "text", text: "Error: repo, title, body, and agentId are required." }],
		};
	}

	try {
		const { owner, repo: repoName } = parseRepo(repo);
		const result = await createFinding(owner, repoName, { title, body, taskType, agentId, severity }, config);

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						status: "created",
						issueUrl: result.url,
						issueNumber: result.number,
						message: `Finding reported as issue #${result.number}: ${result.url}`,
					}),
				},
			],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { content: [{ type: "text", text: `Error creating finding: ${message}` }] };
	}
}
