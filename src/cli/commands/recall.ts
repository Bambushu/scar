import { ScarDatabase } from "../../core/database.js";
import { ScarMatcher } from "../../core/matcher.js";
import type { RecallContext, ErrorType, FilePattern } from "../../core/schema.js";

interface RecallOptions {
  repo?: string;
  language?: string;
  tool?: string;
  errorType?: string;
  errorSignature?: string;
  filePattern?: string;
  tags?: string[];
  dbPath?: string;
}

export function runRecall(options: RecallOptions): string {
  const db = new ScarDatabase(options.dbPath);
  const matcher = new ScarMatcher(db);
  try {
    const context: RecallContext = {
      repo: options.repo,
      language: options.language,
      tool_name: options.tool,
      error_type: options.errorType as ErrorType | undefined,
      error_signature: options.errorSignature,
      file_pattern: options.filePattern as FilePattern | undefined,
      tags: options.tags,
    };

    const results = matcher.recall(context);
    if (results.length === 0) return "No relevant scars found.";

    const lines: string[] = [`Found ${results.length} relevant scar(s):\n`];
    for (const match of results) {
      const scar = db.findById(match.scar_id);
      if (!scar) continue;
      lines.push(`--- [${match.match_type}] score: ${match.similarity_score} ---`);
      lines.push(`ID: ${scar.id}`);
      lines.push(`Repo: ${scar.repo} | Lang: ${scar.language} | Tool: ${scar.tool_name}`);
      lines.push(`Error: ${scar.error_signature}`);
      lines.push(`Tried: ${scar.what_was_tried}`);
      lines.push(`Wrong: ${scar.what_went_wrong}`);
      if (scar.what_worked) lines.push(`Fix: ${scar.what_worked}`);
      lines.push(`Status: ${scar.resolution_type} | Hits: ${scar.hit_count}`);
      lines.push("");
    }
    return lines.join("\n");
  } finally {
    db.close();
  }
}
