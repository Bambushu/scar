import { ScarDatabase } from "../../core/database.js";

interface StatsOptions { stale?: boolean; dbPath?: string; }

export function runStats(options: StatsOptions = {}): string {
  const db = new ScarDatabase(options.dbPath);
  try {
    const stats = db.getStats();
    const lines: string[] = [];

    if (options.stale) {
      const allUnresolved = db.list({ resolution_type: "unknown" });
      const staleCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const stale = allUnresolved.filter((s) => s.created_at < staleCutoff);
      lines.push(`Stale scars (unresolved > 90 days): ${stale.length}\n`);
      for (const s of stale) lines.push(`  ${s.id} | ${s.error_signature} | ${s.repo} | ${s.created_at}`);
      return lines.join("\n");
    }

    lines.push(`Total scars: ${stats.total_scars}`);
    lines.push(`Stale (unresolved > 90d): ${stats.stale_count}\n`);
    lines.push("By error type:");
    for (const [type, count] of Object.entries(stats.by_error_type)) lines.push(`  ${type}: ${count}`);
    lines.push("\nBy repository:");
    for (const [repo, count] of Object.entries(stats.by_repo)) lines.push(`  ${repo}: ${count}`);
    lines.push("\nBy tool:");
    for (const [tool, count] of Object.entries(stats.by_tool)) lines.push(`  ${tool}: ${count}`);
    lines.push("\nBy resolution:");
    for (const [res, count] of Object.entries(stats.by_resolution)) lines.push(`  ${res}: ${count}`);
    if (stats.top_hit_count.length > 0) {
      lines.push("\nMost recurring failures:");
      for (const t of stats.top_hit_count) lines.push(`  [${t.hit_count}x] ${t.error_signature}`);
    }
    return lines.join("\n");
  } finally {
    db.close();
  }
}
