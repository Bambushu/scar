import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { ScarDatabase } from "../../src/core/database.js";
import type { CreateScarInput } from "../../src/core/schema.js";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "scar-test-"));
  return join(dir, "cognitive.db");
}

const sampleInput: CreateScarInput = {
  repo: "my-project",
  language: "typescript",
  tool_name: "bash",
  error_type: "runtime",
  error_signature: "TypeError: Cannot read properties of undefined",
  exit_code: 1,
  file_pattern: "src",
  what_was_tried: "Ran the test suite",
  what_went_wrong: "Undefined variable access in parser.ts",
  what_worked: null,
  resolution_type: "unknown",
  tags: ["parser", "null-check"],
};

describe("ScarDatabase", () => {
  let db: ScarDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    db = new ScarDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    rmSync(dbPath, { force: true });
  });

  it("creates a scar and retrieves it by id", () => {
    const record = db.create(sampleInput);
    expect(record.id).toBeDefined();
    expect(record.repo).toBe("my-project");
    expect(record.tags).toEqual(["parser", "null-check"]);
    expect(record.hit_count).toBe(1);

    const found = db.findById(record.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(record.id);
    expect(found!.error_signature).toBe("TypeError: Cannot read properties of undefined");
  });

  it("returns null for non-existent id", () => {
    const found = db.findById("non-existent-id");
    expect(found).toBeNull();
  });

  it("updates a scar", () => {
    const record = db.create(sampleInput);
    db.update(record.id, {
      what_worked: "Added null check before accessing property",
      resolution_type: "fixed",
    });

    const updated = db.findById(record.id);
    expect(updated!.what_worked).toBe("Added null check before accessing property");
    expect(updated!.resolution_type).toBe("fixed");
  });

  it("deletes a scar", () => {
    const record = db.create(sampleInput);
    const deleted = db.delete(record.id);
    expect(deleted).toBe(true);

    const found = db.findById(record.id);
    expect(found).toBeNull();
  });

  it("returns false when deleting non-existent scar", () => {
    const deleted = db.delete("non-existent");
    expect(deleted).toBe(false);
  });

  it("lists all scars", () => {
    db.create(sampleInput);
    db.create({ ...sampleInput, repo: "other-project" });

    const all = db.list();
    expect(all).toHaveLength(2);
  });

  it("lists scars filtered by repo", () => {
    db.create(sampleInput);
    db.create({ ...sampleInput, repo: "other-project" });

    const filtered = db.list({ repo: "my-project" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].repo).toBe("my-project");
  });

  it("bumps hit_count on existing scar", () => {
    const record = db.create(sampleInput);
    expect(record.hit_count).toBe(1);

    db.bumpHitCount(record.id);
    const bumped = db.findById(record.id);
    expect(bumped!.hit_count).toBe(2);
  });

  it("finds recent duplicate within window", () => {
    const record = db.create(sampleInput);
    const dup = db.findRecentDuplicate(
      sampleInput.error_signature,
      sampleInput.repo,
      5 * 60 * 1000
    );
    expect(dup).toBeDefined();
    expect(dup!.id).toBe(record.id);
  });

  it("returns null when no recent duplicate", () => {
    const dup = db.findRecentDuplicate(
      "some other error",
      "my-project",
      5 * 60 * 1000
    );
    expect(dup).toBeNull();
  });

  it("counts all scars", () => {
    db.create(sampleInput);
    db.create({ ...sampleInput, repo: "other" });
    expect(db.count()).toBe(2);
  });

  it("gets aggregate stats", () => {
    db.create(sampleInput);
    db.create({ ...sampleInput, error_type: "config", repo: "other" });

    const stats = db.getStats();
    expect(stats.total_scars).toBe(2);
    expect(stats.by_error_type["runtime"]).toBe(1);
    expect(stats.by_error_type["config"]).toBe(1);
    expect(stats.by_repo["my-project"]).toBe(1);
    expect(stats.by_repo["other"]).toBe(1);
  });

  it("does not find duplicate outside time window", () => {
    db.create(sampleInput);
    // Use a tiny negative-effective window: cutoff = now + 1ms (future), so nothing qualifies
    const dup = db.findRecentDuplicate(
      sampleInput.error_signature,
      sampleInput.repo,
      -1 // negative window = cutoff is in the future, nothing matches
    );
    expect(dup).toBeNull();
  });

  it("does not match duplicate with different repo", () => {
    db.create(sampleInput);
    const dup = db.findRecentDuplicate(
      sampleInput.error_signature,
      "different-repo",
      5 * 60 * 1000
    );
    expect(dup).toBeNull();
  });

  it("does not match duplicate with different error signature", () => {
    db.create(sampleInput);
    const dup = db.findRecentDuplicate(
      "completely different error",
      sampleInput.repo,
      5 * 60 * 1000
    );
    expect(dup).toBeNull();
  });

  describe("getBriefing", () => {
    it("returns empty briefing when no scars exist", () => {
      const { entries, totalUnresolved } = db.getBriefing();
      expect(entries).toHaveLength(0);
      expect(totalUnresolved).toBe(0);
    });

    it("returns unresolved scars ordered by hit_count", () => {
      const scar1 = db.create(sampleInput);
      db.bumpHitCount(scar1.id); // hit_count = 2
      db.bumpHitCount(scar1.id); // hit_count = 3

      db.create({ ...sampleInput, error_signature: "Error: second failure" });

      const { entries, totalUnresolved } = db.getBriefing();
      expect(entries).toHaveLength(2);
      expect(totalUnresolved).toBe(2);
      expect(entries[0].hit_count).toBe(3);
      expect(entries[1].hit_count).toBe(1);
    });

    it("excludes fixed and wontfix scars", () => {
      const fixed = db.create(sampleInput);
      db.update(fixed.id, { resolution_type: "fixed" });

      const wontfix = db.create({ ...sampleInput, error_signature: "Error: wontfix" });
      db.update(wontfix.id, { resolution_type: "wontfix" });

      db.create({ ...sampleInput, error_signature: "Error: still open" });

      const { entries, totalUnresolved } = db.getBriefing();
      expect(entries).toHaveLength(1);
      expect(totalUnresolved).toBe(1);
      expect(entries[0].error_signature).toBe("Error: still open");
    });

    it("filters by repo when specified", () => {
      db.create(sampleInput);
      db.create({ ...sampleInput, repo: "other-project", error_signature: "Error: other" });

      const { entries, totalUnresolved } = db.getBriefing("my-project");
      expect(entries).toHaveLength(1);
      expect(totalUnresolved).toBe(1);
      expect(entries[0].repo).toBe("my-project");
    });

    it("includes workaround scars (not fixed)", () => {
      const scar = db.create(sampleInput);
      db.update(scar.id, { resolution_type: "workaround", what_worked: "Use flag --legacy" });

      const { entries } = db.getBriefing();
      expect(entries).toHaveLength(1);
      expect(entries[0].what_worked).toBe("Use flag --legacy");
    });
  });

  describe("getBriefing with resolved scars", () => {
    it("should return both unresolved and resolved scars with what_worked", () => {
      // Create unresolved scar
      db.create({
        repo: "test-repo",
        language: "ts",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "unresolved error 1",
        what_was_tried: "something",
        what_went_wrong: "broke",
      });

      // Create resolved scar with what_worked
      const resolved = db.create({
        repo: "test-repo",
        language: "ts",
        tool_name: "bash",
        error_type: "config",
        error_signature: "config error",
        what_was_tried: "bad config",
        what_went_wrong: "wrong format",
      });
      db.update(resolved.id, {
        what_worked: "use YAML not JSON",
        resolution_type: "fixed",
      });

      const result = db.getBriefing("test-repo");
      expect(result.totalUnresolved).toBe(1);
      expect(result.entries.length).toBe(1);
      expect(result.resolvedEntries).toBeDefined();
      expect(result.resolvedEntries.length).toBe(1);
      expect(result.resolvedEntries[0].what_worked).toBe("use YAML not JSON");
    });
  });

  it("exports all scars as array", () => {
    db.create(sampleInput);
    db.create({ ...sampleInput, repo: "other" });

    const exported = db.exportAll();
    expect(exported).toHaveLength(2);
    expect(exported[0].tags).toBeInstanceOf(Array);
  });

  describe("V2 schema", () => {
    it("should create a scar with severity and source fields", () => {
      const input: CreateScarInput = {
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "ENOENT: no such file",
        what_was_tried: "ls /nonexistent",
        what_went_wrong: "File not found",
        severity: "high",
        source: "auto-hook",
      };
      const record = db.create(input);
      expect(record.severity).toBe("high");
      expect(record.source).toBe("auto-hook");
    });

    it("should default severity to medium and source to manual", () => {
      const input: CreateScarInput = {
        repo: "test-repo",
        language: "typescript",
        tool_name: "bash",
        error_type: "runtime",
        error_signature: "some error",
        what_was_tried: "something",
        what_went_wrong: "it broke",
      };
      const record = db.create(input);
      expect(record.severity).toBe("medium");
      expect(record.source).toBe("manual");
    });
  });
});

describe("V2 migration", () => {
  it("should add severity and source columns to existing V1 database", () => {
    const testPath = join(tmpdir(), `scar-migration-test-${randomUUID()}.db`);
    const rawDb = new Database(testPath);
    rawDb.exec(`
      CREATE TABLE cognitive_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO cognitive_meta (key, value) VALUES ('scar_schema_version', '1');
      CREATE TABLE scars (
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
      INSERT INTO scars (id, created_at, repo, language, tool_name, error_type, error_signature, what_was_tried, what_went_wrong)
        VALUES ('old-scar', '2026-01-01T00:00:00Z', 'test', 'ts', 'bash', 'runtime', 'old error', 'old try', 'old wrong');
    `);
    rawDb.close();

    const scarDb = new ScarDatabase(testPath);
    const oldScar = scarDb.findById("old-scar");
    expect(oldScar).not.toBeNull();
    expect(oldScar!.severity).toBe("medium");
    expect(oldScar!.source).toBe("manual");

    const newScar = scarDb.create({
      repo: "test",
      language: "ts",
      tool_name: "edit",
      error_type: "other",
      error_signature: "new error",
      what_was_tried: "new try",
      what_went_wrong: "new wrong",
      severity: "high",
      source: "auto-hook",
    });
    expect(newScar.severity).toBe("high");
    expect(newScar.source).toBe("auto-hook");

    scarDb.close();
    unlinkSync(testPath);
  });
});
