import { ScarDatabase } from "../../core/database.js";

interface ExportOptions { dbPath?: string; }

export function runExport(options: ExportOptions = {}): string {
  const db = new ScarDatabase(options.dbPath);
  try {
    const records = db.exportAll();
    return JSON.stringify(records, null, 2);
  } finally {
    db.close();
  }
}
