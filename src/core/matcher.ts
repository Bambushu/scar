import type { ScarRecord, RecallContext, MatchResult } from "./schema.js";
import type { ScarDatabase } from "./database.js";
import { MATCH_WEIGHTS, MAX_RECALL_RESULTS } from "../shared/constants.js";

const MIN_SCORE_THRESHOLD = 0.1;

export class ScarMatcher {
  constructor(private db: ScarDatabase) {}

  recall(context: RecallContext): MatchResult[] {
    const allScars = this.db.list();
    if (allScars.length === 0) return [];

    const scored: MatchResult[] = [];

    for (const scar of allScars) {
      const result = this.scoreScar(scar, context);
      if (result.similarity_score >= MIN_SCORE_THRESHOLD) {
        scored.push(result);
      }
    }

    scored.sort((a, b) => b.similarity_score - a.similarity_score);
    return scored.slice(0, MAX_RECALL_RESULTS);
  }

  countRelevant(context: RecallContext): number {
    const allScars = this.db.list();
    let count = 0;
    for (const scar of allScars) {
      if (this.hasAnyOverlap(scar, context)) {
        count++;
      }
    }
    return count;
  }

  private scoreScar(scar: ScarRecord, context: RecallContext): MatchResult {
    let score = 0;
    let bestMatchType: MatchResult["match_type"] = "tag_overlap";

    // Tier 1: Exact error_signature match
    if (context.error_signature && scar.error_signature === context.error_signature) {
      score += MATCH_WEIGHTS.error_signature;
      bestMatchType = "exact_signature";
    }

    // Tier 2: repo + language + tool_name combo
    let comboHits = 0;
    if (context.repo && scar.repo === context.repo) comboHits++;
    if (context.language && scar.language === context.language) comboHits++;
    if (context.tool_name && scar.tool_name === context.tool_name) comboHits++;
    if (comboHits > 0) {
      const comboScore = MATCH_WEIGHTS.context_combo * (comboHits / 3);
      score += comboScore;
      if (comboHits >= 2 && bestMatchType !== "exact_signature") {
        bestMatchType = "context_combo";
      }
    }

    // Tier 3: error_type + file_pattern
    let patternHits = 0;
    if (context.error_type && scar.error_type === context.error_type) patternHits++;
    if (context.file_pattern && scar.file_pattern === context.file_pattern) patternHits++;
    if (patternHits > 0) {
      const patternScore = MATCH_WEIGHTS.error_pattern * (patternHits / 2);
      score += patternScore;
      if (
        patternHits === 2 &&
        bestMatchType !== "exact_signature" &&
        bestMatchType !== "context_combo"
      ) {
        bestMatchType = "error_pattern";
      }
    }

    // Tier 4: Tag overlap
    if (context.tags && context.tags.length > 0 && scar.tags.length > 0) {
      const contextTagSet = new Set(context.tags);
      const overlap = scar.tags.filter((t) => contextTagSet.has(t)).length;
      if (overlap > 0) {
        score += MATCH_WEIGHTS.tag_overlap * overlap;
      }
    }

    return {
      scar_id: scar.id,
      similarity_score: Math.round(score * 1000) / 1000,
      match_type: bestMatchType,
      source: "scar",
    };
  }

  private hasAnyOverlap(scar: ScarRecord, context: RecallContext): boolean {
    if (context.error_signature && scar.error_signature === context.error_signature) return true;
    if (context.repo && scar.repo === context.repo) return true;
    if (context.language && scar.language === context.language) return true;
    if (context.tool_name && scar.tool_name === context.tool_name) return true;
    if (context.error_type && scar.error_type === context.error_type) return true;
    if (context.file_pattern && scar.file_pattern === context.file_pattern) return true;
    if (context.tags && context.tags.length > 0 && scar.tags.length > 0) {
      const contextTagSet = new Set(context.tags);
      if (scar.tags.some((t) => contextTagSet.has(t))) return true;
    }
    return false;
  }
}
