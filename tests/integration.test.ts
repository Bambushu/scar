import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ScarDatabase } from "../src/core/database.js";
import { ScarMatcher } from "../src/core/matcher.js";
import { createToolHandlers } from "../src/mcp/tools.js";
import { normalizeErrorSignature, isErrorOutput, isUserCorrection } from "../src/adapter/claude-code.js";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "scar-integration-"));
  return join(dir, "cognitive.db");
}

describe("Scar Integration", () => {
  let db: ScarDatabase;
  let matcher: ScarMatcher;
  let handlers: ReturnType<typeof createToolHandlers>;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    db = new ScarDatabase(dbPath);
    matcher = new ScarMatcher(db);
    handlers = createToolHandlers(db, matcher);
  });

  afterEach(() => {
    db.close();
    rmSync(dbPath, { force: true });
  });

  it("full lifecycle: log failure -> recall -> update fix -> verify", async () => {
    // Step 1: Agent encounters an error
    const errorOutput = "TypeError: Cannot read properties of undefined (reading 'map')\n  at processItems (src/handler.ts:42)";
    const signature = normalizeErrorSignature(errorOutput);
    expect(signature).toBe("TypeError: Cannot read properties of undefined (reading 'map')");

    // Step 2: Log the failure via MCP tool
    const logResult = await handlers.scar_log({
      repo: "my-api",
      language: "typescript",
      tool_name: "bash",
      error_type: "runtime",
      error_signature: signature,
      exit_code: 1,
      file_pattern: "src",
      what_was_tried: "Ran npm test to validate handler changes",
      what_went_wrong: "processItems() called .map() on an undefined items array",
      tags: ["null-check", "array", "handler"],
    });

    const logged = JSON.parse(logResult.content[0].text);
    expect(logged.id).toBeDefined();
    expect(logged.resolution_type).toBe("unknown");

    // Step 3: Check context before next action
    const contextResult = await handlers.scar_context({
      repo: "my-api",
      language: "typescript",
    });
    const context = JSON.parse(contextResult.content[0].text);
    expect(context.has_relevant_scars).toBe(true);
    expect(context.relevant_count).toBe(1);

    // Step 4: Recall relevant scars
    const recallResult = await handlers.scar_recall({
      repo: "my-api",
      language: "typescript",
      error_signature: signature,
    });
    const recalled = JSON.parse(recallResult.content[0].text);
    expect(recalled.matches.length).toBe(1);
    expect(recalled.matches[0].scar.what_went_wrong).toContain("undefined items array");

    // Step 5: Agent fixes the issue
    db.update(logged.id, {
      what_worked: "Added null check: const items = data?.items ?? []",
      resolution_type: "fixed",
    });

    const fixed = db.findById(logged.id);
    expect(fixed!.resolution_type).toBe("fixed");
    expect(fixed!.what_worked).toContain("null check");

    // Step 6: Verify stats
    const statsResult = await handlers.scar_stats({});
    const stats = JSON.parse(statsResult.content[0].text);
    expect(stats.total_scars).toBe(1);
    expect(stats.by_resolution.fixed).toBe(1);
  });

  it("dedup flow: same error 3 times, only 1 scar with hit_count 3", async () => {
    const signature = "ENOENT: no such file or directory";

    for (let i = 0; i < 3; i++) {
      await handlers.scar_log({
        repo: "my-app",
        language: "typescript",
        tool_name: "bash",
        error_type: "config",
        error_signature: signature,
        what_was_tried: `Attempt ${i + 1}`,
        what_went_wrong: "File missing",
      });
    }

    const allScars = db.list();
    expect(allScars).toHaveLength(1);
    expect(allScars[0].hit_count).toBe(3);
  });

  it("adapter detection: error output, user correction, signature normalization", () => {
    expect(isErrorOutput({ exitCode: 1, output: "ok" })).toBe(true);
    expect(isErrorOutput({ exitCode: 0, output: "TypeError: nope" })).toBe(true);
    expect(isErrorOutput({ exitCode: 0, output: "All tests passed" })).toBe(false);

    expect(isUserCorrection("no that's wrong, try again")).toBe(true);
    expect(isUserCorrection("great work!")).toBe(false);

    expect(normalizeErrorSignature("\u001b[31mError: bad\u001b[0m\nstack")).toBe("Error: bad");
  });

  it("cross-repo isolation: scars from repo A don't leak into repo B recall", async () => {
    await handlers.scar_log({
      repo: "repo-a",
      language: "python",
      tool_name: "bash",
      error_type: "syntax",
      error_signature: "SyntaxError: invalid syntax",
      what_was_tried: "Ran linter",
      what_went_wrong: "Missing colon",
      tags: ["python-syntax"],
    });

    await handlers.scar_log({
      repo: "repo-b",
      language: "typescript",
      tool_name: "bash",
      error_type: "type",
      error_signature: "TS2345: Argument of type 'string' is not assignable",
      what_was_tried: "Ran tsc",
      what_went_wrong: "Type mismatch",
      tags: ["typescript-types"],
    });

    const result = await handlers.scar_recall({
      repo: "repo-b",
      language: "typescript",
    });
    const data = JSON.parse(result.content[0].text);

    if (data.matches.length > 0) {
      expect(data.matches[0].scar.repo).toBe("repo-b");
    }
  });

  it("forget removes scar from recall", async () => {
    const logResult = await handlers.scar_log({
      repo: "test",
      language: "typescript",
      tool_name: "bash",
      error_type: "runtime",
      error_signature: "Error: whoops",
      what_was_tried: "test",
      what_went_wrong: "broke",
    });
    const scarId = JSON.parse(logResult.content[0].text).id;

    const beforeForget = await handlers.scar_context({ repo: "test" });
    expect(JSON.parse(beforeForget.content[0].text).relevant_count).toBe(1);

    await handlers.scar_forget({ id: scarId });

    const afterForget = await handlers.scar_context({ repo: "test" });
    expect(JSON.parse(afterForget.content[0].text).relevant_count).toBe(0);
  });
});
