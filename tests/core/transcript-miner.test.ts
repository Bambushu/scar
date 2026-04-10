import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { mineTranscript } from "../../src/core/transcript-miner.js";

function tmpJsonl(lines: object[]): string {
  const path = join(tmpdir(), `scar-test-${randomUUID()}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

const tempFiles: string[] = [];

function makeTmpJsonl(lines: object[]): string {
  const path = tmpJsonl(lines);
  tempFiles.push(path);
  return path;
}

afterEach(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  tempFiles.length = 0;
});

function toolUseEntry(id: string, name: string, input: Record<string, unknown>) {
  return {
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
    type: "assistant",
  };
}

function toolResultEntry(toolUseId: string, content: string, isError: boolean) {
  return {
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }],
    },
    type: "user",
  };
}

describe("mineTranscript", () => {
  it("should extract Bash failures with is_error:true", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Bash", { command: "npm run build" }),
      toolResultEntry("t1", "Exit code 1\nError: Cannot find module 'foo'", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].tool_name).toBe("bash");
    expect(result.failures[0].error_signature).toBe("Exit code 1");
    expect(result.failures[0].what_was_tried).toContain("npm run build");
  });

  it("should extract Edit failures", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Edit", { file_path: "/src/app.ts", old_string: "foo", new_string: "bar" }),
      toolResultEntry("t1", "<tool_use_error>String to replace not found in file.\nString: foo</tool_use_error>", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].tool_name).toBe("edit");
    expect(result.failures[0].error_signature).toBe("String to replace not found in file.");
    expect(result.failures[0].what_was_tried).toContain("/src/app.ts");
  });

  it("should extract Read failures", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Read", { file_path: "/nonexistent.txt" }),
      toolResultEntry("t1", "File does not exist. Note: your current working directory is /Users/test.", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].tool_name).toBe("read");
    expect(result.failures[0].error_signature).toBe("File does not exist. Note: your current working directory is /Users/test.");
    expect(result.failures[0].what_was_tried).toContain("/nonexistent.txt");
  });

  it("should skip cancelled parallel tool calls", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Bash", { command: "ls /foo" }),
      toolResultEntry("t1", "<tool_use_error>Cancelled: parallel tool call Bash(ls /foo) errored</tool_use_error>", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("should skip grep no-match (exit code 1)", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Bash", { command: "grep pattern file.txt" }),
      toolResultEntry("t1", "Exit code 1", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("should skip which/command-v not found", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Bash", { command: "which nonexistent-binary" }),
      toolResultEntry("t1", "Exit code 1", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("should link tool_use to tool_result via tool_use_id", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Bash", { command: "echo hello" }),
      toolResultEntry("t1", "hello", false),
      toolUseEntry("t2", "Read", { file_path: "/missing.ts" }),
      toolResultEntry("t2", "File does not exist.", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].tool_name).toBe("read");
    expect(result.failures[0].what_was_tried).toContain("/missing.ts");
  });

  it("should handle empty and malformed lines gracefully", () => {
    const path = join(tmpdir(), `scar-test-${randomUUID()}.jsonl`);
    tempFiles.push(path);
    writeFileSync(path, [
      "",
      "not valid json",
      JSON.stringify(toolUseEntry("t1", "Bash", { command: "false" })),
      JSON.stringify(toolResultEntry("t1", "Exit code 1\ncommand failed", true)),
      "{}",
      "",
    ].join("\n"));

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(1);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("should infer language from error output", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Bash", { command: "node app.js" }),
      toolResultEntry("t1", "Exit code 1\nTypeError: Cannot read properties of undefined", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures[0].language).toBe("javascript");
  });

  it("should truncate long error text to 500 chars", () => {
    const longError = "Error: " + "x".repeat(600);
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Bash", { command: "broken" }),
      toolResultEntry("t1", longError, true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures[0].what_went_wrong.length).toBeLessThanOrEqual(500);
  });

  it("should handle multiple failures in one transcript", () => {
    const path = makeTmpJsonl([
      toolUseEntry("t1", "Read", { file_path: "/a.ts" }),
      toolResultEntry("t1", "File does not exist.", true),
      toolUseEntry("t2", "Edit", { file_path: "/b.ts", old_string: "x", new_string: "y" }),
      toolResultEntry("t2", "<tool_use_error>String to replace not found in file.</tool_use_error>", true),
      toolUseEntry("t3", "Bash", { command: "npm test" }),
      toolResultEntry("t3", "Exit code 1\n3 tests failed", true),
    ]);

    const result = mineTranscript(path);
    expect(result.failures.length).toBe(3);
    expect(result.failures.map((f) => f.tool_name)).toEqual(["read", "edit", "bash"]);
  });
});
