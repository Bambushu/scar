# Scar V2.0 - Capture Sprint

**Date:** 2026-04-10
**Goal:** Make Scar actually accumulate useful failure data by widening the write path and making the read path unavoidable.

**Problem:** After days of use, Scar has 1 scar in the DB. The only auto-capture is a Bash exit-code hook. Most agent work (Edit/Write/Read) is invisible. Manual logging via CLAUDE.md is honor-system and never happens. The read path (briefing) is never triggered.

**Philosophy:** The write path must be as automatic as possible. The read path must be unavoidable. Flip both, and the flywheel starts.

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
- `src/shared/constants.ts`: Add severity inference patterns.
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

## Section 3: Unified Tool Capture Hook

Replace `hooks/post-bash-failure.sh` with `hooks/post-tool-failure.sh` - one hook that handles all tool types.

### Registration

PostToolUse hook with no matcher (fires on all tools), filters internally by tool_name.

### Capture matrix

| Tool | Failure signal | Default severity |
|------|---------------|-----------------|
| Bash | Non-zero exit code | Inferred from pattern |
| Bash (destructive) | `rm -rf`, `git push --force`, `drop table` failed | `high` |
| Bash (build/test) | `npm test`, `vitest`, `tsc`, `build` failed | `medium` |
| Edit | `old_string` not found / not unique | `low` |
| Write | Permission denied, path not found | `medium` |
| Read | File not found (ENOENT) | `low` |

### Skip list (same philosophy as V1)

- `grep`/`rg` exit code 1 (no match)
- `which`/`command -v` not found
- `test`/`[` checks
- `ls` with suppressed stderr
- Exploratory Read on nonexistent files

### Severity auto-inference for Bash

```bash
case "$COMMAND" in
  *"rm -rf"*|*"git push --force"*|*"drop table"*) SEVERITY="high" ;;
  *"npm test"*|*"vitest"*|*"tsc"*|*"build"*) SEVERITY="medium" ;;
  *) SEVERITY="low" ;;
esac
```

### Implementation

- `hooks/post-tool-failure.sh`: New unified hook with case statement per tool type.
- `src/cli/commands/log.ts`: Add `--severity` and `--source` flags.
- `src/mcp/server.ts`: Update scar_log tool schema to include severity and source parameters.
- `src/mcp/tools.ts`: Pass severity and source through to database.
- `~/.claude/settings.json`: Replace old Bash-only hook with new unified hook.
- Delete `hooks/post-bash-failure.sh`.

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

## Section 5: Retry Detection

Detects "spinning wheels" - agent hitting the same target 3+ times in a session.

### Session state file

`/tmp/scar-session-<PPID>.json`:

```json
{
  "tool_targets": {
    "Edit:/Users/mikes/bonuswijs/src/app/page.tsx": 3,
    "Bash:npm run build": 2
  },
  "logged": {
    "Edit:/Users/mikes/bonuswijs/src/app/page.tsx": true
  },
  "session_start": "2026-04-10T19:00:00Z"
}
```

### How it works

1. The unified `post-tool-failure.sh` hook fires on every PostToolUse (success AND failure)
2. Increments target counter in session file
3. Key format: `<Tool>:<target>` (file_path for Edit/Write/Read, normalized command for Bash)
4. At count >= 3, auto-log a scar:
   - `error_signature`: "Retry loop: <target> attempted Nx in session"
   - `severity`: `medium`
   - `source`: `auto-hook`
   - `tags`: `["retry-loop"]`
5. Only fires once per target per session (tracked in `logged` map)

### Bash command normalization

Strip varying arguments to detect same-intent commands:
- `npm test src/foo.test.ts` and `npm test src/bar.test.ts` -> `npm test`
- `git add file1.ts` and `git add file2.ts` -> `git add`

### Cleanup

SessionStart hook deletes stale `/tmp/scar-session-*.json` files from previous sessions.

### Why /tmp not SQLite

Ephemeral per-session state. The scar it produces goes in SQLite, but counters don't need to survive restarts.

---

## Files Changed

| File | Change |
|------|--------|
| `src/core/schema.ts` | New types: `Severity`, `ScarSource`. Extended `ScarRecord`, `CreateScarInput` |
| `src/core/database.ts` | Migration V2, extended `getBriefing()` for resolved scars |
| `src/mcp/tools.ts` | severity/source in scar_log handler |
| `src/mcp/server.ts` | Updated tool schemas for severity/source |
| `src/cli/commands/log.ts` | `--severity` and `--source` flags |
| `src/cli/commands/briefing.ts` | "Known fixes" section in output |
| `src/shared/constants.ts` | Severity inference patterns |
| `hooks/post-tool-failure.sh` | New unified hook (replaces post-bash-failure.sh) |
| `hooks/session-start-briefing.sh` | New briefing hook |
| `~/.claude/CLAUDE.md` | Updated Scar instructions |
| `~/.claude/settings.json` | Hook registrations updated |
| Tests | New tests for migration, severity, briefing format, retry detection |

## Out of Scope

- V2.1 Resolution chains (`resolved_by_commit`, `preceded_by_scar_id`)
- V2.2 Semantic fallback (embeddings)
- V2.3 Async recall
- Cross-repo pattern matching in briefings
- `--quiet` flag for briefing suppression
