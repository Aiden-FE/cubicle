/**
 * Normalizes the strict JSONL stream from `codex exec --json` into the
 * engine-neutral event stream documented in `events.mjs`.
 *
 * Codex emits whole items rather than token deltas, so `agent_message`
 * becomes one `text_delta`. Non-JSON lines (for example stderr diagnostics
 * that were merged into stdout by a shell redirection) are counted and
 * ignored instead of aborting the run.
 *
 * @typedef {import("./events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("./events.mjs").Usage} Usage
 *
 * @typedef {object} CodexNormalizer
 * @property {(line: string) => void} push Feed one raw stdout line.
 * @property {() => NormalizedEvent[]} end Flush the terminal event and return the stream.
 * @property {number} ignoredLines Count of blank or non-JSON lines.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} raw
 * @returns {Usage}
 */
function normalizeUsage(raw) {
  const usage = isRecord(raw) ? raw : {};
  return {
    input: numberOrZero(usage.input_tokens),
    cachedInput: numberOrZero(usage.cached_input_tokens),
    cacheWrite: numberOrZero(usage.cache_write_input_tokens),
    output: numberOrZero(usage.output_tokens),
    reasoning: numberOrZero(usage.reasoning_output_tokens),
  };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @returns {CodexNormalizer}
 */
export function createCodexNormalizer() {
  /** @type {NormalizedEvent[]} */
  const events = [];
  /** @type {"ok" | "failed" | "unknown"} */
  let lastTurnStatus = "unknown";
  let ignoredLines = 0;

  /**
   * @param {Record<string, any>} record
   * @param {"started" | "completed"} phase
   */
  function pushItem(record, phase) {
    const item = isRecord(record.item) ? record.item : {};
    const itemType = typeof item.type === "string" ? item.type : "";
    const itemId = typeof item.id === "string" ? item.id : "unknown";

    switch (itemType) {
      case "reasoning": {
        if (phase === "completed" && typeof item.text === "string" && item.text.length > 0) {
          events.push({ type: "thinking_delta", text: item.text });
        }
        return;
      }
      case "agent_message": {
        if (phase === "completed" && typeof item.text === "string") {
          events.push({ type: "text_delta", text: item.text });
        }
        return;
      }
      case "command_execution": {
        const toolName = "shell";
        if (phase === "started") {
          events.push({
            type: "tool_execution_start",
            toolCallId: itemId,
            toolName,
            args: { command: item.command },
          });
          return;
        }
        const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;
        const status = typeof item.status === "string" ? item.status : "unknown";
        events.push({
          type: "tool_execution_end",
          toolCallId: itemId,
          toolName,
          isError: status !== "completed" || (exitCode !== null && exitCode !== 0),
          result: {
            output: typeof item.aggregated_output === "string" ? item.aggregated_output : "",
            exitCode,
            status,
          },
        });
        return;
      }
      default: {
        events.push({
          type: "unknown",
          rawType: `item.${phase}`,
          itemType: itemType || undefined,
          payload: item,
        });
      }
    }
  }

  return {
    get ignoredLines() {
      return ignoredLines;
    },

    push(line) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return;
      }

      /** @type {unknown} */
      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        ignoredLines += 1;
        return;
      }

      if (!isRecord(record) || typeof record.type !== "string") {
        ignoredLines += 1;
        return;
      }

      switch (record.type) {
        case "thread.started": {
          events.push({
            type: "session_start",
            sessionId: typeof record.thread_id === "string" ? record.thread_id : undefined,
          });
          return;
        }
        case "turn.started": {
          lastTurnStatus = "unknown";
          events.push({ type: "turn_start" });
          return;
        }
        case "item.started": {
          pushItem(record, "started");
          return;
        }
        case "item.completed": {
          pushItem(record, "completed");
          return;
        }
        case "turn.completed": {
          lastTurnStatus = "ok";
          events.push({
            type: "turn_end",
            status: "ok",
            usage: normalizeUsage(record.usage),
          });
          return;
        }
        case "turn.failed": {
          lastTurnStatus = "failed";
          const error = isRecord(record.error) ? record.error : {};
          events.push({
            type: "error",
            code: "turn_failed",
            message: typeof error.message === "string" ? error.message : "codex turn failed",
          });
          events.push({ type: "turn_end", status: "failed" });
          return;
        }
        case "error": {
          events.push({
            type: "error",
            code: "provider_error",
            message: typeof record.message === "string" ? record.message : "codex error",
          });
          return;
        }
        default: {
          events.push({
            type: "unknown",
            rawType: record.type,
            payload: record,
          });
        }
      }
    },

    end() {
      events.push({ type: "agent_end", status: lastTurnStatus });
      return events;
    },
  };
}
