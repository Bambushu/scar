import { ScarDatabase } from "../../core/database.js";

interface BriefingOptions { repo?: string; dbPath?: string; }

export function runBriefing(options: BriefingOptions = {}): string {
  const db = new ScarDatabase(options.dbPath);
  try {
    const { entries, totalUnresolved } = db.getBriefing(options.repo);

    if (entries.length === 0) {
      return "No unresolved scars. Clean slate.";
    }

    const lines: string[] = [];
    lines.push(`${totalUnresolved} unresolved scar(s)${options.repo ? ` for ${options.repo}` : ""}:\n`);

    for (const e of entries) {
      const status = e.what_worked
        ? `workaround: ${e.what_worked}`
        : `unresolved (hit ${e.hit_count}x)`;
      lines.push(`  ${e.error_signature} — ${status}`);
    }

    if (totalUnresolved > entries.length) {
      lines.push(`\n  ... and ${totalUnresolved - entries.length} more. Use 'scar stats' for full picture.`);
    }

    return lines.join("\n");
  } finally {
    db.close();
  }
}
