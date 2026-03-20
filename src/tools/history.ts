import type { PatrolConfig } from "../config.js";
import { getHistory } from "../engine/tracker.js";
import type { PatrolDb } from "../store/db.js";

export async function handleHistory(
	db: PatrolDb,
	_config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const entries = await getHistory(db, {
		repo: args.repo as string | undefined,
		type: args.type as string | undefined,
		limit: (args.limit as number) || 50,
	});

	const formatted = entries.map((t) => ({
		id: t.id,
		repo: t.repo,
		type: t.type,
		status: t.status,
		title: t.title,
		issueNumber: t.issueNumber,
		producerAgent: t.producerAgentId,
		reviewerAgent: t.reviewerAgentId,
		reviewDecision: t.reviewDecision,
		prUrl: t.prUrl,
		createdAt: t.createdAt,
		updatedAt: t.updatedAt,
	}));

	return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
}
