import { and, desc, eq } from "drizzle-orm";
import type { PatrolDb } from "../store/db.js";
import { agents, attempts, tasks } from "../store/schema.js";

/**
 * Generate a simple unique ID.
 */
export function generateId(prefix: string): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return `${prefix}_${timestamp}${random}`;
}

/**
 * Record a solve attempt — agent submitted a fix.
 */
export async function recordSolveAttempt(
	db: PatrolDb,
	taskId: string,
	agentId: string,
	diff: string,
	explanation: string,
	filesChanged: string[],
): Promise<void> {
	const now = new Date().toISOString();

	// Record the attempt
	await db.insert(attempts).values({
		id: generateId("att"),
		taskId,
		agentId,
		role: "solver",
		outcome: "submitted",
		diff,
		explanation,
		createdAt: now,
	});

	// Update task with the solution
	await db
		.update(tasks)
		.set({
			status: "review_pending",
			producerAgentId: agentId,
			diff,
			explanation,
			filesChanged: JSON.stringify(filesChanged),
			updatedAt: now,
		})
		.where(eq(tasks.id, taskId));

	// Update agent stats
	await db
		.update(agents)
		.set({
			lastSeen: now,
			tasksCompleted:
				(await db.select().from(agents).where(eq(agents.id, agentId)))[0]?.tasksCompleted + 1 || 1,
		})
		.where(eq(agents.id, agentId));
}

/**
 * Record a review — agent reviewed someone else's work.
 */
export async function recordReview(
	db: PatrolDb,
	taskId: string,
	agentId: string,
	decision: "approved" | "rejected",
	reasoning: string,
): Promise<{ nextAction: "pr_ready" | "requeued" | "closed" }> {
	const now = new Date().toISOString();

	// Record the attempt
	await db.insert(attempts).values({
		id: generateId("att"),
		taskId,
		agentId,
		role: "reviewer",
		outcome: decision,
		reasoning,
		createdAt: now,
	});

	// Update task with review result
	if (decision === "approved") {
		await db
			.update(tasks)
			.set({
				status: "approved",
				reviewerAgentId: agentId,
				reviewDecision: decision,
				reviewReasoning: reasoning,
				updatedAt: now,
			})
			.where(eq(tasks.id, taskId));

		// Update reviewer stats
		await upsertAgentReview(db, agentId, now);

		return { nextAction: "pr_ready" };
	}

	// Rejected — requeue for another solver attempt
	await db
		.update(tasks)
		.set({
			status: "queued",
			assignedAgentId: null,
			reviewerAgentId: agentId,
			reviewDecision: decision,
			reviewReasoning: reasoning,
			diff: null,
			explanation: null,
			filesChanged: null,
			producerAgentId: null,
			updatedAt: now,
		})
		.where(eq(tasks.id, taskId));

	await upsertAgentReview(db, agentId, now);

	return { nextAction: "requeued" };
}

async function upsertAgentReview(db: PatrolDb, agentId: string, now: string): Promise<void> {
	const existing = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
	if (existing.length > 0) {
		await db
			.update(agents)
			.set({
				lastSeen: now,
				reviewsCompleted: existing[0].reviewsCompleted + 1,
			})
			.where(eq(agents.id, agentId));
	}
}

/**
 * Ensure an agent record exists.
 */
export async function ensureAgent(db: PatrolDb, agentId: string, model?: string): Promise<void> {
	const existing = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
	if (existing.length === 0) {
		await db.insert(agents).values({
			id: agentId,
			model: model ?? null,
			lastSeen: new Date().toISOString(),
		});
	} else {
		await db
			.update(agents)
			.set({ lastSeen: new Date().toISOString(), ...(model ? { model } : {}) })
			.where(eq(agents.id, agentId));
	}
}

/**
 * Get task history with full provenance.
 */
export async function getHistory(
	db: PatrolDb,
	opts: { repo?: string; limit?: number; type?: string },
): Promise<Array<typeof tasks.$inferSelect>> {
	const conditions = [];
	if (opts.repo) conditions.push(eq(tasks.repo, opts.repo));
	if (opts.type) conditions.push(eq(tasks.type, opts.type));

	const query = db
		.select()
		.from(tasks)
		.orderBy(desc(tasks.updatedAt))
		.limit(opts.limit ?? 50);

	if (conditions.length > 0) {
		return query.where(and(...conditions));
	}
	return query;
}
