import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PatrolConfig } from "../config.js";
import type { PatrolDb } from "../store/db.js";

/**
 * Deep merge two objects — nested keys are merged, not replaced.
 */
function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (
			source[key] &&
			typeof source[key] === "object" &&
			!Array.isArray(source[key]) &&
			target[key] &&
			typeof target[key] === "object" &&
			!Array.isArray(target[key])
		) {
			result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
		} else {
			result[key] = source[key];
		}
	}
	return result;
}

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

	// Deep merge so nested keys (pr, crossValidation, patrols) aren't clobbered
	const merged = deepMerge(config as unknown as Record<string, unknown>, newConfig);
	const configPath = resolve(process.cwd(), ".fairygitmother", "patrol.json");

	try {
		mkdirSync(dirname(configPath), { recursive: true });
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
