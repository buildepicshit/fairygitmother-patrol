import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Registered agents (claude, antigravity, etc.)
 */
export const agents = sqliteTable("agents", {
	id: text("id").primaryKey(), // "claude" | "antigravity" | custom
	model: text("model"),
	lastSeen: text("last_seen"),
	tasksCompleted: integer("tasks_completed").notNull().default(0),
	reviewsCompleted: integer("reviews_completed").notNull().default(0),
});

/**
 * Patrol task types:
 * - bug_trawl: Fix a bug from the issue tracker
 * - test_health: Find and fix test failures
 * - code_drift: Detect code/doc/test drift
 * - standards: Lint/format/convention enforcement
 * - dependency: Outdated deps, vulnerabilities
 * - dead_code: Unreachable code, unused exports
 * - bug_validate: Reproduce and confirm/close reported bugs
 */
export const tasks = sqliteTable("tasks", {
	id: text("id").primaryKey(),
	repo: text("repo").notNull(), // "owner/repo"
	type: text("type").notNull(), // patrol task type
	status: text("status").notNull().default("queued"),
	// queued → assigned → solved → review_pending → review_assigned → approved | rejected → pr_created
	priority: integer("priority").notNull().default(50),

	// What this task is about
	title: text("title").notNull(),
	description: text("description").notNull().default(""),
	issueNumber: integer("issue_number"), // null for non-issue tasks (drift, standards, etc.)
	labels: text("labels"), // JSON array as text

	// Assignment + provenance
	assignedAgentId: text("assigned_agent_id"),
	producerAgentId: text("producer_agent_id"), // who solved it (for cross-val routing)
	reviewerAgentId: text("reviewer_agent_id"), // who reviewed it

	// Results
	diff: text("diff"),
	explanation: text("explanation"),
	filesChanged: text("files_changed"), // JSON array as text
	reviewDecision: text("review_decision"), // "approved" | "rejected"
	reviewReasoning: text("review_reasoning"),

	// PR
	prUrl: text("pr_url"),
	prBranch: text("pr_branch"),

	// Metadata
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

/**
 * Track all attempts — prevents same agent from retrying failed tasks
 * and provides full audit trail.
 */
export const attempts = sqliteTable(
	"attempts",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id),
		agentId: text("agent_id").notNull(),
		role: text("role").notNull(), // "solver" | "reviewer"
		outcome: text("outcome").notNull(), // "submitted" | "approved" | "rejected"
		diff: text("diff"),
		explanation: text("explanation"),
		reasoning: text("reasoning"),
		createdAt: text("created_at").notNull(),
	},
	(table) => [uniqueIndex("uq_attempts_task_agent_role").on(table.taskId, table.agentId, table.role)],
);

/**
 * Trawl state — track when repos were last scanned for issues.
 */
export const trawlState = sqliteTable("trawl_state", {
	repo: text("repo").primaryKey(), // "owner/repo"
	lastTrawledAt: text("last_trawled_at").notNull(),
	lastIssueNumber: integer("last_issue_number").notNull().default(0),
});
