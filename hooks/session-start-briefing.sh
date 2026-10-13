#!/bin/bash
# Scar session-start hook: mine previous transcripts + show briefing
# Primary capture path (guaranteed to fire every session)

SCAR_BIN="${SCAR_BIN:-$(cd "$(dirname "$0")/.." && pwd)/dist/bin/scar.js}"
MINED_LOG="$HOME/.cognitive/scar/mined.log"
INPUT=$(cat)

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null)
REPO=$(basename "$CWD" 2>/dev/null || echo "unknown")
PROJECTS_DIR="$HOME/.claude/projects"

# Ensure mined log directory exists
mkdir -p "$(dirname "$MINED_LOG")" 2>/dev/null

# Mine un-mined transcripts from previous sessions
if [ -d "$PROJECTS_DIR" ]; then
  find "$PROJECTS_DIR" -name "*.jsonl" -mtime -7 2>/dev/null | while read -r transcript; do
    # Skip if already mined
    if grep -qF "$transcript" "$MINED_LOG" 2>/dev/null; then
      continue
    fi
    # Mine it (fire and forget, don't block session start)
    node "$SCAR_BIN" mine "$transcript" --repo "$REPO" &>/dev/null
    # Mark as mined
    echo "$transcript" >> "$MINED_LOG"
  done
fi

# Show briefing
OUTPUT=$(node "$SCAR_BIN" briefing --repo "$REPO" 2>/dev/null)
if [ -n "$OUTPUT" ]; then
  echo "$OUTPUT"
fi

exit 0
