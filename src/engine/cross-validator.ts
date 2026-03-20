import type { PatrolConfig } from "../config.js";

/**
 * Cross-validation rules:
 * 1. No agent reviews its own work — EVER.
 * 2. Review tasks are only routed to agents that did NOT produce the work.
 * 3. PRs are blocked until cross-validation passes (if configured).
 */

/**
 * Check if an agent is allowed to review a task.
 */
export function canReview(agentId: string, producerAgentId: string | null): boolean {
	if (!producerAgentId) return true;
	return agentId !== producerAgentId;
}

/**
 * Check if a task is ready for PR creation.
 */
export function isReadyForPr(
	config: PatrolConfig,
	taskStatus: string,
	reviewDecision: string | null,
): boolean {
	if (!config.crossValidation.prBlockedUntilCrossVal) {
		// If cross-val not required for PRs, approved status is enough
		return taskStatus === "approved";
	}

	// Cross-val required: must be approved by a different agent
	return taskStatus === "approved" && reviewDecision === "approved";
}

/**
 * Determine which agent should review a task based on who produced it.
 * Returns null if any agent can review (no constraint).
 */
export function getReviewerConstraint(
	config: PatrolConfig,
	producerAgentId: string | null,
): { exclude: string } | null {
	if (!config.crossValidation.required) return null;
	if (!producerAgentId) return null;
	return { exclude: producerAgentId };
}
