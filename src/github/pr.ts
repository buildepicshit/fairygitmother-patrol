import { type PatrolConfig, resolveToken } from "../config.js";

interface PrResult {
	url: string;
	number: number;
}

interface FileDiff {
	oldPath: string;
	newPath: string;
	hunks: DiffHunk[];
	isNew: boolean;
	isDeleted: boolean;
}

interface DiffHunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: string[];
}

/**
 * Create a PR for an approved patrol task.
 * Parses unified diff, applies changes via Git Data API, opens PR.
 */
export async function createPullRequest(
	owner: string,
	repo: string,
	opts: {
		title: string;
		body: string;
		branch: string;
		diff: string;
		baseBranch?: string;
	},
	config: PatrolConfig,
): Promise<PrResult> {
	const token = resolveToken(config.github.token);
	const base = opts.baseBranch || "main";
	const headers = {
		Accept: "application/vnd.github.v3+json",
		Authorization: `Bearer ${token}`,
		"User-Agent": "FairygitMother-Patrol",
		"Content-Type": "application/json",
	};
	const timeout = AbortSignal.timeout(15000);

	// 1. Get HEAD SHA and base tree
	const headSha = await getRef(owner, repo, `heads/${base}`, headers, timeout);
	const baseTreeSha = await getTreeSha(owner, repo, headSha, headers, timeout);

	// 2. Parse the diff into per-file changes
	const fileDiffs = parseDiff(opts.diff);
	if (fileDiffs.length === 0) {
		throw new Error("Diff is empty — nothing to commit.");
	}

	// 3. For each file: fetch original, apply patch, create blob
	const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];

	for (const fileDiff of fileDiffs) {
		const path = fileDiff.isNew ? fileDiff.newPath : fileDiff.oldPath;

		if (fileDiff.isDeleted) {
			// Deleted files are excluded from the tree (omitting them removes them)
			continue;
		}

		let original = "";
		if (!fileDiff.isNew) {
			original = await getFileContent(owner, repo, path, headSha, headers, timeout);
		}

		const newContent = applyPatch(original, fileDiff.hunks, fileDiff.isNew);
		const blobSha = await createBlob(owner, repo, newContent, headers, timeout);

		treeEntries.push({ path, mode: "100644", type: "blob", sha: blobSha });
	}

	// 4. Create tree from base + new blobs
	const newTreeSha = await createTree(owner, repo, baseTreeSha, treeEntries, headers, timeout);

	// 5. Create commit
	const commitMessage = `fix: ${opts.title}\n\nCreated by FairygitMother Patrol`;
	const commitSha = await createCommit(owner, repo, commitMessage, newTreeSha, [headSha], headers, timeout);

	// 6. Create branch pointing to the commit
	await createRef(owner, repo, `refs/heads/${opts.branch}`, commitSha, headers, timeout);

	// 7. Open PR
	const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
		method: "POST",
		headers,
		signal: timeout,
		body: JSON.stringify({ title: opts.title, body: opts.body, head: opts.branch, base }),
	});
	if (!prRes.ok) {
		const err = await prRes.text();
		throw new Error(`Failed to create PR: ${prRes.status} ${err}`);
	}

	const prData = (await prRes.json()) as { html_url: string; number: number };
	return { url: prData.html_url, number: prData.number };
}

// ── Git Data API helpers ────────────────────────────────────

async function getRef(
	owner: string,
	repo: string,
	ref: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/${ref}`, {
		headers,
		signal,
	});
	if (!res.ok) throw new Error(`Failed to get ref ${ref}: ${res.status}`);
	const data = (await res.json()) as { object: { sha: string } };
	return data.object.sha;
}

async function getTreeSha(
	owner: string,
	repo: string,
	commitSha: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`, {
		headers,
		signal,
	});
	if (!res.ok) throw new Error(`Failed to get commit ${commitSha}: ${res.status}`);
	const data = (await res.json()) as { tree: { sha: string } };
	return data.tree.sha;
}

async function getFileContent(
	owner: string,
	repo: string,
	path: string,
	ref: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
		{ headers, signal },
	);
	if (!res.ok) throw new Error(`Failed to get file ${path}: ${res.status}`);
	const data = (await res.json()) as { content?: string };
	if (!data.content) throw new Error(`No content for ${path}`);
	return Buffer.from(data.content, "base64").toString("utf-8");
}

async function createBlob(
	owner: string,
	repo: string,
	content: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
		method: "POST",
		headers,
		signal,
		body: JSON.stringify({ content, encoding: "utf-8" }),
	});
	if (!res.ok) throw new Error(`Failed to create blob: ${res.status}`);
	const data = (await res.json()) as { sha: string };
	return data.sha;
}

async function createTree(
	owner: string,
	repo: string,
	baseTreeSha: string,
	entries: Array<{ path: string; mode: string; type: string; sha: string }>,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
		method: "POST",
		headers,
		signal,
		body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
	});
	if (!res.ok) throw new Error(`Failed to create tree: ${res.status}`);
	const data = (await res.json()) as { sha: string };
	return data.sha;
}

async function createCommit(
	owner: string,
	repo: string,
	message: string,
	treeSha: string,
	parents: string[],
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
		method: "POST",
		headers,
		signal,
		body: JSON.stringify({ message, tree: treeSha, parents }),
	});
	if (!res.ok) throw new Error(`Failed to create commit: ${res.status}`);
	const data = (await res.json()) as { sha: string };
	return data.sha;
}

async function createRef(
	owner: string,
	repo: string,
	ref: string,
	sha: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<void> {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
		method: "POST",
		headers,
		signal,
		body: JSON.stringify({ ref, sha }),
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Failed to create ref ${ref}: ${res.status} ${err}`);
	}
}

// ── Diff parser + patch applier ─────────────────────────────

function parseDiff(diff: string): FileDiff[] {
	const files: FileDiff[] = [];
	const lines = diff.split("\n");
	let i = 0;

	while (i < lines.length) {
		if (!lines[i].startsWith("---")) {
			i++;
			continue;
		}

		const oldLine = lines[i];
		i++;
		if (i >= lines.length || !lines[i].startsWith("+++")) continue;
		const newLine = lines[i];
		i++;

		const oldPath = parseFilePath(oldLine);
		const newPath = parseFilePath(newLine);
		const isNew = oldLine.includes("/dev/null");
		const isDeleted = newLine.includes("/dev/null");

		const hunks: DiffHunk[] = [];

		while (i < lines.length && !lines[i].startsWith("---")) {
			if (lines[i].startsWith("@@")) {
				const hunk = parseHunkHeader(lines[i]);
				if (hunk) {
					i++;
					while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("---")) {
						const line = lines[i];
						if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "") {
							hunk.lines.push(line);
						} else if (!line.startsWith("\\") && !line.startsWith("diff ")) {
							break;
						}
						i++;
					}
					hunks.push(hunk);
				} else {
					i++;
				}
			} else {
				i++;
			}
		}

		files.push({ oldPath, newPath, hunks, isNew, isDeleted });
	}

	return files;
}

function applyPatch(original: string, hunks: DiffHunk[], isNew: boolean): string {
	if (isNew) {
		return hunks
			.flatMap((h) => h.lines)
			.filter((l) => l.startsWith("+"))
			.map((l) => l.slice(1))
			.join("\n");
	}

	const originalLines = original.split("\n");
	const result: string[] = [];
	let idx = 0;

	for (const hunk of hunks) {
		const hunkStart = hunk.oldStart - 1;
		while (idx < hunkStart) {
			result.push(originalLines[idx]);
			idx++;
		}

		for (const line of hunk.lines) {
			if (line.startsWith(" ") || line === "") {
				result.push(originalLines[idx]);
				idx++;
			} else if (line.startsWith("-")) {
				idx++;
			} else if (line.startsWith("+")) {
				result.push(line.slice(1));
			}
		}
	}

	while (idx < originalLines.length) {
		result.push(originalLines[idx]);
		idx++;
	}

	return result.join("\n");
}

function parseFilePath(line: string): string {
	const match = line.match(/^[-+]{3}\s+(?:[ab]\/)?(.+)$/);
	return match ? match[1] : "";
}

function parseHunkHeader(line: string): DiffHunk | null {
	const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
	if (!match) return null;
	return {
		oldStart: Number.parseInt(match[1], 10),
		oldCount: match[2] !== undefined ? Number.parseInt(match[2], 10) : 1,
		newStart: Number.parseInt(match[3], 10),
		newCount: match[4] !== undefined ? Number.parseInt(match[4], 10) : 1,
		lines: [],
	};
}

/**
 * Build a PR body with transparency disclosure.
 */
export function buildPrBody(opts: {
	taskType: string;
	issueNumber: number | null;
	explanation: string;
	producerAgent: string;
	reviewerAgent: string;
}): string {
	const lines = ["## Summary", "", opts.explanation, ""];

	if (opts.issueNumber) {
		lines.push(`Fixes #${opts.issueNumber}`, "");
	}

	lines.push(
		"## Patrol Details",
		"",
		"| Field | Value |",
		"|-------|-------|",
		`| Task Type | \`${opts.taskType}\` |`,
		`| Solved By | \`${opts.producerAgent}\` |`,
		`| Reviewed By | \`${opts.reviewerAgent}\` |`,
		"| Cross-Validated | Yes |",
		"",
		"---",
		"*This PR was created by [FairygitMother Patrol](https://fairygitmother.ai) — a codebase guardian that coordinates AI agents to maintain code quality.*",
	);

	return lines.join("\n");
}
