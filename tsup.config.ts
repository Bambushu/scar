import { defineConfig } from "tsup";

export default defineConfig([
  // Bin entries (need shebang)
  {
    entry: {
      "bin/scar": "bin/scar.ts",
      "bin/scar-mcp": "bin/scar-mcp.ts",
    },
    format: ["esm"],
    target: "node22",
    platform: "node",
    sourcemap: true,
    clean: false,
    splitting: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  // Library entries (no shebang)
  {
    entry: {
      "core/database": "src/core/database.ts",
      "core/schema": "src/core/schema.ts",
      "core/matcher": "src/core/matcher.ts",
      "mcp/server": "src/mcp/server.ts",
      "mcp/tools": "src/mcp/tools.ts",
      "cli/index": "src/cli/index.ts",
      "adapter/claude-code": "src/adapter/claude-code.ts",
      "shared/event-format": "src/shared/event-format.ts",
      "shared/constants": "src/shared/constants.ts",
    },
    format: ["esm"],
    target: "node22",
    platform: "node",
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
  },
]);
