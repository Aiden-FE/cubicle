/**
 * The engine-neutral event stream the rest of Cubicle consumes.
 *
 * The field names follow the engine adapter protocol in
 * `.scratch/cubicle/issues/14-engine-adapter-protocol.md`: text and thinking
 * deltas, tool execution boundaries, turn boundaries, and one terminal
 * `agent_end`. Adapters may be coarser than token level; consumers must treat
 * one delta as "some text", not "one token".
 *
 * @typedef {{ type: "session_start", sessionId?: string }} SessionStartEvent
 * @typedef {{ type: "turn_start" }} TurnStartEvent
 * @typedef {{ type: "text_delta", text: string }} TextDeltaEvent
 * @typedef {{ type: "thinking_delta", text: string }} ThinkingDeltaEvent
 * @typedef {{ type: "tool_execution_start", toolCallId: string, toolName: string, args: unknown }} ToolExecutionStartEvent
 * @typedef {{ type: "tool_execution_end", toolCallId: string, toolName: string, isError: boolean, result: unknown }} ToolExecutionEndEvent
 * @typedef {{ type: "turn_end", status: "ok" | "failed", usage?: Usage }} TurnEndEvent
 * @typedef {{ type: "agent_end", status: "ok" | "failed" | "unknown" }} AgentEndEvent
 * @typedef {{ type: "error", code: string, message: string }} ErrorEvent
 * @typedef {{ type: "unknown", rawType: string, itemType?: string, payload: unknown }} UnknownEvent
 * @typedef {{ input: number, cachedInput: number, cacheWrite: number, output: number, reasoning: number }} Usage
 * @typedef {SessionStartEvent | TurnStartEvent | TextDeltaEvent | ThinkingDeltaEvent | ToolExecutionStartEvent | ToolExecutionEndEvent | TurnEndEvent | AgentEndEvent | ErrorEvent | UnknownEvent} NormalizedEvent
 */

export {};
