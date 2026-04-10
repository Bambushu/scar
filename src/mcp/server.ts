import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScarDatabase } from "../core/database.js";
import { ScarMatcher } from "../core/matcher.js";
import { createToolHandlers } from "./tools.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../shared/constants.js";

export function createServer(dbPath?: string): { server: McpServer; close: () => void } {
  const db = new ScarDatabase(dbPath);
  const matcher = new ScarMatcher(db);
  const handlers = createToolHandlers(db, matcher);

  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.tool(
    "scar_log",
    "Record a failure: what happened, what went wrong, what worked instead. Auto-deduplicates within 5-min window.",
    {
      repo: z.string().describe("Repository path or name"),
      language: z.string().describe("Primary language"),
      tool_name: z.string().describe("Tool that triggered the failure"),
      error_type: z.enum(["syntax","runtime","config","permission","timeout","dependency","type","network","other"]).default("other"),
      error_signature: z.string().describe("Normalized first line of error output"),
      exit_code: z.number().optional(),
      file_pattern: z.enum(["test","config","migration","src","build","ci","docs","other"]).default("other"),
      what_was_tried: z.string().describe("What the agent attempted"),
      what_went_wrong: z.string().describe("What failed and why"),
      what_worked: z.string().optional(),
      resolution_type: z.enum(["fixed","workaround","wontfix","escalated","unknown"]).default("unknown"),
      tags: z.array(z.string()).default([]),
    },
    async (args) => handlers.scar_log(args)
  );

  server.tool(
    "scar_update",
    "Update an existing scar - record what worked, change resolution status, add tags. Use after fixing a previously logged failure.",
    {
      id: z.string().describe("UUID of the scar to update"),
      what_worked: z.string().optional().describe("The fix that resolved the issue"),
      resolution_type: z.enum(["fixed", "workaround", "wontfix", "escalated", "unknown"]).optional().describe("New resolution status"),
      tags: z.array(z.string()).optional().describe("Replace tags"),
      what_went_wrong: z.string().optional().describe("Append or replace failure description"),
    },
    async (args) => handlers.scar_update(args)
  );

  server.tool(
    "scar_recall",
    "Query for relevant past failures. Returns top 3 matches ranked by similarity.",
    {
      repo: z.string().optional(),
      language: z.string().optional(),
      tool_name: z.string().optional(),
      error_type: z.string().optional(),
      error_signature: z.string().optional(),
      file_pattern: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => handlers.scar_recall(args)
  );

  server.tool(
    "scar_forget",
    "Remove a scar by ID (wrong, outdated, or noise).",
    { id: z.string().describe("UUID of the scar to remove") },
    async (args) => handlers.scar_forget(args)
  );

  server.tool(
    "scar_stats",
    "Aggregate patterns: top error types, repos, tools, failure rates.",
    { stale: z.boolean().default(false) },
    async (args) => handlers.scar_stats(args)
  );

  server.tool(
    "scar_context",
    "Lightweight pre-check: returns count of relevant scars for current context.",
    {
      repo: z.string().optional(),
      language: z.string().optional(),
      tool_name: z.string().optional(),
      error_type: z.string().optional(),
      error_signature: z.string().optional(),
      file_pattern: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => handlers.scar_context(args)
  );

  server.tool(
    "scar_briefing",
    "Session immune primer: returns top unresolved scars for a repo, ranked by frequency. Call at session start for instant situational awareness (~200 tokens).",
    {
      repo: z.string().optional().describe("Filter to a specific repository. Omit for all repos."),
    },
    async (args) => handlers.scar_briefing(args)
  );

  return { server, close: () => db.close() };
}

export async function startServer(dbPath?: string): Promise<void> {
  const { server, close } = createServer(dbPath);

  const shutdown = () => { close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
