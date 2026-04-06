/** Shared cognitive toolkit event — used across scar, calibration, focus */
export interface CognitiveEvent {
  event_type: "failure" | "confidence" | "drift" | "anomaly";
  source: "scar" | "calibration" | "focus";
  timestamp: string;
  context: {
    repo?: string;
    language?: string;
    tool?: string;
    task_description?: string;
  };
  payload: Record<string, unknown>;
}

/** Create a Scar failure event */
export function createFailureEvent(context: {
  repo?: string;
  language?: string;
  tool?: string;
  task_description?: string;
  payload?: Record<string, unknown>;
}): CognitiveEvent {
  return {
    event_type: "failure",
    source: "scar",
    timestamp: new Date().toISOString(),
    context: {
      repo: context.repo,
      language: context.language,
      tool: context.tool,
      task_description: context.task_description,
    },
    payload: context.payload ?? {},
  };
}
