import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runLog } from "./commands/log.js";
import { runRecall } from "./commands/recall.js";
import { runStats } from "./commands/stats.js";
import { runForget } from "./commands/forget.js";
import { runExport } from "./commands/export.js";

export function main(): void {
  const program = new Command();

  program.name("scar").description("Failure memory for AI agents").version("0.1.0");

  program.command("init")
    .description("Set up database, MCP config, and optional Claude Code hooks")
    .option("--claude-code", "Also generate Claude Code auto-capture hooks")
    .action((options) => {
      const result = runInit({ claudeCode: options.claudeCode });
      for (const msg of result.messages) console.log(msg);
      console.log("\nMCP config (add to ~/.mcp.json under 'mcpServers'):");
      console.log(JSON.stringify(result.mcpConfig, null, 2));
      if (result.claudeCodeHooks) {
        console.log("\nClaude Code hooks:");
        console.log(JSON.stringify(result.claudeCodeHooks, null, 2));
      }
    });

  program.command("log")
    .description("Manually record a failure")
    .requiredOption("-r, --repo <repo>", "Repository name")
    .requiredOption("-l, --language <lang>", "Language")
    .requiredOption("-t, --tool <tool>", "Tool that failed")
    .requiredOption("-e, --error-signature <sig>", "Error first line")
    .requiredOption("--tried <text>", "What was attempted")
    .requiredOption("--wrong <text>", "What went wrong")
    .option("--error-type <type>", "Error category", "other")
    .option("--exit-code <code>", "Exit code", parseInt)
    .option("--file-pattern <pattern>", "File category", "other")
    .option("--worked <text>", "What fixed it")
    .option("--resolution <type>", "Resolution type", "unknown")
    .option("--tags <tags...>", "Custom labels")
    .action((options) => {
      const result = runLog({
        repo: options.repo, language: options.language, tool: options.tool,
        errorType: options.errorType, errorSignature: options.errorSignature,
        exitCode: options.exitCode, filePattern: options.filePattern,
        tried: options.tried, wrong: options.wrong, worked: options.worked,
        resolution: options.resolution, tags: options.tags,
      });
      console.log(result);
    });

  program.command("recall [context]")
    .description("Query for relevant past failures")
    .option("-r, --repo <repo>", "Filter by repository")
    .option("-l, --language <lang>", "Filter by language")
    .option("-t, --tool <tool>", "Filter by tool")
    .option("-e, --error-signature <sig>", "Match error")
    .option("--error-type <type>", "Filter by error type")
    .option("--file-pattern <pattern>", "Filter by file pattern")
    .option("--tags <tags...>", "Match tags")
    .action((_context, options) => {
      const result = runRecall({
        repo: options.repo, language: options.language, tool: options.tool,
        errorType: options.errorType, errorSignature: options.errorSignature,
        filePattern: options.filePattern, tags: options.tags,
      });
      console.log(result);
    });

  program.command("stats")
    .description("Show aggregate failure patterns")
    .option("--stale", "Show only stale unresolved scars (> 90 days)")
    .action((options) => { console.log(runStats({ stale: options.stale })); });

  program.command("forget <id>")
    .description("Remove a scar by ID")
    .action((id) => { console.log(runForget({ id })); });

  program.command("export")
    .description("Export all scars as JSON")
    .action(() => { console.log(runExport()); });

  program.parse();
}
