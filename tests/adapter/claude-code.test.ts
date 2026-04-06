import { describe, it, expect } from "vitest";
import {
  generateClaudeCodeHooks,
  isErrorOutput,
  isUserCorrection,
  normalizeErrorSignature,
} from "../../src/adapter/claude-code.js";

describe("Claude Code Adapter", () => {
  describe("generateClaudeCodeHooks", () => {
    it("returns hook configuration object", () => {
      const config = generateClaudeCodeHooks();
      expect(config.hooks).toBeDefined();
      expect(config.hooks.post_tool_call).toBeDefined();
      expect(config.hooks.post_tool_call.description).toContain("error");
    });

    it("includes all three hook types", () => {
      const config = generateClaudeCodeHooks();
      expect(config.hooks.post_tool_call).toBeDefined();
      expect(config.hooks.user_correction).toBeDefined();
      expect(config.hooks.revert_detection).toBeDefined();
    });
  });

  describe("isErrorOutput", () => {
    it("detects non-zero exit code", () => {
      expect(isErrorOutput({ exitCode: 1, output: "" })).toBe(true);
    });

    it("detects error patterns in output", () => {
      expect(isErrorOutput({ exitCode: 0, output: "Error: ENOENT file not found" })).toBe(true);
      expect(isErrorOutput({ exitCode: 0, output: "TypeError: foo is not a function" })).toBe(true);
      expect(isErrorOutput({ exitCode: 0, output: "FATAL: something went wrong" })).toBe(true);
      expect(isErrorOutput({ exitCode: 0, output: "Traceback (most recent call last):" })).toBe(true);
    });

    it("returns false for clean output", () => {
      expect(isErrorOutput({ exitCode: 0, output: "Build successful" })).toBe(false);
    });
  });

  describe("isUserCorrection", () => {
    it("detects correction phrases", () => {
      expect(isUserCorrection("no, that's wrong")).toBe(true);
      expect(isUserCorrection("don't do that")).toBe(true);
      expect(isUserCorrection("undo that")).toBe(true);
      expect(isUserCorrection("revert")).toBe(true);
      expect(isUserCorrection("that broke it")).toBe(true);
    });

    it("does not flag normal messages", () => {
      expect(isUserCorrection("looks good")).toBe(false);
      expect(isUserCorrection("now add a test")).toBe(false);
    });
  });

  describe("normalizeErrorSignature", () => {
    it("extracts first meaningful line", () => {
      const output = "Error: ENOENT: no such file or directory\n  at readFile (/foo/bar.ts:12)";
      expect(normalizeErrorSignature(output)).toBe("Error: ENOENT: no such file or directory");
    });

    it("strips ANSI codes", () => {
      const output = "\u001b[31mTypeError: foo\u001b[0m\nmore stuff";
      expect(normalizeErrorSignature(output)).toBe("TypeError: foo");
    });

    it("truncates long lines", () => {
      const long = "Error: " + "x".repeat(300);
      const result = normalizeErrorSignature(long);
      expect(result.length).toBeLessThanOrEqual(200);
    });

    it("returns empty string for empty input", () => {
      expect(normalizeErrorSignature("")).toBe("");
    });
  });
});
