import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PatrolConfig, PatrolConfigSchema, loadConfig } from "../src/config.js";
import { canReview, isReadyForPr } from "../src/engine/cross-validator.js";
import { assignTask, getNextTask } from "../src/engine/scheduler.js";
import { ensureAgent, generateId, recordReview, recordSolveAttempt } from "../src/engine/tracker.js";
import { type PatrolDb, createDb, initDb } from "../src/store/db.js";
import { agents, attempts, tasks } from "../src/store/schema.js";

let db: PatrolDb;
let config: PatrolConfig;

beforeEach(async () => {
	// In-memory SQLite for tests
	db = createDb(":memory:");
	await initDb(db);
	config = PatrolConfigSchema.parse({});
});

async function insertTask(overrides: Partial<typeof tasks.$inferInsert> = {}) {
	const task = {
		id: generateId("tsk"),
		repo: "testorg/testrepo",
		type: "bug_trawl",
		status: "queued",
		priority: 50,
		title: "Test task",
		description: "Fix this bug",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
	await db.insert(tasks).values(task);
	return task;
}

describe("cross-validator", () => {
	it("prevents agent from reviewing its own work", () => {
		expect(canReview("claude", "claude")).toBe(false);
		expect(canReview("antigravity", "antigravity")).toBe(false);
	});

	it("allows agent to review another agent's work", () => {
		expect(canReview("claude", "antigravity")).toBe(true);
		expect(canReview("antigravity", "claude")).toBe(true);
	});

	it("blocks PR until cross-validation passes", () => {
		expect(isReadyForPr(config, "approved", "approved")).toBe(true);
		expect(isReadyForPr(config, "approved", null)).toBe(false);
		expect(isReadyForPr(config, "review_pending", "approved")).toBe(false);
	});
});

describe("scheduler", () => {
	it("returns null when no tasks", async () => {
		await ensureAgent(db, "claude");
		const task = await getNextTask(db, "claude", config);
		expect(task).toBeNull();
	});

	it("returns highest priority task first", async () => {
		await ensureAgent(db, "claude");
		await insertTask({ priority: 100, title: "Low priority" });
		await insertTask({ priority: 10, title: "High priority" });

		const task = await getNextTask(db, "claude", config);
		expect(task?.title).toBe("High priority");
	});

	it("returns review tasks before solve tasks", async () => {
		await ensureAgent(db, "claude");
		await insertTask({ title: "Queued bug", status: "queued" });
		await insertTask({
			title: "Needs review",
			status: "review_pending",
			producerAgentId: "antigravity",
			diff: "some diff",
			explanation: "fixed it",
		});

		const task = await getNextTask(db, "claude", config);
		expect(task?.title).toBe("Review: Needs review");
		expect(task?.role).toBe("reviewer");
	});

	it("never assigns review of own work", async () => {
		await ensureAgent(db, "claude");
		await insertTask({
			title: "Claude's fix",
			status: "review_pending",
			producerAgentId: "claude",
			diff: "diff",
			explanation: "explanation",
		});

		// Claude should NOT get a review of their own work
		const task = await getNextTask(db, "claude", config);
		expect(task).toBeNull();
	});

	it("routes review to the other agent", async () => {
		await ensureAgent(db, "claude");
		await ensureAgent(db, "antigravity");

		await insertTask({
			title: "Claude's fix",
			status: "review_pending",
			producerAgentId: "claude",
			diff: "diff",
			explanation: "explanation",
		});

		// Claude should NOT get it
		const claudeTask = await getNextTask(db, "claude", config);
		expect(claudeTask).toBeNull();

		// Antigravity SHOULD get it
		const agTask = await getNextTask(db, "antigravity", config);
		expect(agTask?.role).toBe("reviewer");
		expect(agTask?.title).toBe("Review: Claude's fix");
	});

	it("skips tasks the agent already attempted", async () => {
		await ensureAgent(db, "claude");
		const attempted = await insertTask({ title: "Already tried" });
		await insertTask({ title: "Fresh task" });

		// Record a prior attempt
		await db.insert(attempts).values({
			id: generateId("att"),
			taskId: attempted.id,
			agentId: "claude",
			role: "solver",
			outcome: "submitted",
			createdAt: new Date().toISOString(),
		});

		const task = await getNextTask(db, "claude", config);
		expect(task?.title).toBe("Fresh task");
	});

	it("assigns task atomically", async () => {
		await ensureAgent(db, "claude");
		const t = await insertTask({ title: "Claimable" });

		const assigned = await assignTask(db, t.id, "claude", "solver");
		expect(assigned).toBe(true);

		// Second claim should fail
		const duplicate = await assignTask(db, t.id, "antigravity", "solver");
		expect(duplicate).toBe(false);
	});
});

describe("full patrol cycle", () => {
	it("completes solve → cross-review → approval", async () => {
		await ensureAgent(db, "claude");
		await ensureAgent(db, "antigravity");

		// 1. Create a task
		const t = await insertTask({ title: "Fix login bug" });

		// 2. Claude picks it up
		const solveTask = await getNextTask(db, "claude", config);
		expect(solveTask?.title).toBe("Fix login bug");
		expect(solveTask?.role).toBe("solver");

		await assignTask(db, t.id, "claude", "solver");

		// 3. Claude submits a fix
		await recordSolveAttempt(db, t.id, "claude", "--- a/login.ts\n+++ b/login.ts", "Fixed null check", [
			"login.ts",
		]);

		// Verify task is now review_pending
		const afterSolve = (await db.select().from(tasks).where(eq(tasks.id, t.id)))[0];
		expect(afterSolve?.status).toBe("review_pending");
		expect(afterSolve?.producerAgentId).toBe("claude");

		// 4. Antigravity picks up the review
		const reviewTask = await getNextTask(db, "antigravity", config);
		expect(reviewTask?.role).toBe("reviewer");
		expect(reviewTask?.title).toBe("Review: Fix login bug");
		expect(reviewTask?.diff).toBe("--- a/login.ts\n+++ b/login.ts");

		await assignTask(db, t.id, "antigravity", "reviewer");

		// 5. Antigravity approves
		const result = await recordReview(
			db,
			t.id,
			"antigravity",
			"approved",
			"Looks correct, null check is valid.",
		);
		expect(result.nextAction).toBe("pr_ready");

		// Verify final state
		const final = (await db.select().from(tasks).where(eq(tasks.id, t.id)))[0];
		expect(final?.status).toBe("approved");
		expect(final?.reviewerAgentId).toBe("antigravity");
		expect(final?.reviewDecision).toBe("approved");

		// Verify PR readiness
		expect(final).toBeDefined();
		expect(isReadyForPr(config, final?.status ?? "", final?.reviewDecision ?? null)).toBe(true);
	});

	it("requeues task on cross-review rejection", async () => {
		await ensureAgent(db, "claude");
		await ensureAgent(db, "antigravity");

		const t = await insertTask({ title: "Bad fix" });
		await assignTask(db, t.id, "claude", "solver");
		await recordSolveAttempt(db, t.id, "claude", "bad diff", "This is wrong", ["file.ts"]);

		// Antigravity rejects
		const result = await recordReview(db, t.id, "antigravity", "rejected", "Diff introduces a regression.");
		expect(result.nextAction).toBe("requeued");

		// Task should be back in queue
		const requeued = (await db.select().from(tasks).where(eq(tasks.id, t.id)))[0];
		expect(requeued?.status).toBe("queued");
		expect(requeued?.diff).toBeNull();
		expect(requeued?.producerAgentId).toBeNull();

		// Claude already attempted — should NOT get it again
		const claudeNext = await getNextTask(db, "claude", config);
		expect(claudeNext).toBeNull();

		// Antigravity CAN try solving it now
		const agNext = await getNextTask(db, "antigravity", config);
		expect(agNext?.title).toBe("Bad fix");
		expect(agNext?.role).toBe("solver");
	});
});
