# FairygitMother Patrol

**Codebase guardian.** Idle agents patrol your repos for bugs, code drift, and quality issues.

Part of the [FairygitMother](https://fairygitmother.ai) family — "No token goes unused."

## What It Does

FairygitMother Patrol is an MCP server that coordinates background AI agents to continuously maintain your codebase. It works with any MCP-compatible client — **Claude Code**, **Google Antigravity**, or any agentic IDE.

Your agents work natively with full tool access. Patrol just coordinates: what needs doing, what's been tried, who reviews what.

### Patrol Tasks

| Task | Description |
|------|-------------|
| **Bug Trawl** | Scan issue tracker, pick up bugs, attempt fix, PR |
| **Test Health** | Run test suite, identify failures, fix or report |
| **Code Drift** | Detect code that changed without matching doc/test updates |
| **Standards** | Lint, format, convention violations across codebase |
| **Dependency** | Outdated deps, known vulnerabilities |
| **Dead Code** | Unreachable code, unused exports, orphaned files |
| **Bug Validate** | Reproduce reported bugs, confirm or close |

### Cross-Validation

No agent reviews its own work. When Claude fixes a bug, Antigravity reviews it. When Antigravity detects drift, Claude validates the finding. PRs are only created after cross-validation passes.

### Background Only

Patrol never hijacks your active coding session. All work happens in background agent sessions, leaving your primary agent thread free.

## Quick Start

### Claude Code

```bash
claude mcp add fairygitmother-patrol -- npx fairygitmother-patrol
```

### Antigravity

Add to your MCP server configuration:

```json
{
  "fairygitmother-patrol": {
    "command": "npx",
    "args": ["fairygitmother-patrol"]
  }
}
```

### Configuration

Create `.fairygitmother/patrol.json` in your repo root:

```json
{
  "agents": {
    "claude": { "id": "claude", "model": "claude-opus-4-6" },
    "antigravity": { "id": "antigravity", "model": "gemini-3.1-pro" }
  },
  "repos": [
    { "owner": "your-org", "repo": "your-repo" }
  ],
  "patrols": {
    "bug_trawl": { "enabled": true, "labels": ["bug", "good first issue"] },
    "test_health": { "enabled": true, "command": "pnpm test" },
    "code_drift": { "enabled": true },
    "standards": { "enabled": true, "command": "pnpm lint:fix" }
  },
  "crossValidation": {
    "required": true,
    "prBlockedUntilCrossVal": true
  },
  "pr": {
    "autoCreate": true,
    "branchPrefix": "patrol/"
  },
  "github": {
    "token": "env:GITHUB_TOKEN"
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Your Active Session                  │
│          (Claude Code or Antigravity IDE)            │
│              You're coding. Untouched.               │
└─────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐
│ Background Agent │         │ Background Agent │
│    (Claude)      │         │  (Antigravity)   │
│                  │         │                  │
│  patrol/next─────┼────┐    │  patrol/next─────┤
│  patrol/report───┼──┐ │    │  patrol/report───┤
└──────────────────┘  │ │    └──────────────────┘
                      │ │
              ┌───────▼─▼────────────┐
              │   Patrol MCP Server  │
              │                      │
              │  Task Queue          │
              │  Cross-Val Enforcer  │
              │  Provenance Tracker  │
              │  SQLite State        │
              └──────────┬───────────┘
                         │
                   ┌─────▼─────┐
                   │  GitHub   │
                   │  PRs only │
                   │  after    │
                   │  cross-val│
                   └───────────┘
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `patrol/next-task` | Get the next patrol task. Cross-val aware — never returns a review of your own work. |
| `patrol/report` | Submit a fix or review. Tracks provenance and routes cross-validation. |
| `patrol/status` | View queue depth, pending reviews, recent activity. |
| `patrol/configure` | Update patrol configuration. |
| `patrol/history` | View completed tasks, PRs created, review outcomes. |

## Local-First

All state lives in a local SQLite database. No cloud dependency, no accounts, no telemetry. Your repo, your machine, your data.

## Part of the FairygitMother Family

- **[FairygitMother](https://fairygitmother.ai)** — Distributed agent grid for open source maintenance
- **FairygitMother Patrol** — Native codebase guardian for your own repos

Same philosophy: idle compute doing useful work. Different trust models for different contexts.

## License

MIT
