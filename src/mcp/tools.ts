import type { ScarDatabase } from "../core/database.js";
import type { ScarMatcher } from "../core/matcher.js";
import type { CreateScarInput, RecallContext } from "../core/schema.js";
import { DEDUP_WINDOW_MS } from "../shared/constants.js";

interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

export interface ToolHandlers {
  scar_log: (args: Record<string, unknown>) => Promise<ToolResponse>;
  scar_update: (args: Record<string, unknown>) => Promise<ToolResponse>;
  scar_recall: (args: Record<string, unknown>) => Promise<ToolResponse>;
  scar_forget: (args: Record<string, unknown>) => Promise<ToolResponse>;
  scar_stats: (args: Record<string, unknown>) => Promise<ToolResponse>;
  scar_context: (args: Record<string, unknown>) => Promise<ToolResponse>;
}

function jsonResponse(data: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function createToolHandlers(
  db: ScarDatabase,
  matcher: ScarMatcher
): ToolHandlers {
  return {
    async scar_log(args) {
      const input: CreateScarInput = {
        repo: args.repo as string,
        language: args.language as string,
        tool_name: args.tool_name as string,
        error_type: (args.error_type as CreateScarInput["error_type"]) ?? "other",
        error_signature: args.error_signature as string,
        exit_code: (args.exit_code as number) ?? null,
        file_pattern: (args.file_pattern as CreateScarInput["file_pattern"]) ?? "other",
        what_was_tried: args.what_was_tried as string,
        what_went_wrong: args.what_went_wrong as string,
        what_worked: (args.what_worked as string) ?? null,
        resolution_type: (args.resolution_type as CreateScarInput["resolution_type"]) ?? "unknown",
        tags: (args.tags as string[]) ?? [],
      };

      // Deduplication check
      const existing = db.findRecentDuplicate(
        input.error_signature,
        input.repo,
        DEDUP_WINDOW_MS
      );

      if (existing) {
        db.bumpHitCount(existing.id);
        if (input.what_went_wrong !== existing.what_went_wrong) {
          db.update(existing.id, {
            what_went_wrong: `${existing.what_went_wrong}\n---\n${input.what_went_wrong}`,
          });
        }
        const updated = db.findById(existing.id)!;
        return jsonResponse({
          ...updated,
          deduplicated: true,
        });
      }

      const record = db.create(input);
      return jsonResponse(record);
    },

    async scar_update(args) {
      const id = args.id as string;
      const existing = db.findById(id);
      if (!existing) {
        return jsonResponse({ error: `No scar found with ID: ${id}`, updated: false });
      }

      db.update(id, {
        what_worked: args.what_worked as string | undefined,
        resolution_type: args.resolution_type as "fixed" | "workaround" | "wontfix" | "escalated" | "unknown" | undefined,
        tags: args.tags as string[] | undefined,
        what_went_wrong: args.what_went_wrong as string | undefined,
      });

      const updated = db.findById(id)!;
      return jsonResponse(updated);
    },

    async scar_recall(args) {
      const context: RecallContext = {
        repo: args.repo as string | undefined,
        language: args.language as string | undefined,
        tool_name: args.tool_name as string | undefined,
        error_type: args.error_type as RecallContext["error_type"],
        error_signature: args.error_signature as string | undefined,
        file_pattern: args.file_pattern as RecallContext["file_pattern"],
        tags: args.tags as string[] | undefined,
      };

      const matchResults = matcher.recall(context);

      const matches = matchResults.map((m) => {
        const scar = db.findById(m.scar_id);
        return {
          score: m.similarity_score,
          match_type: m.match_type,
          scar,
        };
      });

      return jsonResponse({ matches, count: matches.length });
    },

    async scar_forget(args) {
      const id = args.id as string;
      const deleted = db.delete(id);
      return jsonResponse({ deleted, id });
    },

    async scar_stats(_args) {
      const staleOnly = _args.stale === true;
      if (staleOnly) {
        const allScars = db.list({ resolution_type: "unknown" });
        const staleCutoff = new Date(
          Date.now() - 90 * 24 * 60 * 60 * 1000
        ).toISOString();
        const staleScars = allScars.filter((s) => s.created_at < staleCutoff);
        return jsonResponse({ stale_scars: staleScars, count: staleScars.length });
      }

      const stats = db.getStats();
      return jsonResponse(stats);
    },

    async scar_context(args) {
      const context: RecallContext = {
        repo: args.repo as string | undefined,
        language: args.language as string | undefined,
        tool_name: args.tool_name as string | undefined,
        error_type: args.error_type as RecallContext["error_type"],
        error_signature: args.error_signature as string | undefined,
        file_pattern: args.file_pattern as RecallContext["file_pattern"],
        tags: args.tags as string[] | undefined,
      };

      const count = matcher.countRelevant(context);

      return jsonResponse({
        relevant_count: count,
        has_relevant_scars: count > 0,
        message:
          count > 0
            ? `${count} relevant scar(s) found. Call scar_recall for details.`
            : "No relevant scars. Proceed normally.",
      });
    },
  };
}

