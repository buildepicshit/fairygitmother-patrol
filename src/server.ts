import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { PatrolConfig } from "./config.js";
import type { PatrolDb } from "./store/db.js";
import { handleConfigure } from "./tools/configure.js";
import { handleFinding } from "./tools/finding.js";
import { handleHistory } from "./tools/history.js";
import { handleNextTask } from "./tools/next-task.js";
import { handleReport } from "./tools/report.js";
import { handleStatus } from "./tools/status.js";
import { handleSummary } from "./tools/summary.js";
import { handleTrawl } from "./tools/trawl.js";

const TOOL_DEFINITIONS = [
	{
		name: "patrol_next_task",
		description:
			"Get the next patrol task to work on. Returns a solve task (fix a bug, check drift, etc.) or a review task (validate another agent's work). Cross-validation aware: never returns a review of your own work.",
		inputSchema: {
			type: "object" as const,
			properties: {
				agentId: {
					type: "string",
					description:
						'Your agent identifier — e.g. "claude" or "antigravity". Used for cross-validation routing.',
				},
				model: {
					type: "string",
					description: "Optional model identifier for tracking.",
				},
			},
			required: ["agentId"],
		},
	},
	{
		name: "patrol_report",
		description:
			"Submit a fix or review for a patrol task. For solve tasks: provide the diff and explanation. For review tasks: provide your decision (approved/rejected) and reasoning.",
		inputSchema: {
			type: "object" as const,
			properties: {
				taskId: { type: "string", description: "The task ID from patrol_next_task." },
				agentId: { type: "string", description: "Your agent identifier." },
				role: {
					type: "string",
					enum: ["solver", "reviewer"],
					description: "Whether you solved or reviewed this task.",
				},
				// Solver fields
				diff: { type: "string", description: "The unified diff of your fix (solver only)." },
				explanation: { type: "string", description: "Explanation of the fix (solver only)." },
				filesChanged: {
					type: "array",
					items: { type: "string" },
					description: "List of files changed (solver only).",
				},
				// Reviewer fields
				decision: {
					type: "string",
					enum: ["approved", "rejected"],
					description: "Your review decision (reviewer only).",
				},
				reasoning: { type: "string", description: "Your review reasoning (reviewer only)." },
			},
			required: ["taskId", "agentId", "role"],
		},
	},
	{
		name: "patrol_status",
		description: "View the current patrol queue: pending tasks, reviews waiting, recent activity.",
		inputSchema: {
			type: "object" as const,
			properties: {
				repo: {
					type: "string",
					description: 'Optional repo filter — e.g. "owner/repo".',
				},
			},
		},
	},
	{
		name: "patrol_configure",
		description: "View or update patrol configuration. Called without input returns current config.",
		inputSchema: {
			type: "object" as const,
			properties: {
				config: {
					type: "object",
					description: "Partial config to merge. Omit to view current config.",
				},
			},
		},
	},
	{
		name: "patrol_trawl",
		description:
			"Scan configured repos for new issues and queue them as patrol tasks. Optionally pass a specific repo.",
		inputSchema: {
			type: "object" as const,
			properties: {
				repo: {
					type: "string",
					description: 'Repo to trawl — e.g. "owner/repo". Omit to trawl all configured repos.',
				},
			},
		},
	},
	{
		name: "patrol_finding",
		description:
			"Report a finding that doesn't have an auto-fix — creates a GitHub Issue tagged 'patrol'. Use this for code drift, architecture violations, security concerns, or quality issues that need human decision.",
		inputSchema: {
			type: "object" as const,
			properties: {
				repo: { type: "string", description: 'The repo — e.g. "owner/repo".' },
				title: { type: "string", description: "Short description of the finding." },
				body: {
					type: "string",
					description: "Detailed description: what you found, where, why it matters, and what you recommend.",
				},
				agentId: { type: "string", description: "Your agent identifier." },
				taskType: {
					type: "string",
					description: "What type of patrol found this (code_drift, standards, security, etc.).",
				},
				severity: {
					type: "string",
					enum: ["info", "warning", "critical"],
					description: "How urgent is this finding.",
				},
			},
			required: ["repo", "title", "body", "agentId"],
		},
	},
	{
		name: "patrol_summary",
		description:
			"Get a consolidated summary of patrol activity: proposed PRs, open findings, queue depth, agent stats. Shows what happened across all monitored repos.",
		inputSchema: {
			type: "object" as const,
			properties: {
				since: {
					type: "string",
					description: 'Time period — e.g. "24 hours", "7 days". Default: "24 hours".',
				},
			},
		},
	},
	{
		name: "patrol_history",
		description: "View completed patrol tasks with full provenance — who solved, who reviewed, PR links.",
		inputSchema: {
			type: "object" as const,
			properties: {
				repo: { type: "string", description: "Filter by repo." },
				type: { type: "string", description: "Filter by task type." },
				limit: { type: "number", description: "Max results (default 50)." },
			},
		},
	},
];

type ToolHandler = (
	args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

export function createPatrolServer(
	db: PatrolDb,
	config: PatrolConfig,
): { server: Server; transport: StdioServerTransport } {
	const server = new Server(
		{ name: "fairygitmother-patrol", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	const transport = new StdioServerTransport();

	// Tool router
	const handlers: Record<string, ToolHandler> = {
		patrol_next_task: (args) => handleNextTask(db, config, args),
		patrol_report: (args) => handleReport(db, config, args),
		patrol_status: (args) => handleStatus(db, config, args),
		patrol_configure: (args) => handleConfigure(db, config, args),
		patrol_trawl: (args) => handleTrawl(db, config, args),
		patrol_finding: (args) => handleFinding(db, config, args),
		patrol_summary: (args) => handleSummary(db, config, args),
		patrol_history: (args) => handleHistory(db, config, args),
	};

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: TOOL_DEFINITIONS,
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		const handler = handlers[name];

		if (!handler) {
			return {
				content: [{ type: "text", text: `Unknown tool: ${name}` }],
				isError: true,
			};
		}

		try {
			return await handler((args as Record<string, unknown>) || {});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	});

	return { server, transport };
}
