import { existsSync } from "fs";
import { ScarDatabase } from "../../core/database.js";
import { mineTranscript } from "../../core/transcript-miner.js";
import { DEDUP_WINDOW_MS } from "../../shared/constants.js";

interface MineOptions {
  transcriptPath: string;
  repo?: string;
  dryRun?: boolean;
  dbPath?: string;
}

export function runMine(options: MineOptions): string {
  if (!existsSync(options.transcriptPath)) {
    return `Transcript not found: ${options.transcriptPath}`;
  }

  const result = mineTranscript(options.transcriptPath);

  if (result.failures.length === 0) {
    return `Mined ${result.totalLines} lines, 0 failures found (${result.skipped} skipped).`;
  }

  if (options.dryRun) {
    const lines = [`Dry run: ${result.failures.length} failure(s) found in ${result.totalLines} lines:`];
    for (const f of result.failures) {
      lines.push(`  [${f.tool_name}] ${f.error_signature}`);
    }
    return lines.join("\n");
  }

  const db = new ScarDatabase(options.dbPath);
  try {
    let logged = 0;
    let deduped = 0;
    const repo = options.repo ?? "unknown";

    for (const f of result.failures) {
      const existing = db.findRecentDuplicate(f.error_signature, repo, DEDUP_WINDOW_MS);
      if (existing) {
        db.bumpHitCount(existing.id);
        deduped++;
        continue;
      }

      db.create({
        repo,
        language: f.language,
        tool_name: f.tool_name,
        error_type: f.error_type,
        error_signature: f.error_signature,
        what_was_tried: f.what_was_tried,
        what_went_wrong: f.what_went_wrong,
        severity: "medium",
        source: "auto-hook",
        tags: ["transcript-mined"],
      });
      logged++;
    }

    return `Mined ${result.totalLines} lines: ${logged} logged, ${deduped} deduplicated, ${result.skipped} skipped.`;
  } finally {
    db.close();
  }
}
