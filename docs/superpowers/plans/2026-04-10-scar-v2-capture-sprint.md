# Scar V2.0 Capture Sprint - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Scar accumulate useful failure data by widening the write path (broader hooks) and making the read path unavoidable (session briefing).

**Architecture:** Schema migration adds severity + source columns. A unified PostToolUse hook replaces the Bash-only hook to capture Edit/Write/Read failures. A SessionStart hook auto-surfaces unresolved scars and known fixes per repo. CLAUDE.md gets stronger user-correction enforcement.

**Tech Stack:** TypeScript (better-sqlite3, zod, commander), bash hooks, Claude Code settings.json

**Spec:** `docs/superpowers/specs/2026-04-10-scar-v2-capture-sprint.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/core/schema.ts` | Types: add `Severity`, `ScarSource`, extend records |
| `src/core/database.ts` | Migration V2, extended `getBriefing()` |
| `src/mcp/tools.ts` | Pass severity/source through scar_log handler |
| `src/mcp/server.ts` | Update MCP tool schemas |
| `src/cli/commands/log.ts` | Add `--severity` and `--source` CLI flags |
| `src/cli/commands/briefing.ts` | Add "Known fixes" section to output |
| `hooks/post-tool-failure.sh` | Unified PostToolUse hook (replaces post-bash-failure.sh) |
| `hooks/session-start-briefing.sh` | SessionStart briefing hook |
| `tests/core/database.test.ts` | Migration V2 tests, getBriefing resolved scars |
| `tests/mcp/tools.test.ts` | severity/source in scar_log |
| `tests/hooks/` | Hook script integration tests (optional) |

---

### Task 0: Verify PostToolUse Hook Contract

**Files:**
- Create: `hooks/hook-probe.sh` (temporary, deleted after verification)

This is a gate task. We need to know exactly what JSON Claude Code passes for Edit/Write/Read tool failures before building the unified hook.

- [ ] **Step 1: Create a probe hook that logs all PostToolUse input to a file**

```bash
#!/bin/bash
# Temporary probe to inspect hook payloads
INPUT=$(cat)
echo "$(date -Iseconds) | $INPUT" >> /tmp/scar-hook-probe.log
exit 0
```

- [ ] **Step 2: Register the probe as a PostToolUse hook with no matcher**

Add to `~/.claude/settings.json` under PostToolUse:

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "~/scar/hooks/hook-probe.sh"
    }
  ]
}
```

- [ ] **Step 3: Trigger failures in a test conversation**

In a separate Claude Code session, trigger these failures:
1. Bash: `ls /nonexistent-path-12345` (non-zero exit)
2. Edit: attempt to edit with an `old_string` that doesn't exist in a file
3. Read: attempt to read a nonexistent file
4. Bash success: `echo hello` (to see what success looks like)

- [ ] **Step 4: Inspect the logged payloads**

```bash
cat /tmp/scar-hook-probe.log | jq '.' 2>/dev/null || cat /tmp/scar-hook-probe.log
```

Document:
- What field names does Bash use? (`exitCode` vs `exit_code`, `output` vs `stdout`/`stderr`)
- Does PostToolUse fire for Edit/Write/Read failures, or only for successes?
- What does the `tool_response` contain for each tool on failure?
- Is there a separate `PostToolUseFailure` event, or does everything come through `PostToolUse`?

- [ ] **Step 5: Clean up probe and remove hook registration**

```bash
rm ~/scar/hooks/hook-probe.sh /tmp/scar-hook-probe.log
```

Remove the probe entry from `~/.claude/settings.json`.

- [ ] **Step 6: Document findings**

Update the spec with the actual hook contract. If Edit/Write/Read failures don't come through PostToolUse, note what event they use and adjust Task 5 accordingly.

**No commit for this task - it's investigatory.**

---

### Task 1: Schema Migration V2 - Types

**Files:**
- Modify: `src/core/schema.ts`
- Test: `tests/core/database.test.ts`

- [ ] **Step 1: Write failing test for new fields on ScarRecord**

Add to `tests/core/database.test.ts`:

```typescript
describe("V2 schema", () => {
  it("should create a scar with severity and source fields", () => {
    const input: CreateScarInput = {
      repo: "test-repo",
      language: "typescript",
      tool_name: "bash",
      error_type: "runtime",
      error_signature: "ENOENT: no such file",
      what_was_tried: "ls /nonexistent",
      what_went_wrong: "File not found",
      severity: "high",
      source: "auto-hook",
    };
    const record = db.create(input);
    expect(record.severity).toBe("high");
    expect(record.source).toBe("auto-hook");
  });

  it("should default severity to medium and source to manual", () => {
    const input: CreateScarInput = {
      repo: "test-repo",
      language: "typescript",
      tool_name: "bash",
      error_type: "runtime",
      error_signature: "some error",
      what_was_tried: "something",
      what_went_wrong: "it broke",
    };
    const record = db.create(input);
    expect(record.severity).toBe("medium");
    expect(record.source).toBe("manual");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/scar && npx vitest run tests/core/database.test.ts
```

Expected: FAIL - `severity` and `source` not in `CreateScarInput` type.

- [ ] **Step 3: Add types to schema.ts**

In `src/core/schema.ts`, add the new types and extend existing interfaces:

```typescript
/** Severity level of a scar */
export type Severity = "low" | "medium" | "high";

/** How the scar was captured */
export type ScarSource = "auto-hook" | "manual" | "briefing-follow-up";
```

Add to `ScarRecord`:
```typescript
severity: Severity;
source: ScarSource;
```

Add to `ScarRow`:
```typescript
severity: string;
source: string;
```

Add to `CreateScarInput`:
```typescript
severity?: Severity;
source?: ScarSource;
```

Update `rowToRecord()`:
```typescript
severity: row.severity as Severity,
source: row.source as ScarSource,
```

- [ ] **Step 4: Run test - still fails (DB migration needed)**

```bash
cd ~/scar && npx vitest run tests/core/database.test.ts
```

Expected: FAIL - columns don't exist in SQLite yet.

- [ ] **Step 5: Commit types**

```bash
cd ~/scar && git add src/core/schema.ts tests/core/database.test.ts && git commit -m "feat(schema): add Severity and ScarSource types for V2"
```

---

### Task 2: Schema Migration V2 - Database

**Files:**
- Modify: `src/core/database.ts`
- Test: `tests/core/database.test.ts`

- [ ] **Step 1: Write failing test for V2 migration on fresh DB**

Add to `tests/core/database.test.ts`:

```typescript
describe("V2 migration", () => {
  it("should add severity and source columns to existing V1 database", () => {
    // Create a V1 database manually
    const testPath = join(tmpdir(), `scar-migration-test-${randomUUID()}.db`);
    const rawDb = new Database(testPath);
    rawDb.exec(`
      CREATE TABLE cognitive_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO cognitive_meta (key, value) VALUES ('scar_schema_version', '1');
      CREATE TABLE scars (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        repo TEXT NOT NULL,
        language TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        error_type TEXT NOT NULL,
        error_signature TEXT NOT NULL,
        exit_code INTEGER,
        file_pattern TEXT NOT NULL DEFAULT 'other',
        what_was_tried TEXT NOT NULL,
        what_went_wrong TEXT NOT NULL,
        what_worked TEXT,
        resolution_type TEXT NOT NULL DEFAULT 'unknown',
        tags TEXT NOT NULL DEFAULT '[]',
        hit_count INTEGER NOT NULL DEFAULT 1,
        similarity_score_cache TEXT
      );
      INSERT INTO scars (id, created_at, repo, language, tool_name, error_type, error_signature, what_was_tried, what_went_wrong)
        VALUES ('old-scar', '2026-01-01T00:00:00Z', 'test', 'ts', 'bash', 'runtime', 'old error', 'old try', 'old wrong');
    `);
    rawDb.close();

    // Open with ScarDatabase — should run V2 migration
    const scarDb = new ScarDatabase(testPath);
    const oldScar = scarDb.findById("old-scar");
    expect(oldScar).not.toBeNull();
    expect(oldScar!.severity).toBe("medium");
    expect(oldScar!.source).toBe("manual");

    // New scars should accept severity/source
    const newScar = scarDb.create({
      repo: "test",
      language: "ts",
      tool_name: "edit",
      error_type: "other",
      error_signature: "new error",
      what_was_tried: "new try",
      what_went_wrong: "new wrong",
      severity: "high",
      source: "auto-hook",
    });
    expect(newScar.severity).toBe("high");
    expect(newScar.source).toBe("auto-hook");

    scarDb.close();
    unlinkSync(testPath);
  });
});
```

Add these imports at the top of the test file if not present:
```typescript
import Database from "better-sqlite3";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/scar && npx vitest run tests/core/database.test.ts
```

Expected: FAIL - migration V2 not implemented.

- [ ] **Step 3: Implement V2 migration in database.ts**

Add migration constant after `MIGRATION_V1`:

```typescript
const MIGRATION_V2 = `
ALTER TABLE scars ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE scars ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
`;
```

Update the `migrate()` method:

```typescript
private migrate(): void {
  const version = this.getMetaValue("scar_schema_version");
  if (!version) {
    this.db.transaction(() => {
      this.db.exec(MIGRATION_V1);
      this.setMetaValue("scar_schema_version", "2");
    })();
  } else if (version === "1") {
    this.db.transaction(() => {
      this.db.exec(MIGRATION_V2);
      this.setMetaValue("scar_schema_version", "2");
    })();
  }
}
```

Update the `create()` method to include severity and source in the INSERT:

Add to the INSERT column list: `severity, source`
Add to the VALUES list: `@severity, @source`
Add to the `.run()` params:
```typescript
severity: input.severity ?? "medium",
source: input.source ?? "manual",
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/scar && npx vitest run tests/core/database.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

```bash
cd ~/scar && npm test
```

Expected: ALL 64+ tests pass (existing tests should still work because defaults cover them).

- [ ] **Step 6: Commit**

```bash
cd ~/scar && git add src/core/database.ts tests/core/database.test.ts && git commit -m "feat(db): V2 migration - add severity and source columns"
```

---

### Task 3: MCP Tool Schema + Handler Updates

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing test for scar_log with severity/source**

Add to `tests/mcp/tools.test.ts`:

```typescript
it("should accept severity and source in scar_log", async () => {
  const result = await handlers.scar_log({
    repo: "test",
    language: "typescript",
    tool_name: "edit",
    error_signature: "old_string not found",
    what_was_tried: "Edit file.ts",
    what_went_wrong: "String didn't match",
    severity: "low",
    source: "auto-hook",
  });
  const data = JSON.parse(result.content[0].text);
  expect(data.severity).toBe("low");
  expect(data.source).toBe("auto-hook");
});

it("should default severity to medium and source to manual in scar_log", async () => {
  const result = await handlers.scar_log({
    repo: "test",
    language: "typescript",
    tool_name: "bash",
    error_signature: "some error",
    what_was_tried: "something",
    what_went_wrong: "broke",
  });
  const data = JSON.parse(result.content[0].text);
  expect(data.severity).toBe("medium");
  expect(data.source).toBe("manual");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/scar && npx vitest run tests/mcp/tools.test.ts
```

Expected: FAIL - severity/source not passed through.

- [ ] **Step 3: Update scar_log handler in tools.ts**

In the `scar_log` handler, add to the `input` object:

```typescript
severity: (args.severity as CreateScarInput["severity"]) ?? undefined,
source: (args.source as CreateScarInput["source"]) ?? undefined,
```

- [ ] **Step 4: Update MCP tool schema in server.ts**

Find the `scar_log` tool definition in `server.ts` and add to its `inputSchema.properties`:

```typescript
severity: {
  type: "string",
  enum: ["low", "medium", "high"],
  description: "Severity level. low: typo/wrong flag, medium: broken build/bad config, high: data loss/security/production impact. Defaults to medium.",
},
source: {
  type: "string",
  enum: ["auto-hook", "manual", "briefing-follow-up"],
  description: "How this scar was captured. Defaults to manual.",
},
```

- [ ] **Step 5: Run tests**

```bash
cd ~/scar && npx vitest run tests/mcp/tools.test.ts
```

Expected: ALL PASS

- [ ] **Step 6: Run full test suite**

```bash
cd ~/scar && npm test
```

Expected: ALL pass.

- [ ] **Step 7: Commit**

```bash
cd ~/scar && git add src/mcp/tools.ts src/mcp/server.ts tests/mcp/tools.test.ts && git commit -m "feat(mcp): add severity and source to scar_log tool"
```

---

### Task 4: CLI Log Command Updates

**Files:**
- Modify: `src/cli/commands/log.ts`

- [ ] **Step 1: Read current log.ts to understand structure**

```bash
cat ~/scar/src/cli/commands/log.ts
```

- [ ] **Step 2: Add --severity and --source flags**

Add commander options:

```typescript
.option("--severity <level>", "Severity: low, medium, high", "medium")
.option("--source <source>", "Capture source: auto-hook, manual, briefing-follow-up", "manual")
```

Pass through to `db.create()`:

```typescript
severity: options.severity,
source: options.source,
```

- [ ] **Step 3: Test manually**

```bash
cd ~/scar && node dist/bin/scar.js log -r test -l bash -t bash -e "test error" --tried "test" --wrong "broke" --severity high --source auto-hook
```

Then verify:

```bash
cd ~/scar && node dist/bin/scar.js stats
```

- [ ] **Step 4: Build to ensure compilation**

```bash
cd ~/scar && npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
cd ~/scar && git add src/cli/commands/log.ts && git commit -m "feat(cli): add --severity and --source flags to scar log"
```

---

### Task 5: Unified PostToolUse Hook

**Files:**
- Create: `hooks/post-tool-failure.sh`
- Delete: `hooks/post-bash-failure.sh`
- Modify: `~/.claude/settings.json`

**DEPENDS ON Task 0 findings.** The exact implementation depends on what PostToolUse delivers for non-Bash tools.

- [ ] **Step 1: Build the hook based on Task 0 findings**

Base structure (adjust field names per Task 0 verification):

```bash
#!/bin/bash
# Scar unified capture hook for Claude Code
# Fires on PostToolUse for all tools, filters internally

SCAR_BIN="/Users/mikes/scar/dist/bin/scar.js"
INPUT=$(cat)

TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null)
REPO=$(basename "$CWD" 2>/dev/null || echo "unknown")

handle_bash() {
  local EXIT_CODE COMMAND OUTPUT ERROR_SIG LANG

  EXIT_CODE=$(printf '%s' "$INPUT" | jq -r '.tool_response.exitCode // 0' 2>/dev/null)
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // "unknown"' 2>/dev/null)
  OUTPUT=$(printf '%s' "$INPUT" | jq -r '.tool_response.output // ""' 2>/dev/null)

  # Only log actual failures
  [ "$EXIT_CODE" = "0" ] && return
  [ "$EXIT_CODE" = "null" ] && return
  [ -z "$EXIT_CODE" ] && return

  # Skip trivial failures
  case "$COMMAND" in
    "which "*|"command -v "*) return ;;
    "grep "*|"rg "*) [ "$EXIT_CODE" = "1" ] && return ;;
    "test "*|"[ "*) return ;;
    "ls "*"2>/dev/null"*) return ;;
  esac

  # Detect language from output
  LANG="bash"
  case "$OUTPUT" in
    *TypeError*|*SyntaxError*|*ReferenceError*) LANG="javascript" ;;
    *Traceback*|*ImportError*) LANG="python" ;;
    *panicked*) LANG="rust" ;;
  esac

  # Extract error signature
  ERROR_SIG=$(printf '%s' "$OUTPUT" | grep -m1 -iE '(error|fatal|fail|panic|exception|traceback|denied|not found|ENOENT|EACCES)' | head -c 200)
  [ -z "$ERROR_SIG" ] && ERROR_SIG=$(printf '%s' "$OUTPUT" | tail -1 | head -c 200)

  node "$SCAR_BIN" log -r "$REPO" -l "$LANG" -t bash -e "$ERROR_SIG" \
    --tried "$COMMAND" --wrong "Exit code $EXIT_CODE" \
    --severity medium --source auto-hook --tags "auto-hook" &>/dev/null &
}

handle_edit() {
  # Implementation depends on Task 0 findings
  # If PostToolUse fires for Edit failures with error info:
  local RESPONSE_TEXT FILE_PATH ERROR_SIG

  RESPONSE_TEXT=$(printf '%s' "$INPUT" | jq -r '.tool_response // empty' 2>/dev/null)
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // "unknown"' 2>/dev/null)

  # Check for failure indicators (exact field depends on Task 0)
  echo "$RESPONSE_TEXT" | grep -qi "not found\|not unique\|error\|fail" || return

  ERROR_SIG=$(echo "$RESPONSE_TEXT" | head -c 200)

  node "$SCAR_BIN" log -r "$REPO" -l "unknown" -t edit -e "$ERROR_SIG" \
    --tried "Edit $FILE_PATH" --wrong "$ERROR_SIG" \
    --severity low --source auto-hook --tags "auto-hook" &>/dev/null &
}

handle_write() {
  local RESPONSE_TEXT FILE_PATH ERROR_SIG

  RESPONSE_TEXT=$(printf '%s' "$INPUT" | jq -r '.tool_response // empty' 2>/dev/null)
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // "unknown"' 2>/dev/null)

  echo "$RESPONSE_TEXT" | grep -qi "permission denied\|EACCES\|error\|fail" || return

  ERROR_SIG=$(echo "$RESPONSE_TEXT" | head -c 200)

  node "$SCAR_BIN" log -r "$REPO" -l "unknown" -t write -e "$ERROR_SIG" \
    --tried "Write $FILE_PATH" --wrong "$ERROR_SIG" \
    --severity medium --source auto-hook --tags "auto-hook" &>/dev/null &
}

handle_read() {
  local RESPONSE_TEXT FILE_PATH ERROR_SIG

  RESPONSE_TEXT=$(printf '%s' "$INPUT" | jq -r '.tool_response // empty' 2>/dev/null)
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // "unknown"' 2>/dev/null)

  echo "$RESPONSE_TEXT" | grep -qi "ENOENT\|not found\|no such file\|error" || return

  ERROR_SIG=$(echo "$RESPONSE_TEXT" | head -c 200)

  node "$SCAR_BIN" log -r "$REPO" -l "unknown" -t read -e "$ERROR_SIG" \
    --tried "Read $FILE_PATH" --wrong "$ERROR_SIG" \
    --severity low --source auto-hook --tags "auto-hook" &>/dev/null &
}

case "$TOOL" in
  Bash)  handle_bash ;;
  Edit)  handle_edit ;;
  Write) handle_write ;;
  Read)  handle_read ;;
  *)     exit 0 ;;
esac

exit 0
```

**NOTE:** The `handle_edit`, `handle_write`, and `handle_read` functions are templates. After Task 0, update them to match the actual hook payload structure. If Edit/Write/Read failures fire a different event (e.g., PostToolUseFailure), register a second hook for that event instead.

- [ ] **Step 2: Make hook executable**

```bash
chmod +x ~/scar/hooks/post-tool-failure.sh
```

- [ ] **Step 3: Update settings.json - replace old Bash hook with unified hook**

In `~/.claude/settings.json`, replace the Bash-matcher PostToolUse hook:

Old:
```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "~/scar/hooks/post-bash-failure.sh"
    }
  ]
}
```

New:
```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "~/scar/hooks/post-tool-failure.sh"
    }
  ]
}
```

- [ ] **Step 4: Test with a deliberate Bash failure**

```bash
ls /this-path-does-not-exist-12345
```

Then check:

```bash
cd ~/scar && node dist/bin/scar.js stats
```

Expected: A new scar with source `auto-hook` and severity `medium`.

- [ ] **Step 5: Test with a deliberate Edit failure (if supported)**

Try to edit a file with an `old_string` that doesn't exist. Check if a scar appears.

- [ ] **Step 6: Delete old hook**

```bash
rm ~/scar/hooks/post-bash-failure.sh
```

- [ ] **Step 7: Commit**

```bash
cd ~/scar && git add hooks/post-tool-failure.sh && git rm hooks/post-bash-failure.sh && git commit -m "feat(hooks): unified PostToolUse hook replacing Bash-only hook"
```

---

### Task 6: SessionStart Briefing - Extended getBriefing()

**Files:**
- Modify: `src/core/database.ts`
- Modify: `src/cli/commands/briefing.ts`
- Test: `tests/core/database.test.ts`

- [ ] **Step 1: Write failing test for resolved scars in briefing**

Add to `tests/core/database.test.ts`:

```typescript
describe("getBriefing with resolved scars", () => {
  it("should return both unresolved and resolved scars with what_worked", () => {
    // Create unresolved scars
    db.create({
      repo: "test-repo",
      language: "ts",
      tool_name: "bash",
      error_type: "runtime",
      error_signature: "unresolved error 1",
      what_was_tried: "something",
      what_went_wrong: "broke",
    });

    // Create resolved scar with what_worked
    const resolved = db.create({
      repo: "test-repo",
      language: "ts",
      tool_name: "bash",
      error_type: "config",
      error_signature: "config error",
      what_was_tried: "bad config",
      what_went_wrong: "wrong format",
    });
    db.update(resolved.id, {
      what_worked: "use YAML not JSON",
      resolution_type: "fixed",
    });

    const result = db.getBriefing("test-repo");
    expect(result.totalUnresolved).toBe(1);
    expect(result.entries.length).toBe(1);
    expect(result.resolvedEntries).toBeDefined();
    expect(result.resolvedEntries.length).toBe(1);
    expect(result.resolvedEntries[0].what_worked).toBe("use YAML not JSON");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/scar && npx vitest run tests/core/database.test.ts
```

Expected: FAIL - `resolvedEntries` not in return type.

- [ ] **Step 3: Extend getBriefing() in database.ts**

Update the return type and add a resolved query:

```typescript
getBriefing(repo?: string): { entries: BriefingEntry[]; resolvedEntries: BriefingEntry[]; totalUnresolved: number } {
  // ... existing unresolved query stays the same ...

  // Add resolved query
  let resolvedQuery = `
    SELECT id, error_signature, what_went_wrong, what_worked, resolution_type, repo, hit_count, created_at
    FROM scars
    WHERE resolution_type = 'fixed' AND what_worked IS NOT NULL`;
  const resolvedParams: Record<string, string | number> = {};

  if (repo) {
    resolvedQuery += " AND repo = @repo";
    resolvedParams.repo = repo;
  }

  resolvedQuery += " ORDER BY hit_count DESC, created_at DESC LIMIT @limit";
  resolvedParams.limit = 3;

  const resolvedRows = this.db.prepare(resolvedQuery).all(resolvedParams) as BriefingEntry[];

  return { entries: rows, resolvedEntries: resolvedRows, totalUnresolved: countRow.cnt };
}
```

- [ ] **Step 4: Update briefing.ts output format**

Update `src/cli/commands/briefing.ts` to include the "Known fixes" section:

```typescript
export function runBriefing(options: BriefingOptions = {}): string {
  const db = new ScarDatabase(options.dbPath);
  try {
    const { entries, resolvedEntries, totalUnresolved } = db.getBriefing(options.repo);

    if (entries.length === 0 && resolvedEntries.length === 0) {
      return "";  // Silent when no scars
    }

    const lines: string[] = [];
    lines.push(`Scar briefing for ${options.repo ?? "all repos"}:`);

    if (entries.length > 0) {
      lines.push(`${totalUnresolved} unresolved:`);
      for (const e of entries) {
        lines.push(`  ${e.error_signature} - unresolved (hit ${e.hit_count}x)`);
      }
      if (totalUnresolved > entries.length) {
        lines.push(`  ... and ${totalUnresolved - entries.length} more.`);
      }
    }

    if (resolvedEntries.length > 0) {
      lines.push("");
      lines.push("Known fixes:");
      for (const e of resolvedEntries) {
        lines.push(`  ${e.error_signature} - fix: ${e.what_worked}`);
      }
    }

    return lines.join("\n");
  } finally {
    db.close();
  }
}
```

- [ ] **Step 5: Update tools.ts to match new getBriefing return type**

In `src/mcp/tools.ts`, update the `scar_briefing` handler to use `resolvedEntries`:

```typescript
async scar_briefing(args) {
  const repo = args.repo as string | undefined;
  const { entries, resolvedEntries, totalUnresolved } = db.getBriefing(repo);

  if (entries.length === 0 && resolvedEntries.length === 0) {
    const briefing: ScarBriefing = {
      repo: repo ?? null,
      entries: [],
      resolvedEntries: [],
      total_unresolved: 0,
      message: "No unresolved scars. Clean slate.",
    };
    return jsonResponse(briefing);
  }

  const lines = entries.map((e, i) => {
    const status = `unresolved (hit ${e.hit_count}x)`;
    return `${i + 1}. ${e.error_signature} - ${status}`;
  });

  const fixLines = resolvedEntries.map((e, i) => {
    return `${i + 1}. ${e.error_signature} - fix: ${e.what_worked}`;
  });

  let message = `${totalUnresolved} unresolved scar(s)${repo ? ` for ${repo}` : ""}:\n${lines.join("\n")}`;
  if (fixLines.length > 0) {
    message += `\n\nKnown fixes:\n${fixLines.join("\n")}`;
  }

  const briefing: ScarBriefing = {
    repo: repo ?? null,
    entries,
    resolvedEntries,
    total_unresolved: totalUnresolved,
    message,
  };
  return jsonResponse(briefing);
},
```

- [ ] **Step 6: Update ScarBriefing type in schema.ts**

Add `resolvedEntries` to the interface:

```typescript
export interface ScarBriefing {
  repo: string | null;
  entries: BriefingEntry[];
  resolvedEntries: BriefingEntry[];
  total_unresolved: number;
  message: string;
}
```

- [ ] **Step 7: Run tests**

```bash
cd ~/scar && npm test
```

Expected: ALL pass.

- [ ] **Step 8: Build**

```bash
cd ~/scar && npm run build
```

- [ ] **Step 9: Commit**

```bash
cd ~/scar && git add src/core/database.ts src/core/schema.ts src/cli/commands/briefing.ts src/mcp/tools.ts tests/core/database.test.ts && git commit -m "feat(briefing): add known fixes section with resolved scars"
```

---

### Task 7: SessionStart Briefing Hook

**Files:**
- Create: `hooks/session-start-briefing.sh`
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: Create the briefing hook script**

```bash
#!/bin/bash
# Scar session-start briefing hook
# Surfaces unresolved scars and known fixes for the current repo

SCAR_BIN="/Users/mikes/scar/dist/bin/scar.js"
INPUT=$(cat)

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null)
REPO=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Run briefing - output goes to stdout, surfaced in conversation
OUTPUT=$(node "$SCAR_BIN" briefing --repo "$REPO" 2>/dev/null)

# Only output if there's something to say
if [ -n "$OUTPUT" ]; then
  echo "$OUTPUT"
fi

exit 0
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/scar/hooks/session-start-briefing.sh
```

- [ ] **Step 3: Register in settings.json**

Add to the `SessionStart` array in `~/.claude/settings.json`:

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "~/scar/hooks/session-start-briefing.sh"
    }
  ]
}
```

- [ ] **Step 4: Test manually**

```bash
echo '{"cwd": "/Users/mikes/scar"}' | ~/scar/hooks/session-start-briefing.sh
```

Expected: Either briefing output or empty (if no scars for "scar" repo).

- [ ] **Step 5: Commit**

```bash
cd ~/scar && git add hooks/session-start-briefing.sh && git commit -m "feat(hooks): SessionStart briefing hook for per-repo scar primer"
```

---

### Task 8: CLAUDE.md User Correction Enforcement

**Files:**
- Modify: `~/.claude/CLAUDE.md`

- [ ] **Step 1: Replace the existing Scar section in CLAUDE.md**

Find and replace the current `## Scar - Failure Memory` section with:

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

- [ ] **Step 2: Verify no broken formatting**

Read the CLAUDE.md file and confirm the section looks correct in context.

- [ ] **Step 3: Commit**

```bash
cd ~ && git add .claude/CLAUDE.md && git commit -m "docs: stronger Scar user-correction enforcement in CLAUDE.md"
```

---

### Task 9: Integration Test - End to End

**Files:** None (verification only)

- [ ] **Step 1: Build everything**

```bash
cd ~/scar && npm run build
```

- [ ] **Step 2: Run full test suite**

```bash
cd ~/scar && npm test
```

Expected: ALL pass.

- [ ] **Step 3: Trigger a real Bash failure and verify capture**

```bash
ls /nonexistent-scar-test-path-99999
```

Then:

```bash
cd ~/scar && node dist/bin/scar.js stats
```

Expected: At least 1 new scar with `source: auto-hook`, `severity: medium`.

- [ ] **Step 4: Check briefing output**

```bash
cd ~/scar && node dist/bin/scar.js briefing
```

Expected: Shows unresolved scars.

- [ ] **Step 5: Test scar_log via MCP with severity**

Use the `scar_log` MCP tool to log a manual scar with severity `high` and source `manual`. Verify it appears in stats.

- [ ] **Step 6: Verify briefing hook works**

```bash
echo '{"cwd": "/Users/mikes/scar"}' | ~/scar/hooks/session-start-briefing.sh
```

Expected: Briefing output with the scars created above.

- [ ] **Step 7: Final commit if any cleanup needed**

```bash
cd ~/scar && git status
```

If clean: done. If changes: commit with appropriate message.
