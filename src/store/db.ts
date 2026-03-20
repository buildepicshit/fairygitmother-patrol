import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

export type PatrolDb = ReturnType<typeof createDb>;

let _db: PatrolDb | null = null;

export function createDb(dbPath = "patrol.db"): ReturnType<typeof drizzle<typeof schema>> {
	const client = createClient({ url: `file:${dbPath}` });
	return drizzle(client, { schema });
}

export function getDb(dbPath?: string): PatrolDb {
	if (!_db) {
		_db = createDb(dbPath);
	}
	return _db;
}

/**
 * Initialize the database — create tables if they don't exist.
 */
export async function initDb(db: PatrolDb): Promise<void> {
	await db.run(
		`CREATE TABLE IF NOT EXISTS agents (
			id TEXT PRIMARY KEY,
			model TEXT,
			last_seen TEXT,
			tasks_completed INTEGER NOT NULL DEFAULT 0,
			reviews_completed INTEGER NOT NULL DEFAULT 0
		)`,
	);

	await db.run(
		`CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			type TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'queued',
			priority INTEGER NOT NULL DEFAULT 50,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			issue_number INTEGER,
			labels TEXT,
			assigned_agent_id TEXT,
			producer_agent_id TEXT,
			reviewer_agent_id TEXT,
			diff TEXT,
			explanation TEXT,
			files_changed TEXT,
			review_decision TEXT,
			review_reasoning TEXT,
			pr_url TEXT,
			pr_branch TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
	);

	await db.run(
		`CREATE TABLE IF NOT EXISTS attempts (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL REFERENCES tasks(id),
			agent_id TEXT NOT NULL,
			role TEXT NOT NULL,
			outcome TEXT NOT NULL,
			diff TEXT,
			explanation TEXT,
			reasoning TEXT,
			created_at TEXT NOT NULL
		)`,
	);

	await db.run(
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_attempts_task_agent_role
		 ON attempts(task_id, agent_id, role)`,
	);

	await db.run(
		`CREATE TABLE IF NOT EXISTS trawl_state (
			repo TEXT PRIMARY KEY,
			last_trawled_at TEXT NOT NULL,
			last_issue_number INTEGER NOT NULL DEFAULT 0
		)`,
	);
}
