export function generateClaudeCodeHooks() {
  return {
    hooks: {
      post_tool_call: {
        description: "Auto-capture tool failures to Scar",
        command: "scar log --repo $REPO --language $LANGUAGE --tool $TOOL --error-signature \"$ERROR\" --tried \"$TRIED\" --wrong \"$WRONG\"",
      },
    },
  };
}
