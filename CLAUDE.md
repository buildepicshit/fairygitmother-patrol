# FairygitMother Patrol

Codebase guardian MCP server. Idle agents in Claude Code and Antigravity patrol your repos for bugs, code drift, and quality issues.

## What This Is

An MCP server that coordinates background agents to maintain code quality. Agents connect via MCP protocol (stdio transport) and receive patrol tasks: bug trawling, code quality enforcement, drift detection, test validation. The agent does all work natively with full tool access. Patrol just coordinates.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 22+
- **MCP SDK:** @modelcontextprotocol/sdk (stdio transport)
- **Database:** SQLite (local, via better-sqlite3 + Drizzle ORM)
- **GitHub:** Octokit
- **Validation:** Zod
- **Build:** tsup
- **Linting:** Biome
- **Testing:** Vitest

## Architecture

```
src/
  index.ts          # Entry point — start MCP server
  server.ts         # MCP server setup + tool registration
  config.ts         # Load .fairygitmother/patrol.json
  tools/            # MCP tool handlers
    next-task.ts    # Get next patrol task (cross-val aware)
    report.ts       # Submit findings/fix (tracks provenance)
    status.ts       # What's been checked, what hasn't
    configure.ts    # Update patrol config
    history.ts      # What was found, fixed, PRed
  engine/
    trawler.ts      # GitHub issue trawler
    scheduler.ts    # Task prioritization + scheduling
    tracker.ts      # Attempt tracking + provenance
    cross-validator.ts  # Cross-validation enforcement
  store/
    db.ts           # SQLite connection
    schema.ts       # Drizzle schema
  github/
    issues.ts       # Issue fetching + filtering
    pr.ts           # Branch + PR creation
```

## Key Design Rules

- **Cross-validation is mandatory** — No agent reviews its own work. Claude reviews Antigravity's output and vice versa.
- **Background only** — Patrol never hijacks the user's active agent session. All work happens in background agents.
- **Local-first** — SQLite database, no cloud dependency. Your repo, your machine, your data.
- **MCP is the only interface** — No REST API, no dashboard. Agents interact via MCP tools.
- **PRs blocked until cross-validated** — No PR is created until the other agent has reviewed the work.

## Commands

- `pnpm install` — Install dependencies
- `pnpm build` — Build with tsup
- `pnpm test` — Run tests with Vitest
- `pnpm lint:fix` — Lint + format with Biome
- `pnpm typecheck` — TypeScript type checking
- `pnpm inspector` — Test MCP tools with MCP Inspector

## Patrol Task Types

1. **BUG_TRAWL** — Scan issue tracker, pick up bugs, attempt fix, PR
2. **TEST_HEALTH** — Run test suite, identify failures, fix or report
3. **CODE_DRIFT** — Detect code that changed without matching doc/test updates
4. **STANDARDS** — Lint, format, convention violations across codebase
5. **DEPENDENCY** — Outdated deps, known vulnerabilities
6. **DEAD_CODE** — Unreachable code, unused exports, orphaned files
7. **BUG_VALIDATE** — Reproduce reported bugs, confirm or close

## Conventions

- camelCase in TypeScript, snake_case in SQL
- Zod schemas for runtime validation
- Drizzle ORM for type-safe queries
- No over-engineering — solve the current problem
