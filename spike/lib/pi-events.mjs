/**
 * Maps pi SDK session events onto the engine-neutral event stream.
 *
 * pi is the token-level reference engine, so most events pass through almost
 * unchanged. `agent_settled` is the authoritative end of a session run
 * (`agent_end` in pi can be followed by retries or queued work).
 *
 * @typedef {import("./events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("./events.mjs").Usage} Usage
 */

/**
 * Session events that are intentionally not part of the neutral stream.
 * Keeping the list explicit means a new pi event shows up as `unknown`
 * instead of disappearing silently.
 *
 * @type {Set<string>}
 */
const IGNORED_EVENTS = new Set([
  "agent_start",
  "agent_end",
  "auto_retry_end",
  "auto_retry_start",
  "compaction_end",
  "compaction_start",
  "entry_appended",
  "message_end",
  "message_start",
  "model_select",
  "queue_update",
  "session_info_changed",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "summarization_retry_scheduled",
  "thinking_level_changed",
  "tool_execution_update",
]);

/**
 * @param {unknown} value
 * @returns {number}
 */
function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @param {unknown} raw
 * @returns {Usage | undefined}
 */
function normalizeUsage(raw) {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const usage = /** @type {Record<string, any>} */ (raw);
  return {
    input: numberOrZero(usage.input),
    cachedInput: numberOrZero(usage.cacheRead),
    cacheWrite: numberOrZero(usage.cacheWrite),
    output: numberOrZero(usage.output),
    reasoning: numberOrZero(usage.reasoning),
  };
}

/**
 * @param {unknown} event
 * @returns {NormalizedEvent[]}
 */
export function normalizePiEvent(event) {
  if (typeof event !== "object" || event === null || !("type" in event)) {
    return [{ type: "unknown", rawType: "invalid", payload: event }];
  }

  const raw = /** @type {{ type: string, [key: string]: any }} */ (event);

  switch (raw.type) {
    case "message_update": {
      const update = raw.assistantMessageEvent;
      if (update?.type === "text_delta" && typeof update.delta === "string") {
        return [{ type: "text_delta", text: update.delta }];
      }
      if (update?.type === "thinking_delta" && typeof update.delta === "string") {
        return [{ type: "thinking_delta", text: update.delta }];
      }
      return [];
    }
    case "tool_execution_start": {
      return [
        {
          type: "tool_execution_start",
          toolCallId: String(raw.toolCallId ?? "unknown"),
          toolName: String(raw.toolName ?? "unknown"),
          args: raw.args,
        },
      ];
    }
    case "tool_execution_end": {
      return [
        {
          type: "tool_execution_end",
          toolCallId: String(raw.toolCallId ?? "unknown"),
          toolName: String(raw.toolName ?? "unknown"),
          isError: raw.isError === true,
          result: raw.result,
        },
      ];
    }
    case "turn_start": {
      return [{ type: "turn_start" }];
    }
    case "turn_end": {
      const stopReason = raw.message?.stopReason;
      const failed = stopReason === "error" || stopReason === "aborted";
      const usage = normalizeUsage(raw.message?.usage);
      return [usage ? { type: "turn_end", status: failed ? "failed" : "ok", usage } : { type: "turn_end", status: failed ? "failed" : "ok" }];
    }
    case "agent_settled": {
      return [{ type: "agent_end", status: raw.aborted === true ? "failed" : "ok" }];
    }
    default: {
      return IGNORED_EVENTS.has(raw.type)
        ? []
        : [{ type: "unknown", rawType: raw.type, payload: event }];
    }
  }
}
