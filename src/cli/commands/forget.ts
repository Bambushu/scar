import { ScarDatabase } from "../../core/database.js";

interface ForgetOptions { id: string; dbPath?: string; }

export function runForget(options: ForgetOptions): string {
  const db = new ScarDatabase(options.dbPath);
  try {
    const scar = db.findById(options.id);
    if (!scar) return `No scar found with ID: ${options.id}`;
    db.delete(options.id);
    return `Forgot scar ${options.id} (${scar.error_signature})`;
  } finally {
    db.close();
  }
}
