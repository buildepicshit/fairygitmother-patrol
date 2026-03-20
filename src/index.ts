#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { createPatrolServer } from "./server.js";
import { createDb, initDb } from "./store/db.js";

async function main(): Promise<void> {
	const config = loadConfig();
	const db = createDb();
	await initDb(db);

	const { server, transport } = createPatrolServer(db, config);

	// Graceful shutdown
	const shutdown = async (signal: string) => {
		process.stderr.write(`[patrol] Received ${signal}, shutting down.\n`);
		try {
			await server.close();
			process.exit(0);
		} catch {
			process.exit(1);
		}
	};

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	await server.connect(transport);
	process.stderr.write("[patrol] FairygitMother Patrol MCP server started.\n");
}

main().catch((error) => {
	process.stderr.write(`[patrol] Fatal: ${error instanceof Error ? error.message : error}\n`);
	process.exit(1);
});
