import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const AgentConfigSchema = z.object({
	id: z.string(),
	model: z.string().optional(),
});

const PatrolTypeConfigSchema = z.object({
	enabled: z.boolean().default(true),
	labels: z.array(z.string()).optional(), // for bug_trawl: which issue labels to pick up
	command: z.string().optional(), // for test_health / standards: what command to run
});

const PrConfigSchema = z.object({
	autoCreate: z.boolean().default(true),
	branchPrefix: z.string().default("patrol/"),
	requireApproval: z.boolean().default(true),
});

const CrossValidationConfigSchema = z.object({
	required: z.boolean().default(true),
	solveRequiresReview: z.boolean().default(true),
	findingsRequireReview: z.boolean().default(true),
	prBlockedUntilCrossVal: z.boolean().default(true),
});

export const PatrolConfigSchema = z.object({
	agents: z.record(z.string(), AgentConfigSchema).default({
		claude: { id: "claude" },
		antigravity: { id: "antigravity" },
	}),
	repos: z
		.array(
			z.object({
				owner: z.string(),
				repo: z.string(),
			}),
		)
		.default([]),
	patrols: z
		.object({
			bug_trawl: PatrolTypeConfigSchema.default({ enabled: true }),
			test_health: PatrolTypeConfigSchema.default({ enabled: true }),
			code_drift: PatrolTypeConfigSchema.default({ enabled: true }),
			standards: PatrolTypeConfigSchema.default({ enabled: true }),
			dependency: PatrolTypeConfigSchema.default({ enabled: false }),
			dead_code: PatrolTypeConfigSchema.default({ enabled: false }),
			bug_validate: PatrolTypeConfigSchema.default({ enabled: false }),
		})
		.default({}),
	pr: PrConfigSchema.default({}),
	crossValidation: CrossValidationConfigSchema.default({}),
	github: z
		.object({
			token: z.string().default("env:GITHUB_TOKEN"),
		})
		.default({}),
});

export type PatrolConfig = z.infer<typeof PatrolConfigSchema>;

/**
 * Resolve a token value — supports "env:VAR_NAME" syntax.
 */
export function resolveToken(value: string): string {
	if (value.startsWith("env:")) {
		const envVar = value.slice(4);
		const resolved = process.env[envVar];
		if (!resolved) {
			throw new Error(`Environment variable ${envVar} is not set`);
		}
		return resolved;
	}
	return value;
}

/**
 * Load patrol config from .fairygitmother/patrol.json in the given directory.
 * Falls back to defaults if the file doesn't exist.
 */
export function loadConfig(repoRoot?: string): PatrolConfig {
	const root = repoRoot || process.cwd();
	const configPath = resolve(root, ".fairygitmother", "patrol.json");

	if (!existsSync(configPath)) {
		return PatrolConfigSchema.parse({});
	}

	const raw = JSON.parse(readFileSync(configPath, "utf-8"));
	return PatrolConfigSchema.parse(raw);
}
