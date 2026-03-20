import type { PatrolConfig } from "../config.js";
import { assignTask, getNextTask } from "../engine/scheduler.js";
import { ensureAgent } from "../engine/tracker.js";
import type { PatrolDb } from "../store/db.js";

export async function handleNextTask(
	db: PatrolDb,
	config: PatrolConfig,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const agentId = args.agentId as string;
	if (!agentId) {
		return { content: [{ type: "text", text: "Error: agentId is required." }] };
	}

	// Ensure agent exists in DB
	await ensureAgent(db, agentId, args.model as string | undefined);

	// Get next task (cross-val aware)
	const task = await getNextTask(db, agentId, config);
	if (!task) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ status: "idle", message: "No tasks available. All patrols clear." }),
				},
			],
		};
	}

	// Assign it atomically
	const assigned = await assignTask(db, task.id, agentId, task.role);
	if (!assigned) {
		// Race condition — another agent grabbed it. Try again.
		const retry = await getNextTask(db, agentId, config);
		if (!retry) {
			return {
				content: [{ type: "text", text: JSON.stringify({ status: "idle", message: "No tasks available." }) }],
			};
		}
		const retryAssigned = await assignTask(db, retry.id, agentId, retry.role);
		if (!retryAssigned) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ status: "idle", message: "Tasks claimed by other agents." }),
					},
				],
			};
		}
		return { content: [{ type: "text", text: JSON.stringify({ status: "assigned", task: retry }) }] };
	}

	return { content: [{ type: "text", text: JSON.stringify({ status: "assigned", task }) }] };
}
