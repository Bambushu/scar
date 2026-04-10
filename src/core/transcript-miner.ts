import { readFileSync } from "fs";
import type { ErrorType } from "./schema.js";

/** A single failure extracted from a transcript */
export interface TranscriptFailure {
  tool_name: string;
  error_signature: string;
  what_was_tried: string;
  what_went_wrong: string;
  language: string;
  error_type: ErrorType;
}

/** Result of mining a transcript */
export interface MineResult {
  failures: TranscriptFailure[];
  totalLines: number;
  skipped: number;
}

interface ToolUseEntry {
  name: string;
  input: Record<string, unknown>;
}

const SKIP_PATTERNS = [
  /^Cancelled: parallel tool call/,
  /Cancelled: parallel tool call/,
];

const TRIVIAL_BASH_PATTERNS = [
  /^which\s/,
  /^command -v\s/,
  /^test\s/,
  /^\[\s/,
];

function isTrivialBashFailure(command: string, errorText: string): boolean {
  for (const p of TRIVIAL_BASH_PATTERNS) {
    if (p.test(command)) return true;
  }
  // grep/rg exit code 1 is just "no match"
  if (/^(grep|rg)\s/.test(command) && /Exit code 1/.test(errorText) && !/Exit code [2-9]/.test(errorText)) {
    return true;
  }
  // ls with suppressed stderr
  if (/^ls\s.*2>\/dev\/null/.test(command)) return true;
  return false;
}

function extractErrorSignature(text: string): string {
  // Strip tool_use_error tags
  const clean = text.replace(/<\/?tool_use_error>/g, "").trim();
  const firstLine = clean.split("\n")[0].trim();
  return firstLine.length > 200 ? firstLine.slice(0, 200) : firstLine;
}

function inferLanguage(errorText: string): string {
  if (/TypeError|SyntaxError|ReferenceError|RangeError/.test(errorText)) return "javascript";
  if (/Traceback|ImportError|IndentationError/.test(errorText)) return "python";
  if (/panicked|cargo error/.test(errorText)) return "rust";
  return "unknown";
}

function inferErrorType(toolName: string, errorText: string): ErrorType {
  if (/permission denied|EACCES/i.test(errorText)) return "permission";
  if (/SyntaxError|IndentationError/i.test(errorText)) return "syntax";
  if (/TypeError|ReferenceError|RangeError|Traceback/i.test(errorText)) return "runtime";
  if (/ENOENT|not found|does not exist/i.test(errorText)) return "config";
  if (/timeout/i.test(errorText)) return "timeout";
  if (/Cannot find module|dependency|ERESOLVE/i.test(errorText)) return "dependency";
  return "other";
}

function describeAttempt(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return `Bash: ${String(input.command ?? "unknown").slice(0, 200)}`;
    case "Edit":
      return `Edit ${String(input.file_path ?? "unknown")}`;
    case "Read":
      return `Read ${String(input.file_path ?? "unknown")}`;
    case "Write":
      return `Write ${String(input.file_path ?? "unknown")}`;
    default:
      return `${toolName}: ${JSON.stringify(input).slice(0, 200)}`;
  }
}

/**
 * Mine a Claude Code session transcript JSONL for tool failures.
 * Returns extracted failures ready for logging to Scar.
 */
export function mineTranscript(transcriptPath: string): MineResult {
  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  const toolUses = new Map<string, ToolUseEntry>();
  const failures: TranscriptFailure[] = [];
  let skipped = 0;

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;

    const contentArr = message.content;
    if (!Array.isArray(contentArr)) continue;

    for (const item of contentArr) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;

      // Collect tool_use calls
      if (entry.type === "tool_use" && typeof entry.id === "string") {
        toolUses.set(entry.id, {
          name: String(entry.name ?? "unknown"),
          input: (entry.input as Record<string, unknown>) ?? {},
        });
      }

      // Find error results
      if (entry.type === "tool_result" && entry.is_error === true) {
        const errorText = typeof entry.content === "string" ? entry.content : "";
        const toolUseId = String(entry.tool_use_id ?? "");

        // Skip cancelled parallel calls
        if (SKIP_PATTERNS.some((p) => p.test(errorText))) {
          skipped++;
          continue;
        }

        const toolUse = toolUses.get(toolUseId);
        const toolName = toolUse?.name ?? "unknown";
        const toolInput = toolUse?.input ?? {};

        // Skip trivial Bash failures
        if (toolName === "Bash") {
          const command = String(toolInput.command ?? "");
          if (isTrivialBashFailure(command, errorText)) {
            skipped++;
            continue;
          }
        }

        const truncatedError = errorText.length > 500 ? errorText.slice(0, 500) : errorText;

        failures.push({
          tool_name: toolName.toLowerCase(),
          error_signature: extractErrorSignature(errorText),
          what_was_tried: describeAttempt(toolName, toolInput),
          what_went_wrong: truncatedError,
          language: inferLanguage(errorText),
          error_type: inferErrorType(toolName, errorText),
        });
      }
    }
  }

  return { failures, totalLines: lines.length, skipped };
}
