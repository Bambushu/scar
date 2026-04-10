#!/bin/bash
# Scar stop hook: mine current session transcript (fast path, best-effort)
# Not guaranteed to fire (ctrl-C, crash skip it) - SessionStart is the fallback

SCAR_BIN="/Users/mikes/scar/dist/bin/scar.js"
MINED_LOG="$HOME/.cognitive/scar/mined.log"
INPUT=$(cat)

TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null)
REPO=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Skip if no transcript or already mined
[ -z "$TRANSCRIPT" ] && exit 0
[ "$TRANSCRIPT" = "null" ] && exit 0
[ ! -f "$TRANSCRIPT" ] && exit 0
grep -qF "$TRANSCRIPT" "$MINED_LOG" 2>/dev/null && exit 0

# Ensure mined log directory exists
mkdir -p "$(dirname "$MINED_LOG")" 2>/dev/null

# Mine the transcript
node "$SCAR_BIN" mine "$TRANSCRIPT" --repo "$REPO" &>/dev/null

# Mark as mined
echo "$TRANSCRIPT" >> "$MINED_LOG"

exit 0
