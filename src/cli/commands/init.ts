import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { ScarDatabase } from "../../core/database.js";
import { COGNITIVE_DIR, SCAR_DIR, DB_PATH } from "../../shared/constants.js";
import { generateClaudeCodeHooks } from "../../adapter/claude-code.js";

interface InitOptions {
  cognitiveDir?: string;
  dbPath?: string;
  claudeCode?: boolean;
}

interface InitResult {
  mcpConfig: Record<string, { command: string; args: string[] }>;
  claudeCodeHooks?: ReturnType<typeof generateClaudeCodeHooks>;
  messages: string[];
}

export function runInit(options: InitOptions = {}): InitResult {
  const cognitiveDir = options.cognitiveDir ?? COGNITIVE_DIR;
  const scarDir = join(cognitiveDir, "scar");
  const dbPath = options.dbPath ?? DB_PATH;
  const messages: string[] = [];

  if (!existsSync(cognitiveDir)) {
    mkdirSync(cognitiveDir, { recursive: true });
    messages.push(`Created ${cognitiveDir}`);
  }
  if (!existsSync(scarDir)) {
    mkdirSync(scarDir, { recursive: true });
    messages.push(`Created ${scarDir}`);
  }

  const db = new ScarDatabase(dbPath);
  db.close();
  messages.push(`Database ready at ${dbPath}`);

  const mcpConfig = {
    scar: { command: "scar-mcp", args: [] as string[] },
  };
  messages.push("MCP config generated. Add to ~/.mcp.json under 'mcpServers'.");

  let claudeCodeHooks: ReturnType<typeof generateClaudeCodeHooks> | undefined;
  if (options.claudeCode) {
    claudeCodeHooks = generateClaudeCodeHooks();
    messages.push("Claude Code hooks generated.");
  }

  return { mcpConfig, claudeCodeHooks, messages };
}
