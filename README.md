# Scar

> Failure memory for AI agents. Remember what went wrong so you don't repeat it.

Scar is an MCP server + CLI that gives AI agents persistent memory of past failures. When your agent encounters an error, Scar remembers the context, what was tried, and what eventually worked - so next time, the agent can avoid the same mistake.

## Install

```bash
npm install -g scar
scar init
```

## Quick Start

```bash
# Initialize database and MCP config
scar init

# With Claude Code auto-capture hooks
scar init --claude-code

# Manually log a failure
scar log -r my-project -l typescript -t bash \
  -e "TypeError: Cannot read properties of undefined" \
  --tried "Ran test suite" \
  --wrong "Null access in parser.ts"

# Query past failures
scar recall -r my-project -l typescript

# View patterns
scar stats
scar stats --stale

# Remove noise
scar forget <scar-id>

# Export for debugging
scar export
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `scar_log` | Record a failure with context |
| `scar_update` | Update a scar - record what worked, change resolution |
| `scar_recall` | Find relevant past failures |
| `scar_forget` | Remove a scar |
| `scar_stats` | Aggregate failure patterns |
| `scar_context` | Lightweight count of relevant scars (cheap pre-check) |

## How It Works

1. Agent encounters an error or user corrects the agent
2. Scar logs: repo, language, tool, error signature, what was tried, what went wrong
3. Auto-deduplicates identical errors within 5-minute windows
4. Before the next action, agent calls `scar_context` (cheap) then `scar_recall` (detailed)
5. Agent adjusts approach based on past failures

## Storage

SQLite database at `~/.cognitive/cognitive.db`. Part of a shared cognitive toolkit foundation - future tools (self-trust calibration, intuition/focus) share the same database.

## License

MIT
