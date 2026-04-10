# Scar V2.0 - Capture Sprint

**Date:** 2026-04-10
**Goal:** Make Scar actually accumulate useful failure data by widening the write path and making the read path unavoidable.

**Problem:** After days of use, Scar has 1 scar in the DB. The only auto-capture is a Bash exit-code hook. Most agent work (Edit/Write/Read) is invisible. Manual logging via CLAUDE.md is honor-system and never happens. The read path (briefing) is never triggered.

**Philosophy:** The write path must be as automatic as possible. The read path must be unavoidable. Flip both, and the flywheel starts.

**Review notes (adversarial review 2026-04-10):**
- Section 5 (retry detection) deferred to V2.1 - too many edge cases (race conditions, PPID fragility, command normalization) for too little value at N=1 data points.
- Severity: add column now (avoids second migration) but default everything to `medium`. No auto-inference logic yet - let AI override manually via `--severity` flag.
- CRITICAL: Must verify Claude Code PostToolUse hook contract for non-Bash tools before building Section 3. If `tool_response` is not available for Edit/Write/Read, redesign needed.
- Default unknown Bash failures to `medium` not `low`.

---

## Section 1: Schema Migration (V1 -> V2)

Add two columns to the `scars` table:

```sql
ALTER TABLE scars ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE scars ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
```

### severity

Three levels:

| Level | Examples |
|-------|----------|
| `low` | Wrong flag, typo, grep miss, Edit old_string not found |
| `medium` | Broken build, failed test, bad config, Write permission denied |
| `high` | Data loss, security issue, production impact, destructive op failure |

### source

Tracks how the scar was captured:

| Value | Meaning |
|-------|---------|
| `auto-hook` | Captured by PostToolUse or SessionStart hook |
| `manual` | Logged by the AI via scar_log MCP tool |
| `briefing-follow-up` | Logged after reviewing a briefing |

### Implementation

- `src/core/schema.ts`: Add `Severity` and `ScarSource` types. Add fields to `ScarRecord`, `ScarRow`, `CreateScarInput`.
- `src/core/database.ts`: Add `MIGRATION_V2` with ALTER TABLE statements. Update `migrate()` to check schema version and run V2 if needed.
- Schema version detected via `cognitive_meta` table (key: `scar_schema_version`), already exists from V1. Migration checks version = '1' and runs V2 ALTER TABLE statements.
- Tests: Verify migration runs cleanly on existing V1 databases, new fields have correct defaults.

---

## Section 2: SessionStart Briefing Hook

A shell script `hooks/session-start-briefing.sh` that fires on every Claude Code session start.

### Behavior

1. Derives repo name from CWD (`basename`)
2. Runs `node ~/scar/dist/bin/scar.js briefing --repo <repo>`
3. Outputs briefing text to stdout (Claude Code surfaces this in conversation)
4. If 0 scars: outputs nothing (silent, no noise)

### Briefing format

Two sections - unresolved warnings + resolved immune knowledge:

```
Scar briefing for <repo>:
<N> unresolved:
  1. <error_signature> - unresolved (hit Nx)
  2. ...

Known fixes:
  1. <error_signature> - fix: <what_worked>
  2. ...
```

- Top 5 unresolved scars (sorted by hit_count DESC, then created_at DESC)
- Up to 3 resolved scars with `what_worked` populated (the actual immune memory)
- Repo-scoped only (no cross-repo pattern matching)

### Implementation

- `hooks/session-start-briefing.sh`: New shell script.
- `src/core/database.ts`: Extend `getBriefing()` to also return top resolved scars with `what_worked`.
- `src/cli/commands/briefing.ts`: Update output format to include "Known fixes" section.
- `~/.claude/settings.json`: Register under `SessionStart` array with empty matcher.

---

## Section 3: Transcript Miner (replaces PostToolUse hook approach)

**Pre-flight finding (2026-04-10):** PostToolUse hooks ONLY fire on successful tool calls. Failed tool calls (Edit string not found, Read file not found, Bash crashes) never reach hooks. The V1 Bash failure hook was dead code — it read an `exitCode` field that doesn't exist in the payload. Confirmed by probe testing.

**New approach:** Mine the session transcript JSONL file, which contains ALL tool calls (successes and failures) with full context.

### How it works

Every Claude Code session writes a complete JSONL transcript to `~/.claude/projects/.../session-id.jsonl`. Each line is a JSON object. Tool failures have `is_error: true` in the tool_result content.

A Node.js transcript miner script:
1. Reads the JSONL transcript line by line
2. Extracts entries with `is_error: true` or error patterns in tool results
3. Classifies by tool type (Edit, Read, Write, Bash)
4. Bulk-logs failures to Scar via the core database API
5. Tracks mined transcripts to avoid re-processing

### Hook architecture

| Hook | Role | Reliability |
|------|------|------------|
| **SessionStart** | Primary — mines ALL un-mined previous transcripts | Guaranteed (always fires) |
| **Stop** | Fast path — mines current session immediately | Best-effort (skipped on Ctrl-C, crash) |

SessionStart is the guaranteed path. Stop is the fast path for immediate feedback.

### Capture matrix

| Tool | Failure signal in transcript | Default severity |
|------|------------------------------|-----------------|
| Edit | `is_error: true`, "String to replace not found" | `medium` |
| Read | `is_error: true`, "File does not exist" | `medium` |
| Write | `is_error: true`, permission/path errors | `medium` |
| Bash | `is_error: true`, non-zero exit, error patterns in output | `medium` |

### Skip list

- Cancelled parallel tool calls (error is just "Cancelled: parallel tool call X errored")
- `grep`/`rg` no-match (exit 1 but not a real failure)
- `which`/`command -v` not found
- `test`/`[` checks

### Tracking mined transcripts

A `mined_sessions` table in cognitive.db (or a simple text file at `~/.cognitive/scar/mined.log`) tracks which transcript files have been processed. SessionStart checks this before mining.

### Privacy

The miner reads full transcripts but only extracts and stores error-related entries. Document this explicitly for the open-source release.

### Risk: undocumented transcript format

Claude Code's JSONL format is internal and can change without notice. Mitigate with:
- Validate expected fields before parsing
- Fail gracefully (skip unparseable lines, don't crash)
- Log a warning if format seems changed

### Severity

All auto-captured scars default to `medium`. AI can override via `--severity` flag on `scar log` or the MCP tool. No auto-inference logic in V2.0.

### Implementation

- `src/core/transcript-miner.ts`: Node.js module that parses JSONL transcripts and extracts failures
- `src/cli/commands/mine.ts`: CLI command `scar mine <transcript-path>` (also callable from hooks)
- `hooks/session-start-briefing.sh`: Extended to mine previous transcripts before showing briefing
- `hooks/stop-mine.sh`: Stop hook that mines current session transcript
- `src/cli/commands/log.ts`: Add `--severity` and `--source` flags
- `src/mcp/server.ts`: Update scar_log tool schema for severity and source
- `src/mcp/tools.ts`: Pass severity and source through
- `~/.claude/settings.json`: Replace old Bash-only hook, add Stop hook
- Delete `hooks/post-bash-failure.sh`

---

## Section 4: User Correction Enforcement

No hook available for post-user-message. Enforcement is via stronger CLAUDE.md instructions.

### Updated CLAUDE.md section

```markdown
## Scar - Failure Memory (MANDATORY)

### Auto-captured (no action needed)
Bash, Edit, Write, and Read failures are auto-captured by hooks.

### YOU must capture (non-negotiable)
When the user corrects you ("no", "wrong", "not that", "undo", "revert",
"start over", "that broke X", "not what I asked"):

1. STOP. Before your next tool call, call `scar_log` with:
   - repo: current repo
   - tool_name: the tool you used wrong
   - error_signature: one-line summary of the mistake
   - what_was_tried: what you did
   - what_went_wrong: what the user said was wrong
   - severity: your honest assessment (low/medium/high)
   - tags: ["user-correction"]
2. THEN proceed with the corrected approach.

Skipping this step is like a pilot ignoring a near-miss report.
The whole cognitive toolkit depends on honest capture.

### Before risky operations
Call `scar_context` before: deploy commands, database mutations,
destructive git ops, or anything you've seen fail before in this repo.
```

### Key changes from V1 instructions

- "MANDATORY" and "non-negotiable" language
- Concrete trigger phrases listed
- STOP-before-next-tool-call sequencing
- Role framing analogy (pilot near-miss)
- Reduced manual scope (only user corrections, everything else is auto)

---

## Section 5: Retry Detection (DEFERRED to V2.1)

Deferred per adversarial review. Edge cases (race conditions on session file, PPID fragility, command normalization) outweigh value at current data volume. Revisit when Scar has 50+ scars and we can validate whether retry loops are a real pattern.

---

## Files Changed

| File | Change |
|------|--------|
| `src/core/schema.ts` | New types: `Severity`, `ScarSource`. Extended `ScarRecord`, `CreateScarInput` |
| `src/core/database.ts` | Migration V2, extended `getBriefing()` for resolved scars |
| `src/core/transcript-miner.ts` | NEW: JSONL transcript parser, failure extractor |
| `src/cli/commands/mine.ts` | NEW: `scar mine <path>` CLI command |
| `src/mcp/tools.ts` | severity/source in scar_log handler |
| `src/mcp/server.ts` | Updated tool schemas for severity/source |
| `src/cli/commands/log.ts` | `--severity` and `--source` flags |
| `src/cli/commands/briefing.ts` | "Known fixes" section in output |
| `hooks/session-start-briefing.sh` | New briefing hook (also mines un-mined transcripts) |
| `hooks/stop-mine.sh` | NEW: Stop hook for fast-path transcript mining |
| `~/.claude/CLAUDE.md` | Updated Scar instructions |
| `~/.claude/settings.json` | Hook registrations updated |
| Tests | New tests for migration, severity, briefing format, transcript miner |

## Out of Scope

- V2.1 Resolution chains (`resolved_by_commit`, `preceded_by_scar_id`)
- V2.1 Retry detection (session state tracking)
- V2.2 Semantic fallback (embeddings)
- V2.2 User correction detection from transcripts (ambiguous patterns, defer to V2)
- V2.3 Async recall
- Cross-repo pattern matching in briefings
- `--quiet` flag for briefing suppression
