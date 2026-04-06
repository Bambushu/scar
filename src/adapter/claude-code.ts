const ERROR_PATTERNS = [
  /^Error:/im, /^TypeError:/im, /^SyntaxError:/im, /^ReferenceError:/im,
  /^RangeError:/im, /^FATAL:/im, /^FAIL /im, /^panic:/im,
  /Traceback \(most recent call last\)/im, /^thread .+ panicked at/im,
  /command not found/im, /permission denied/im, /ENOENT/im, /EACCES/im,
];

const CORRECTION_PATTERNS = [
  /\bno[,.]?\s+(that'?s?\s+)?(wrong|incorrect|bad)\b/i,
  /\bdon'?t\s+do\s+that\b/i,
  /\bundo\s+(that|this|it)\b/i,
  /\brevert\b/i,
  /\broll\s*back\b/i,
  /\bthat\s+(broke|breaks|broken)\b/i,
  /\bwrong\s+approach\b/i,
  /\bstart\s+over\b/i,
  /\btry\s+(something|a\s+different)\b/i,
  /\bnot\s+what\s+I\s+(asked|wanted|meant)\b/i,
];

const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

export function generateClaudeCodeHooks() {
  return {
    hooks: {
      post_tool_call: {
        description: "After any tool call that produces an error (non-zero exit, error output patterns), auto-log it via scar_log with resolution_type: unknown.",
        trigger: "Tool call completes with error indicators",
        action: "Call scar_log with extracted repo, language, tool_name, error_signature, what_was_tried, what_went_wrong",
        auto_resolve: "When subsequent tool call succeeds on same task, update scar with what_worked and resolution_type: fixed",
      },
      user_correction: {
        description: "When user says 'no', 'wrong', 'don't do that', 'undo that', etc., log the previous action as a failure.",
        trigger: "User message matches correction patterns",
        action: "Call scar_log with the previous tool call as what_was_tried and user's correction as what_went_wrong",
      },
      revert_detection: {
        description: "When an edit is undone or a file is restored to a previous state, log the reverted change as a failure.",
        trigger: "File content reverted to earlier version",
        action: "Call scar_log with the reverted edit as what_was_tried and 'Edit reverted' as what_went_wrong",
      },
    },
    claude_md_instruction: `## Scar - Failure Memory

When a tool call fails (non-zero exit, error output) or the user corrects you:
1. Call scar_context to check for relevant past failures
2. If relevant scars exist, call scar_recall and adjust your approach
3. After a failure, call scar_log to record it
4. When you fix a previously logged failure, update it via scar_log with what_worked

This prevents repeating the same mistakes across sessions.`,
  };
}

export function isErrorOutput(result: { exitCode: number; output: string }): boolean {
  if (result.exitCode !== 0) return true;
  return ERROR_PATTERNS.some((pattern) => pattern.test(result.output));
}

export function isUserCorrection(message: string): boolean {
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(message));
}

export function normalizeErrorSignature(output: string): string {
  if (!output || output.trim().length === 0) return "";
  const clean = output.replace(ANSI_REGEX, "");
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  const errorLine = lines.find((l) => ERROR_PATTERNS.some((p) => p.test(l))) ?? lines[0];
  return errorLine.length > 200 ? errorLine.slice(0, 200) : errorLine;
}
