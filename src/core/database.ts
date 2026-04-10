import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import {
  type ScarRecord,
  type ScarRow,
  type CreateScarInput,
  type UpdateScarInput,
  type ScarStats,
  type BriefingEntry,
  rowToRecord,
  tagsToJson,
} from "./schema.js";
import { DB_PATH, STALE_THRESHOLD_DAYS, MAX_BRIEFING_RESULTS } from "../shared/constants.js";

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS scars (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  repo TEXT NOT NULL,
  language TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_signature TEXT NOT NULL,
  exit_code INTEGER,
  file_pattern TEXT NOT NULL DEFAULT 'other',
  what_was_tried TEXT NOT NULL,
  what_went_wrong TEXT NOT NULL,
  what_worked TEXT,
  resolution_type TEXT NOT NULL DEFAULT 'unknown',
  tags TEXT NOT NULL DEFAULT '[]',
  hit_count INTEGER NOT NULL DEFAULT 1,
  similarity_score_cache TEXT
);

CREATE INDEX IF NOT EXISTS idx_scars_error_signature ON scars(error_signature);
CREATE INDEX IF NOT EXISTS idx_scars_repo ON scars(repo);
CREATE INDEX IF NOT EXISTS idx_scars_created_at ON scars(created_at);
CREATE INDEX IF NOT EXISTS idx_scars_error_type ON scars(error_type);

CREATE TABLE IF NOT EXISTS cognitive_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const MIGRATION_V2 = `
ALTER TABLE scars ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE scars ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
`;

export class ScarDatabase {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const version = this.getMetaValue("scar_schema_version");
    if (!version) {
      this.db.transaction(() => {
        this.db.exec(MIGRATION_V1);
        this.db.exec(MIGRATION_V2);
        this.setMetaValue("scar_schema_version", "2");
      })();
    } else if (version === "1") {
      this.db.transaction(() => {
        this.db.exec(MIGRATION_V2);
        this.setMetaValue("scar_schema_version", "2");
      })();
    }
  }

  private getMetaValue(key: string): string | null {
    try {
      const row = this.db
        .prepare("SELECT value FROM cognitive_meta WHERE key = ?")
        .get(key) as { value: string } | undefined;
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  private setMetaValue(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO cognitive_meta (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  create(input: CreateScarInput): ScarRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO scars (
          id, created_at, repo, language, tool_name, error_type,
          error_signature, exit_code, file_pattern, what_was_tried,
          what_went_wrong, what_worked, resolution_type, tags, hit_count,
          severity, source
        ) VALUES (
          @id, @created_at, @repo, @language, @tool_name, @error_type,
          @error_signature, @exit_code, @file_pattern, @what_was_tried,
          @what_went_wrong, @what_worked, @resolution_type, @tags, @hit_count,
          @severity, @source
        )`
      )
      .run({
        id,
        created_at: now,
        repo: input.repo,
        language: input.language,
        tool_name: input.tool_name,
        error_type: input.error_type,
        error_signature: input.error_signature,
        exit_code: input.exit_code ?? null,
        file_pattern: input.file_pattern ?? "other",
        what_was_tried: input.what_was_tried,
        what_went_wrong: input.what_went_wrong,
        what_worked: input.what_worked ?? null,
        resolution_type: input.resolution_type ?? "unknown",
        tags: tagsToJson(input.tags ?? []),
        hit_count: 1,
        severity: input.severity ?? "medium",
        source: input.source ?? "manual",
      });

    return this.findById(id)!;
  }

  findById(id: string): ScarRecord | null {
    const row = this.db
      .prepare("SELECT * FROM scars WHERE id = ?")
      .get(id) as ScarRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  update(id: string, input: UpdateScarInput): boolean {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    if (input.what_worked !== undefined) {
      sets.push("what_worked = @what_worked");
      params.what_worked = input.what_worked;
    }
    if (input.resolution_type !== undefined) {
      sets.push("resolution_type = @resolution_type");
      params.resolution_type = input.resolution_type;
    }
    if (input.tags !== undefined) {
      sets.push("tags = @tags");
      params.tags = tagsToJson(input.tags);
    }
    if (input.what_went_wrong !== undefined) {
      sets.push("what_went_wrong = @what_went_wrong");
      params.what_went_wrong = input.what_went_wrong;
    }

    if (sets.length === 0) return false;

    const result = this.db
      .prepare(`UPDATE scars SET ${sets.join(", ")} WHERE id = @id`)
      .run(params);

    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM scars WHERE id = ?").run(id);
    return result.changes > 0;
  }

  list(filters?: { repo?: string; error_type?: string; resolution_type?: string }): ScarRecord[] {
    let query = "SELECT * FROM scars";
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    if (filters?.repo) {
      conditions.push("repo = @repo");
      params.repo = filters.repo;
    }
    if (filters?.error_type) {
      conditions.push("error_type = @error_type");
      params.error_type = filters.error_type;
    }
    if (filters?.resolution_type) {
      conditions.push("resolution_type = @resolution_type");
      params.resolution_type = filters.resolution_type;
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    query += " ORDER BY created_at DESC";

    const rows = this.db.prepare(query).all(params) as ScarRow[];
    return rows.map(rowToRecord);
  }

  bumpHitCount(id: string): void {
    this.db.prepare("UPDATE scars SET hit_count = hit_count + 1 WHERE id = ?").run(id);
  }

  findRecentDuplicate(errorSignature: string, repo: string, windowMs: number): ScarRecord | null {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const row = this.db
      .prepare(
        `SELECT * FROM scars
         WHERE error_signature = @errorSignature
           AND repo = @repo
           AND created_at >= @cutoff
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get({ errorSignature, repo, cutoff }) as ScarRow | undefined;

    return row ? rowToRecord(row) : null;
  }

  count(filters?: { repo?: string }): number {
    let query = "SELECT COUNT(*) as cnt FROM scars";
    const params: Record<string, string> = {};
    if (filters?.repo) {
      query += " WHERE repo = @repo";
      params.repo = filters.repo;
    }
    const row = this.db.prepare(query).get(params) as { cnt: number };
    return row.cnt;
  }

  getStats(): ScarStats {
    const total = this.count();

    const byErrorType: Record<string, number> = {};
    const errorRows = this.db
      .prepare("SELECT error_type, COUNT(*) as cnt FROM scars GROUP BY error_type")
      .all() as Array<{ error_type: string; cnt: number }>;
    for (const r of errorRows) byErrorType[r.error_type] = r.cnt;

    const byRepo: Record<string, number> = {};
    const repoRows = this.db
      .prepare("SELECT repo, COUNT(*) as cnt FROM scars GROUP BY repo")
      .all() as Array<{ repo: string; cnt: number }>;
    for (const r of repoRows) byRepo[r.repo] = r.cnt;

    const byTool: Record<string, number> = {};
    const toolRows = this.db
      .prepare("SELECT tool_name, COUNT(*) as cnt FROM scars GROUP BY tool_name")
      .all() as Array<{ tool_name: string; cnt: number }>;
    for (const r of toolRows) byTool[r.tool_name] = r.cnt;

    const byResolution: Record<string, number> = {};
    const resRows = this.db
      .prepare("SELECT resolution_type, COUNT(*) as cnt FROM scars GROUP BY resolution_type")
      .all() as Array<{ resolution_type: string; cnt: number }>;
    for (const r of resRows) byResolution[r.resolution_type] = r.cnt;

    const staleCutoff = new Date(
      Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const staleRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM scars
         WHERE resolution_type = 'unknown' AND created_at < ?`
      )
      .get(staleCutoff) as { cnt: number };

    const topHits = this.db
      .prepare(
        "SELECT id, error_signature, hit_count FROM scars ORDER BY hit_count DESC LIMIT 5"
      )
      .all() as Array<{ id: string; error_signature: string; hit_count: number }>;

    return {
      total_scars: total,
      by_error_type: byErrorType,
      by_repo: byRepo,
      by_tool: byTool,
      by_resolution: byResolution,
      stale_count: staleRow.cnt,
      top_hit_count: topHits,
    };
  }

  getBriefing(repo?: string): { entries: BriefingEntry[]; totalUnresolved: number } {
    let countQuery = "SELECT COUNT(*) as cnt FROM scars WHERE resolution_type NOT IN ('fixed', 'wontfix')";
    let query = `
      SELECT id, error_signature, what_went_wrong, what_worked, resolution_type, repo, hit_count, created_at
      FROM scars
      WHERE resolution_type NOT IN ('fixed', 'wontfix')`;
    const params: Record<string, string> = {};

    if (repo) {
      countQuery += " AND repo = @repo";
      query += " AND repo = @repo";
      params.repo = repo;
    }

    query += " ORDER BY hit_count DESC, created_at DESC LIMIT @limit";

    const countRow = this.db.prepare(countQuery).get(params) as { cnt: number };

    const rows = this.db.prepare(query).all({ ...params, limit: MAX_BRIEFING_RESULTS }) as BriefingEntry[];

    return { entries: rows, totalUnresolved: countRow.cnt };
  }

  exportAll(): ScarRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM scars ORDER BY created_at DESC")
      .all() as ScarRow[];
    return rows.map(rowToRecord);
  }

  close(): void {
    this.db.close();
  }
}
