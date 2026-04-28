import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runLog } from "./commands/log.js";
import { runRecall } from "./commands/recall.js";
import { runStats } from "./commands/stats.js";
import { runForget } from "./commands/forget.js";
import { runExport } from "./commands/export.js";
import { runBriefing } from "./commands/briefing.js";
import { runMine } from "./commands/mine.js";

export function main(): void {
  const program = new Command();

  program.name("scar").description("Failure memory for AI agents").version("0.2.0");

  program.command("init")
    .description("Set up database, optional Claude Code hooks, optional MCP server")
    .option("--claude-code", "Generate Claude Code auto-capture hooks (recommended)")
    .option("--with-mcp", "Also emit MCP server config for active lookup tools (opt-in)")
    .action((options) => {
      const result = runInit({ claudeCode: options.claudeCode, withMcp: options.withMcp });
      for (const msg of result.messages) console.log(msg);
      if (result.claudeCodeHooks) {
        console.log("\nClaude Code hooks:");
        console.log(JSON.stringify(result.claudeCodeHooks, null, 2));
      }
      if (result.mcpConfig) {
        console.log("\nMCP config (add to ~/.mcp.json under 'mcpServers'):");
        console.log(JSON.stringify(result.mcpConfig, null, 2));
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
    .option("--severity <level>", "Severity: low, medium, high", "medium")
    .option("--source <source>", "Capture source: auto-hook, manual, briefing-follow-up", "manual")
    .action((options) => {
      const result = runLog({
        repo: options.repo, language: options.language, tool: options.tool,
        errorType: options.errorType, errorSignature: options.errorSignature,
        exitCode: options.exitCode, filePattern: options.filePattern,
        tried: options.tried, wrong: options.wrong, worked: options.worked,
        resolution: options.resolution, tags: options.tags,
        severity: options.severity, source: options.source,
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

  program.command("briefing")
    .description("Session immune primer: top unresolved scars ranked by frequency")
    .option("-r, --repo <repo>", "Filter to a specific repository")
    .action((options) => { console.log(runBriefing({ repo: options.repo })); });

  program.command("mine <transcript-path>")
    .description("Extract failures from a Claude Code session transcript")
    .option("-r, --repo <repo>", "Repository name (default: derived from transcript)")
    .option("--dry-run", "Show what would be logged without logging")
    .action((transcriptPath, options) => {
      console.log(runMine({
        transcriptPath,
        repo: options.repo,
        dryRun: options.dryRun,
      }));
    });

  program.command("export")
    .description("Export all scars as JSON")
    .action(() => { console.log(runExport()); });

  program.parse();
}
