import { and, asc, eq, notInArray } from "drizzle-orm";
import type { PatrolConfig } from "../config.js";
import type { PatrolDb } from "../store/db.js";
import { attempts, tasks } from "../store/schema.js";

export type TaskType =
	| "bug_trawl"
	| "test_health"
	| "code_drift"
	| "standards"
	| "dependency"
	| "dead_code"
	| "bug_validate";

export interface ScheduledTask {
	id: string;
	repo: string;
	type: TaskType;
	role: "solver" | "reviewer";
	title: string;
	description: string;
	issueNumber: number | null;
	labels: string[];
	priority: number;
	// For reviews: the diff + explanation to review
	diff: string | null;
	explanation: string | null;
	producerAgentId: string | null;
}

/**
 * Get the next task for an agent, respecting cross-validation rules.
 *
 * Priority order:
 * 1. Review tasks (always dispatched first) — but never your own work
 * 2. Solve tasks — but never ones you've already attempted
 */
export async function getNextTask(
	db: PatrolDb,
	agentId: string,
	config: PatrolConfig,
): Promise<ScheduledTask | null> {
	// 1. Check for review tasks first (cross-validation)
	if (config.crossValidation.required) {
		const reviewTask = await getNextReviewTask(db, agentId);
		if (reviewTask) return reviewTask;
	}

	// 2. Check for solve tasks
	return getNextSolveTask(db, agentId);
}

/**
 * Find a task that needs review and was NOT produced by this agent.
 */
async function getNextReviewTask(db: PatrolDb, agentId: string): Promise<ScheduledTask | null> {
	const candidates = await db
		.select()
		.from(tasks)
		.where(eq(tasks.status, "review_pending"))
		.orderBy(asc(tasks.priority), asc(tasks.createdAt))
		.limit(20);

	for (const task of candidates) {
		// Cross-validation: never review your own work
		if (task.producerAgentId === agentId) continue;

		// Check if this agent already reviewed this task
		const priorReview = await db
			.select()
			.from(attempts)
			.where(and(eq(attempts.taskId, task.id), eq(attempts.agentId, agentId), eq(attempts.role, "reviewer")))
			.limit(1);

		if (priorReview.length > 0) continue;

		return {
			id: task.id,
			repo: task.repo,
			type: task.type as TaskType,
			role: "reviewer",
			title: `Review: ${task.title}`,
			description: task.description,
			issueNumber: task.issueNumber,
			labels: task.labels ? JSON.parse(task.labels) : [],
			priority: task.priority,
			diff: task.diff,
			explanation: task.explanation,
			producerAgentId: task.producerAgentId,
		};
	}

	return null;
}

/**
 * Find a queued task that this agent hasn't already attempted.
 */
async function getNextSolveTask(db: PatrolDb, agentId: string): Promise<ScheduledTask | null> {
	// Get IDs of tasks this agent has already attempted as solver
	const attemptedTaskIds = db
		.select({ taskId: attempts.taskId })
		.from(attempts)
		.where(and(eq(attempts.agentId, agentId), eq(attempts.role, "solver")));

	const candidates = await db
		.select()
		.from(tasks)
		.where(and(eq(tasks.status, "queued"), notInArray(tasks.id, attemptedTaskIds)))
		.orderBy(asc(tasks.priority), asc(tasks.createdAt))
		.limit(10);

	if (candidates.length === 0) return null;

	const task = candidates[0];
	return {
		id: task.id,
		repo: task.repo,
		type: task.type as TaskType,
		role: "solver",
		title: task.title,
		description: task.description,
		issueNumber: task.issueNumber,
		labels: task.labels ? JSON.parse(task.labels) : [],
		priority: task.priority,
		diff: null,
		explanation: null,
		producerAgentId: null,
	};
}

/**
 * Assign a task to an agent. Atomic — only succeeds if task is still in expected status.
 */
export async function assignTask(
	db: PatrolDb,
	taskId: string,
	agentId: string,
	role: "solver" | "reviewer",
): Promise<boolean> {
	const expectedStatus = role === "solver" ? "queued" : "review_pending";
	const newStatus = role === "solver" ? "assigned" : "review_assigned";
	const field = role === "solver" ? "assignedAgentId" : "reviewerAgentId";

	const result = await db
		.update(tasks)
		.set({
			status: newStatus,
			[field]: agentId,
			updatedAt: new Date().toISOString(),
		})
		.where(and(eq(tasks.id, taskId), eq(tasks.status, expectedStatus)))
		.returning({ id: tasks.id });

	return result.length > 0;
}
