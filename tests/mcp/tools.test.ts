import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ScarDatabase } from "../../src/core/database.js";
import { ScarMatcher } from "../../src/core/matcher.js";
import { createToolHandlers, type ToolHandlers } from "../../src/mcp/tools.js";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "scar-tools-test-"));
  return join(dir, "cognitive.db");
}

describe("MCP Tool Handlers", () => {
  let db: ScarDatabase;
  let matcher: ScarMatcher;
  let handlers: ToolHandlers;
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

  describe("scar_log", () => {
    it("creates a new scar and returns it", async () => {
      const result = await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "TypeError: foo is not a function",
        what_was_tried: "Called foo()",
        what_went_wrong: "foo was undefined",
      });

      expect(result.content[0].type).toBe("text");
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBeDefined();
      expect(data.repo).toBe("test-repo");
      expect(data.resolution_type).toBe("unknown");
    });

    it("deduplicates within 5-min window", async () => {
      await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "TypeError: foo is not a function",
        what_was_tried: "Called foo()",
        what_went_wrong: "foo was undefined",
      });

      const result2 = await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "TypeError: foo is not a function",
        what_was_tried: "Called foo() again",
        what_went_wrong: "Still undefined",
      });

      const data = JSON.parse(result2.content[0].text);
      expect(data.deduplicated).toBe(true);
      expect(data.hit_count).toBe(2);
    });

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
  });

  describe("scar_recall", () => {
    it("returns matching scars", async () => {
      await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "TypeError: foo",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });

      const result = await handlers.scar_recall({
        repo: "test-repo",
        language: "typescript",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.matches.length).toBeGreaterThanOrEqual(1);
      expect(data.matches[0].scar).toBeDefined();
      expect(data.matches[0].score).toBeDefined();
    });

    it("returns empty matches for no hits", async () => {
      const result = await handlers.scar_recall({
        repo: "nonexistent",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.matches).toHaveLength(0);
    });
  });

  describe("scar_update", () => {
    it("updates what_worked and resolution_type", async () => {
      const logResult = await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "TypeError: oops",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });
      const scarId = JSON.parse(logResult.content[0].text).id;

      const result = await handlers.scar_update({
        id: scarId,
        what_worked: "Added null check",
        resolution_type: "fixed",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.what_worked).toBe("Added null check");
      expect(data.resolution_type).toBe("fixed");
    });

    it("returns error for non-existent scar", async () => {
      const result = await handlers.scar_update({
        id: "fake-id",
        what_worked: "something",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.updated).toBe(false);
    });
  });

  describe("scar_forget", () => {
    it("deletes an existing scar", async () => {
      const logResult = await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "TypeError",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });
      const scarId = JSON.parse(logResult.content[0].text).id;

      const result = await handlers.scar_forget({ id: scarId });
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(true);
    });

    it("returns false for non-existent scar", async () => {
      const result = await handlers.scar_forget({ id: "fake-id" });
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(false);
    });
  });

  describe("scar_stats", () => {
    it("returns aggregate statistics", async () => {
      await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "Error1",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });

      const result = await handlers.scar_stats({});
      const data = JSON.parse(result.content[0].text);
      expect(data.total_scars).toBe(1);
      expect(data.by_error_type.runtime).toBe(1);
    });
  });

  describe("scar_context", () => {
    it("returns count of relevant scars", async () => {
      await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "Error1",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });

      const result = await handlers.scar_context({
        repo: "test-repo",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.relevant_count).toBe(1);
      expect(data.has_relevant_scars).toBe(true);
    });

    it("returns zero for no relevant scars", async () => {
      const result = await handlers.scar_context({
        repo: "empty-repo",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.relevant_count).toBe(0);
      expect(data.has_relevant_scars).toBe(false);
    });
  });

  describe("scar_briefing", () => {
    it("returns clean slate when no scars exist", async () => {
      const result = await handlers.scar_briefing({});
      const data = JSON.parse(result.content[0].text);
      expect(data.entries).toHaveLength(0);
      expect(data.total_unresolved).toBe(0);
      expect(data.message).toContain("Clean slate");
    });

    it("returns unresolved scars with human-readable message", async () => {
      await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "TypeError: foo is not a function",
        what_was_tried: "Called foo()",
        what_went_wrong: "foo was undefined",
      });

      const result = await handlers.scar_briefing({ repo: "test-repo" });
      const data = JSON.parse(result.content[0].text);
      expect(data.total_unresolved).toBe(1);
      expect(data.entries).toHaveLength(1);
      expect(data.repo).toBe("test-repo");
      expect(data.message).toContain("TypeError: foo is not a function");
    });

    it("excludes fixed scars from briefing", async () => {
      const logResult = await handlers.scar_log({
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "Error: fixed one",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });
      const scarId = JSON.parse(logResult.content[0].text).id;
      await handlers.scar_update({ id: scarId, resolution_type: "fixed", what_worked: "patched it" });

      const result = await handlers.scar_briefing({});
      const data = JSON.parse(result.content[0].text);
      expect(data.entries).toHaveLength(0);
      expect(data.message).toContain("Clean slate");
    });

    it("returns all repos when repo is omitted", async () => {
      await handlers.scar_log({
        repo: "repo-a",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "Error A",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });
      await handlers.scar_log({
        repo: "repo-b",
        language: "python",
        tool_name: "bash",
        error_type: "config",
        error_signature: "Error B",
        what_was_tried: "test",
        what_went_wrong: "failed",
      });

      const result = await handlers.scar_briefing({});
      const data = JSON.parse(result.content[0].text);
      expect(data.total_unresolved).toBe(2);
      expect(data.entries).toHaveLength(2);
      expect(data.repo).toBeNull();
    });
  });
});
