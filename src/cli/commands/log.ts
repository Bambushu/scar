import { ScarDatabase } from "../../core/database.js";
import { DEDUP_WINDOW_MS } from "../../shared/constants.js";
import type { CreateScarInput, ErrorType, FilePattern, ResolutionType } from "../../core/schema.js";

interface LogOptions {
  repo: string;
  language: string;
  tool: string;
  errorType?: string;
  errorSignature: string;
  exitCode?: number;
  filePattern?: string;
  tried: string;
  wrong: string;
  worked?: string;
  resolution?: string;
  tags?: string[];
  dbPath?: string;
}

export function runLog(options: LogOptions): string {
  const db = new ScarDatabase(options.dbPath);
  try {
    const input: CreateScarInput = {
      repo: options.repo,
      language: options.language,
      tool_name: options.tool,
      error_type: (options.errorType as ErrorType) ?? "other",
      error_signature: options.errorSignature,
      exit_code: options.exitCode ?? null,
      file_pattern: (options.filePattern as FilePattern) ?? "other",
      what_was_tried: options.tried,
      what_went_wrong: options.wrong,
      what_worked: options.worked ?? null,
      resolution_type: (options.resolution as ResolutionType) ?? "unknown",
      tags: options.tags ?? [],
    };

    const existing = db.findRecentDuplicate(input.error_signature, input.repo, DEDUP_WINDOW_MS);
    if (existing) {
      db.bumpHitCount(existing.id);
      return `Deduplicated into existing scar ${existing.id} (hit_count: ${existing.hit_count + 1})`;
    }

    const record = db.create(input);
    return `Scar logged: ${record.id}`;
  } finally {
    db.close();
  }
}
