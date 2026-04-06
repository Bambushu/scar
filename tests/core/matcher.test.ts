import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ScarDatabase } from "../../src/core/database.js";
import { ScarMatcher } from "../../src/core/matcher.js";
import type { CreateScarInput, RecallContext } from "../../src/core/schema.js";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "scar-matcher-test-"));
  return join(dir, "cognitive.db");
}

const baseScar: CreateScarInput = {
  repo: "my-project",
  language: "typescript",
  tool_name: "bash",
  error_type: "runtime",
  error_signature: "TypeError: Cannot read properties of undefined",
  exit_code: 1,
  file_pattern: "src",
  what_was_tried: "Ran tests",
  what_went_wrong: "Null access in parser",
  tags: ["parser", "null-check"],
};

describe("ScarMatcher", () => {
  let db: ScarDatabase;
  let matcher: ScarMatcher;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    db = new ScarDatabase(dbPath);
    matcher = new ScarMatcher(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dbPath, { force: true });
  });

  it("returns exact signature match with highest score", () => {
    db.create(baseScar);
    db.create({
      ...baseScar,
      error_signature: "SyntaxError: Unexpected token",
      error_type: "syntax",
    });

    const context: RecallContext = {
      error_signature: "TypeError: Cannot read properties of undefined",
    };

    const results = matcher.recall(context);
    expect(results).toHaveLength(1);
    expect(results[0].match_type).toBe("exact_signature");
    expect(results[0].similarity_score).toBeGreaterThanOrEqual(1.0);
  });

  it("matches on repo + language + tool combo", () => {
    db.create(baseScar);

    const context: RecallContext = {
      repo: "my-project",
      language: "typescript",
      tool_name: "bash",
    };

    const results = matcher.recall(context);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].similarity_score).toBeGreaterThan(0);
  });

  it("matches on error_type + file_pattern", () => {
    db.create(baseScar);

    const context: RecallContext = {
      error_type: "runtime",
      file_pattern: "src",
    };

    const results = matcher.recall(context);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("matches on overlapping tags", () => {
    db.create(baseScar);

    const context: RecallContext = {
      tags: ["parser", "something-else"],
    };

    const results = matcher.recall(context);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array when nothing matches", () => {
    db.create(baseScar);

    const context: RecallContext = {
      repo: "completely-different",
      language: "rust",
      error_signature: "no match here",
    };

    const results = matcher.recall(context);
    expect(results).toHaveLength(0);
  });

  it("limits results to max 3", () => {
    for (let i = 0; i < 5; i++) {
      db.create({ ...baseScar, tags: [`tag-${i}`] });
    }

    const context: RecallContext = {
      repo: "my-project",
      language: "typescript",
    };

    const results = matcher.recall(context);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("ranks exact signature above context combo", () => {
    const exact = db.create(baseScar);
    const contextOnly = db.create({
      ...baseScar,
      error_signature: "different error entirely",
    });

    const context: RecallContext = {
      repo: "my-project",
      language: "typescript",
      tool_name: "bash",
      error_signature: "TypeError: Cannot read properties of undefined",
    };

    const results = matcher.recall(context);
    expect(results[0].scar_id).toBe(exact.id);
  });

  it("counts relevant scars for context check", () => {
    db.create(baseScar);
    db.create({ ...baseScar, error_signature: "Another error in same repo" });
    db.create({
      ...baseScar,
      repo: "unrelated",
      error_signature: "unrelated error",
      tags: [],
    });

    const count = matcher.countRelevant({
      repo: "my-project",
    });
    expect(count).toBe(2);
  });

  it("all results have source: scar", () => {
    db.create(baseScar);
    const results = matcher.recall({ repo: "my-project" });
    for (const r of results) {
      expect(r.source).toBe("scar");
    }
  });
});
