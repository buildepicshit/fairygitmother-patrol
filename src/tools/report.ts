import { eq } from "drizzle-orm";
import type { PatrolConfig } from "../config.js";
import { isReadyForPr } from "../engine/cross-validator.js";
import { recordReview, recordSolveAttempt } from "../engine/tracker.js";
import { parseRepo } from "../github/issues.js";
import { buildPrBody, createPullRequest } from "../github/pr.js";
import type { PatrolDb } from "../store/db.js";
import { tasks } from "../store/schema.js";

export async function handleReport(
	db: PatrolDb,
	config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const taskId = args.taskId as string;
	const agentId = args.agentId as string;
	const role = args.role as "solver" | "reviewer";

	if (!taskId || !agentId || !role) {
		return { content: [{ type: "text", text: "Error: taskId, agentId, and role are required." }] };
	}

	if (role === "solver") {
		return handleSolverReport(db, config, taskId, agentId, args);
	}
	return handleReviewerReport(db, config, taskId, agentId, args);
}

async function handleSolverReport(
	db: PatrolDb,
	config: PatrolConfig,
	taskId: string,
	agentId: string,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const diff = args.diff as string;
	const explanation = args.explanation as string;
	const filesChanged = (args.filesChanged as string[]) || [];

	if (!diff || !explanation) {
		return {
			content: [{ type: "text", text: "Error: diff and explanation are required for solver reports." }],
		};
	}

	await recordSolveAttempt(db, taskId, agentId, diff, explanation, filesChanged);

	const nextStep = config.crossValidation.solveRequiresReview ? "awaiting_cross_review" : "pr_ready";

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					status: "submitted",
					nextAction: nextStep,
					message:
						nextStep === "awaiting_cross_review"
							? "Fix submitted. Awaiting cross-validation from another agent."
							: "Fix submitted. Ready for PR.",
				}),
			},
		],
	};
}

async function handleReviewerReport(
	db: PatrolDb,
	config: PatrolConfig,
	taskId: string,
	agentId: string,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const decision = args.decision as "approved" | "rejected";
	const reasoning = args.reasoning as string;

	if (!decision || !reasoning) {
		return {
			content: [{ type: "text", text: "Error: decision and reasoning are required for reviewer reports." }],
		};
	}

	const result = await recordReview(db, taskId, agentId, decision, reasoning);

	// If approved and PR auto-create is on, create the PR
	if (result.nextAction === "pr_ready" && config.pr.autoCreate) {
		const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
		if (task && isReadyForPr(config, task.status, task.reviewDecision)) {
			try {
				const { owner, repo } = parseRepo(task.repo);
				const branch = `${config.pr.branchPrefix}${task.type}-${task.issueNumber || task.id.slice(0, 8)}`;
				const prBody = buildPrBody({
					taskType: task.type,
					issueNumber: task.issueNumber,
					explanation: task.explanation || "",
					producerAgent: task.producerAgentId || "unknown",
					reviewerAgent: agentId,
				});

				const pr = await createPullRequest(
					owner,
					repo,
					{ title: task.title, body: prBody, branch, diff: task.diff || "" },
					config,
				);

				await db
					.update(tasks)
					.set({
						status: "pr_created",
						prUrl: pr.url,
						prBranch: branch,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(tasks.id, taskId));

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "pr_created",
								prUrl: pr.url,
								message: `Cross-validation passed. PR created: ${pr.url}`,
							}),
						},
					],
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "approved",
								prError: message,
								message: `Cross-validation passed but PR creation failed: ${message}`,
							}),
						},
					],
				};
			}
		}
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					status: decision,
					nextAction: result.nextAction,
					message:
						decision === "approved"
							? "Cross-validation passed. PR ready."
							: "Review rejected. Task requeued for another attempt.",
				}),
			},
		],
	};
}
