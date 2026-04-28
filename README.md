# Scar

> Failure memory for AI agents. Remember what went wrong so you don't repeat it.

Scar mines your AI agent's session transcripts for failures, stores them in a local SQLite database, and surfaces a briefing at the start of every new session. Your agent walks into work already aware of what's been broken before.

Two surfaces:
- **Hooks** (recommended): SessionStart briefing + Stop-time transcript mining. Passive, automatic, zero agent action required.
- **MCP server** (optional): Active tools (`scar_log`, `scar_recall`, `scar_context`) for agents that want to query failure history mid-session.

In practice, the briefing is where most of the value comes from. The MCP layer is for power users who want their agent to actively consult past failures before risky operations.

## Install (slim, recommended)

```bash
npm install -g @bambushu/scar
scar init --claude-code
```

That sets up:
- SQLite database at `~/.cognitive/cognitive.db`
- SessionStart hook in `~/.claude/settings.json` that runs the briefing
- Stop hook that mines the just-finished transcript for failures

You'll see a briefing at the top of every new Claude Code session listing unresolved failure patterns from prior work.

## Install (full, with MCP)

If you want active lookup tools too:

```bash
npm install -g @bambushu/scar
scar init --claude-code --with-mcp
```

This additionally registers the MCP server so Claude Code exposes `scar_log`, `scar_recall`, `scar_context`, etc. as callable tools. Useful if you want your agent to consult Scar before deploys, DB mutations, or other risky ops.

## CLI

```bash
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

## MCP Tools (optional install)

| Tool | Purpose |
|------|---------|
| `scar_log` | Record a failure with context |
| `scar_update` | Update a scar - record what worked, change resolution |
| `scar_recall` | Find relevant past failures |
| `scar_forget` | Remove a scar |
| `scar_stats` | Aggregate failure patterns |
| `scar_context` | Lightweight count of relevant scars (cheap pre-check) |

## How It Works

1. Stop hook fires when a Claude Code session ends, mines the transcript JSONL for Bash/Edit/Write/Read failures, writes them to SQLite
2. SessionStart hook fires on the next session, reads recent unresolved patterns, prints a briefing into the agent's context
3. Auto-deduplicates identical errors within 5-minute windows
4. (Optional, MCP) Agent calls `scar_context` before risky ops or `scar_recall` when investigating a class of error

## Storage

SQLite database at `~/.cognitive/cognitive.db`. Part of a shared cognitive toolkit foundation - future tools (self-trust calibration, intuition/focus) share the same database.

## License

MIT
