import { eq, sql } from "drizzle-orm";
import type { PatrolConfig } from "../config.js";
import type { PatrolDb } from "../store/db.js";
import { agents, tasks } from "../store/schema.js";

export async function handleStatus(
	db: PatrolDb,
	_config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const repo = args.repo as string | undefined;

	// Count tasks by status
	const statusCounts = await db
		.select({
			status: tasks.status,
			count: sql<number>`count(*)`,
		})
		.from(tasks)
		.where(repo ? eq(tasks.repo, repo) : undefined)
		.groupBy(tasks.status);

	const counts: Record<string, number> = {};
	for (const row of statusCounts) {
		counts[row.status] = Number(row.count);
	}

	// Count tasks by type
	const typeCounts = await db
		.select({
			type: tasks.type,
			count: sql<number>`count(*)`,
		})
		.from(tasks)
		.where(repo ? eq(tasks.repo, repo) : undefined)
		.groupBy(tasks.type);

	const byType: Record<string, number> = {};
	for (const row of typeCounts) {
		byType[row.type] = Number(row.count);
	}

	// Agent stats
	const agentList = await db.select().from(agents);

	const status = {
		queue: {
			queued: counts.queued || 0,
			assigned: counts.assigned || 0,
			reviewPending: counts.review_pending || 0,
			reviewAssigned: counts.review_assigned || 0,
			approved: counts.approved || 0,
			prCreated: counts.pr_created || 0,
			rejected: counts.rejected || 0,
		},
		byType,
		agents: agentList.map((a) => ({
			id: a.id,
			model: a.model,
			lastSeen: a.lastSeen,
			tasksCompleted: a.tasksCompleted,
			reviewsCompleted: a.reviewsCompleted,
		})),
		repo: repo || "all",
	};

	return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
}
