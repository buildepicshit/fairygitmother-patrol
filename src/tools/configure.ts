import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PatrolConfig } from "../config.js";
import type { PatrolDb } from "../store/db.js";

export async function handleConfigure(
	_db: PatrolDb,
	config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const newConfig = args.config as Record<string, unknown> | undefined;

	if (!newConfig) {
		// Return current config (redact token)
		const safeConfig = {
			...config,
			github: {
				...config.github,
				token: config.github.token.startsWith("env:") ? config.github.token : "***",
			},
		};
		return {
			content: [{ type: "text", text: JSON.stringify(safeConfig, null, 2) }],
		};
	}

	// Merge and save
	const merged = { ...config, ...newConfig };
	const configPath = resolve(process.cwd(), ".fairygitmother", "patrol.json");

	try {
		writeFileSync(configPath, JSON.stringify(merged, null, 2));
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ status: "updated", message: `Config saved to ${configPath}` }),
				},
			],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Error saving config: ${message}` }],
		};
	}
}
