#!/bin/bash
# Scar auto-capture hook for Claude Code
# Triggers on PostToolUse for Bash commands with non-zero exit codes
# Logs failures to Scar's SQLite database via CLI

SCAR_BIN="${SCAR_BIN:-$(cd "$(dirname "$0")/.." && pwd)/dist/bin/scar.js}"
INPUT=$(cat)

# Use printf to safely handle JSON with control characters
EXIT_CODE=$(printf '%s' "$INPUT" | jq -r '.tool_response.exitCode // 0' 2>/dev/null)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // "unknown"' 2>/dev/null)
OUTPUT=$(printf '%s' "$INPUT" | jq -r '.tool_response.output // ""' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null)

# Only log actual failures (non-zero exit)
[ "$EXIT_CODE" = "0" ] && exit 0
[ "$EXIT_CODE" = "null" ] && exit 0
[ -z "$EXIT_CODE" ] && exit 0

# Skip trivial failures (grep no match, test checks, which not found)
case "$COMMAND" in
  "which "*|"command -v "*) exit 0 ;;
  "grep "*|"rg "*) [ "$EXIT_CODE" = "1" ] && exit 0 ;;
  "test "*|"[ "*) exit 0 ;;
  "ls "*"2>/dev/null"*) exit 0 ;;
esac

# Derive repo from cwd
REPO=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Detect language from command/output
LANG="bash"
case "$OUTPUT" in
  *TypeError*|*SyntaxError*|*ReferenceError*) LANG="javascript" ;;
  *Traceback*|*ImportError*|*IndentationError*) LANG="python" ;;
  *"cargo error"*|*panicked*) LANG="rust" ;;
esac

# Extract error signature: first error-like line, max 200 chars
ERROR_SIG=$(printf '%s' "$OUTPUT" | grep -m1 -iE '(error|fatal|fail|panic|exception|traceback|denied|not found|ENOENT|EACCES)' | head -c 200)
[ -z "$ERROR_SIG" ] && ERROR_SIG=$(printf '%s' "$OUTPUT" | tail -1 | head -c 200)

# Log to scar (fire and forget, don't block Claude)
node "$SCAR_BIN" log -r "$REPO" -l "$LANG" -t bash -e "$ERROR_SIG" --tried "$COMMAND" --wrong "Exit code $EXIT_CODE" --exit-code "$EXIT_CODE" --tags "auto-hook" &>/dev/null &

exit 0
