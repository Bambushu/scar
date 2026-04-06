import { join } from "path";
import { homedir } from "os";

/** Root directory for all cognitive toolkit data */
export const COGNITIVE_DIR = join(homedir(), ".cognitive");

/** Scar-specific config/cache directory */
export const SCAR_DIR = join(COGNITIVE_DIR, "scar");

/** Shared SQLite database path */
export const DB_PATH = join(COGNITIVE_DIR, "cognitive.db");

/** Deduplication window in milliseconds (5 minutes) */
export const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/** Stale threshold in days */
export const STALE_THRESHOLD_DAYS = 90;

/** Maximum number of results returned by recall */
export const MAX_RECALL_RESULTS = 3;

/** Matching weights — higher = more important */
export const MATCH_WEIGHTS = {
  error_signature: 1.0,
  context_combo: 0.6,
  error_pattern: 0.3,
  tag_overlap: 0.1,
} as const;

/** MCP server name */
export const MCP_SERVER_NAME = "scar";

/** MCP server version */
export const MCP_SERVER_VERSION = "0.1.0";
