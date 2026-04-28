import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runInit } from "../../src/cli/commands/init.js";

describe("scar init", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates cognitive directory and database", () => {
    tempDir = mkdtempSync(join(tmpdir(), "scar-init-test-"));
    const cognitiveDir = join(tempDir, ".cognitive");
    const dbPath = join(cognitiveDir, "cognitive.db");
    runInit({ cognitiveDir, dbPath });
    expect(existsSync(cognitiveDir)).toBe(true);
    expect(existsSync(join(cognitiveDir, "scar"))).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("does not generate MCP config by default", () => {
    tempDir = mkdtempSync(join(tmpdir(), "scar-init-test-"));
    const cognitiveDir = join(tempDir, ".cognitive");
    const dbPath = join(cognitiveDir, "cognitive.db");
    const result = runInit({ cognitiveDir, dbPath });
    expect(result.mcpConfig).toBeUndefined();
  });

  it("generates MCP config snippet when withMcp is set", () => {
    tempDir = mkdtempSync(join(tmpdir(), "scar-init-test-"));
    const cognitiveDir = join(tempDir, ".cognitive");
    const dbPath = join(cognitiveDir, "cognitive.db");
    const result = runInit({ cognitiveDir, dbPath, withMcp: true });
    expect(result.mcpConfig).toBeDefined();
    expect(result.mcpConfig!.scar.command).toContain("scar-mcp");
  });

  it("generates Claude Code hook config when requested", () => {
    tempDir = mkdtempSync(join(tmpdir(), "scar-init-test-"));
    const cognitiveDir = join(tempDir, ".cognitive");
    const dbPath = join(cognitiveDir, "cognitive.db");
    const result = runInit({ cognitiveDir, dbPath, claudeCode: true });
    expect(result.claudeCodeHooks).toBeDefined();
    expect(result.claudeCodeHooks!.hooks).toBeDefined();
  });
});
