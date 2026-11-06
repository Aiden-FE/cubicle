/**
 * The engine-neutral event stream the whole app consumes (decision 14, v1
 * executable subset — same vocabulary proven by the M0 spike).
 *
 * Adapters may be coarser than token level; consumers must treat one
 * text_delta as "some text", not "one token". Every run ends with exactly
 * one terminal `agent_end` (adapters synthesize one if the engine settles
 * without it). `usage` rides on turn_end where the engine reports it.
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
 * @typedef {{ type: "unknown", rawType: string, payload: unknown }} UnknownEvent
 * @typedef {{ input: number, cachedInput: number, cacheWrite: number, output: number, reasoning: number }} Usage
 * @typedef {SessionStartEvent | TurnStartEvent | TextDeltaEvent | ThinkingDeltaEvent | ToolExecutionStartEvent | ToolExecutionEndEvent | TurnEndEvent | AgentEndEvent | ErrorEvent | UnknownEvent} NormalizedEvent
 */
