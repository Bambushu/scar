import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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

  it("exports all scars as array", () => {
    db.create(sampleInput);
    db.create({ ...sampleInput, repo: "other" });

    const exported = db.exportAll();
    expect(exported).toHaveLength(2);
    expect(exported[0].tags).toBeInstanceOf(Array);
  });
});
