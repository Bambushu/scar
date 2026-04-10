import { ScarDatabase } from "../../core/database.js";

interface BriefingOptions { repo?: string; dbPath?: string; }

export function runBriefing(options: BriefingOptions = {}): string {
  const db = new ScarDatabase(options.dbPath);
  try {
    const { entries, resolvedEntries, totalUnresolved } = db.getBriefing(options.repo);

    if (entries.length === 0 && resolvedEntries.length === 0) {
      return "";  // Silent when no scars
    }

    const lines: string[] = [];
    lines.push(`Scar briefing for ${options.repo ?? "all repos"}:`);

    if (entries.length > 0) {
      lines.push(`${totalUnresolved} unresolved:`);
      for (const e of entries) {
        lines.push(`  ${e.error_signature} - unresolved (hit ${e.hit_count}x)`);
      }
      if (totalUnresolved > entries.length) {
        lines.push(`  ... and ${totalUnresolved - entries.length} more.`);
      }
    }

    if (resolvedEntries.length > 0) {
      lines.push("");
      lines.push("Known fixes:");
      for (const e of resolvedEntries) {
        lines.push(`  ${e.error_signature} - fix: ${e.what_worked}`);
      }
    }

    return lines.join("\n");
  } finally {
    db.close();
  }
}
