/** Severity level of a scar */
export type Severity = "low" | "medium" | "high";

/** How the scar was captured */
export type ScarSource = "auto-hook" | "manual" | "briefing-follow-up";

/** Resolution status of a scar */
export type ResolutionType =
  | "fixed"
  | "workaround"
  | "wontfix"
  | "escalated"
  | "unknown";

/** Error category */
export type ErrorType =
  | "syntax"
  | "runtime"
  | "config"
  | "permission"
  | "timeout"
  | "dependency"
  | "type"
  | "network"
  | "other";

/** File pattern category */
export type FilePattern =
  | "test"
  | "config"
  | "migration"
  | "src"
  | "build"
  | "ci"
  | "docs"
  | "other";

/** A single failure record stored in the database */
export interface ScarRecord {
  id: string;
  created_at: string;
  repo: string;
  language: string;
  tool_name: string;
  error_type: ErrorType;
  error_signature: string;
  exit_code: number | null;
  file_pattern: FilePattern;
  what_was_tried: string;
  what_went_wrong: string;
  what_worked: string | null;
  resolution_type: ResolutionType;
  tags: string[];
  hit_count: number;
  similarity_score_cache: string | null;
  severity: Severity;
  source: ScarSource;
}

/** Row shape as stored in SQLite (tags serialized to JSON) */
export interface ScarRow {
  id: string;
  created_at: string;
  repo: string;
  language: string;
  tool_name: string;
  error_type: string;
  error_signature: string;
  exit_code: number | null;
  file_pattern: string;
  what_was_tried: string;
  what_went_wrong: string;
  what_worked: string | null;
  resolution_type: string;
  tags: string;
  hit_count: number;
  similarity_score_cache: string | null;
  severity: string;
  source: string;
}

/** Input for creating a new scar */
export interface CreateScarInput {
  repo: string;
  language: string;
  tool_name: string;
  error_type: ErrorType;
  error_signature: string;
  exit_code?: number | null;
  file_pattern?: FilePattern;
  what_was_tried: string;
  what_went_wrong: string;
  what_worked?: string | null;
  resolution_type?: ResolutionType;
  tags?: string[];
  severity?: Severity;
  source?: ScarSource;
}

/** Input for updating an existing scar */
export interface UpdateScarInput {
  what_worked?: string | null;
  resolution_type?: ResolutionType;
  tags?: string[];
  what_went_wrong?: string;
}

/** Match result from the matching engine */
export interface MatchResult {
  scar_id: string;
  similarity_score: number;
  match_type: "exact_signature" | "context_combo" | "error_pattern" | "tag_overlap";
  source: "scar";
}

/** Query context for recall operations */
export interface RecallContext {
  repo?: string;
  language?: string;
  tool_name?: string;
  error_type?: ErrorType;
  error_signature?: string;
  file_pattern?: FilePattern;
  tags?: string[];
}

/** A single entry in a session briefing */
export interface BriefingEntry {
  id: string;
  error_signature: string;
  what_went_wrong: string;
  what_worked: string | null;
  resolution_type: ResolutionType;
  repo: string;
  hit_count: number;
  created_at: string;
}

/** Session briefing result */
export interface ScarBriefing {
  repo: string | null;
  entries: BriefingEntry[];
  total_unresolved: number;
  message: string;
}

/** Stats aggregation result */
export interface ScarStats {
  total_scars: number;
  by_error_type: Record<string, number>;
  by_repo: Record<string, number>;
  by_tool: Record<string, number>;
  by_resolution: Record<string, number>;
  stale_count: number;
  top_hit_count: Array<{ id: string; error_signature: string; hit_count: number }>;
}

/** Utility to convert a DB row to a ScarRecord */
export function rowToRecord(row: ScarRow): ScarRecord {
  return {
    ...row,
    error_type: row.error_type as ErrorType,
    file_pattern: row.file_pattern as FilePattern,
    resolution_type: row.resolution_type as ResolutionType,
    tags: JSON.parse(row.tags || "[]"),
    severity: row.severity as Severity,
    source: row.source as ScarSource,
  };
}

/** Utility to convert a ScarRecord's tags to a JSON string for storage */
export function tagsToJson(tags: string[]): string {
  return JSON.stringify(tags);
}
