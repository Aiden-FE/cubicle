/**
 * pi SDK session events → the engine-neutral stream (decision 14 protocol).
 *
 * pi is the token-level reference engine, so most events pass through almost
 * unchanged. `agent_settled` — NOT pi's `agent_end` — is the authoritative
 * end of a run: pi can follow `agent_end` with retries or queued work, so
 * closing on it would truncate sessions.
 *
 * Bookkeeping events the app does not consume are listed explicitly
 * (IGNORED_EVENTS), so any NEW pi event surfaces as `unknown` rather than
 * vanishing silently — the mapping must fail loudly, not quietly.
 *
 * @typedef {import("../events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("../events.mjs").Usage} Usage
 */

/**
 * pi chatter that carries no product meaning for the office view. Listed in
 * the open: adding a pi release event here is a deliberate, reviewable act.
 *
 * @type {ReadonlySet<string>}
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
 * Fold the pi `message_update` envelope: the real payload lives one level
 * down in `assistantMessageEvent`; only the two delta kinds matter.
 *
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedEvent[]}
 */
function foldMessageUpdate(raw) {
  const update = /** @type {Record<string, unknown> | undefined} */ (raw.assistantMessageEvent);
  const kind = typeof update?.type === "string" ? update.type : "";
  const delta = update?.delta;
  if (typeof delta !== "string") return [];
  if (kind === "text_delta") return [{ type: "text_delta", text: delta }];
  if (kind === "thinking_delta") return [{ type: "thinking_delta", text: delta }];
  return [];
}

/**
 * pi names tool boundaries literally; only the call id is hardened (tool
 * handlers correlate start/end by it, so a missing id would orphan an event).
 *
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedEvent[]}
 */
function foldToolStart(raw) {
  return [
    {
      type: "tool_execution_start",
      toolCallId: callIdOf(raw),
      toolName: String(raw.toolName ?? "unknown"),
      args: raw.args,
    },
  ];
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedEvent[]}
 */
function foldToolEnd(raw) {
  return [
    {
      type: "tool_execution_end",
      toolCallId: callIdOf(raw),
      toolName: String(raw.toolName ?? "unknown"),
      isError: raw.isError === true,
      result: raw.result,
    },
  ];
}

/**
 * `turn_end` carries the outcome (stopReason) and, when the provider
 * reported it, the usage numbers pi spells cacheRead/cacheWrite — folded
 * onto the neutral usage shape, missing numbers counting as zero.
 *
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedEvent[]}
 */
function foldTurnEnd(raw) {
  const message = /** @type {{ stopReason?: string, usage?: Record<string, unknown> } | undefined} */ (raw.message);
  const failed = message?.stopReason === "error" || message?.stopReason === "aborted";
  /** @type {{ type: "turn_end", status: "ok" | "failed", usage?: Usage }} */
  const folded = { type: "turn_end", status: failed ? "failed" : "ok" };
  if (message?.usage) {
    folded.usage = {
      input: count(message.usage.input),
      cachedInput: count(message.usage.cacheRead),
      cacheWrite: count(message.usage.cacheWrite),
      output: count(message.usage.output),
      reasoning: count(message.usage.reasoning),
    };
  }
  return [folded];
}

/**
 * The one true terminal event. pi's abort flag decides ok vs failed.
 *
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedEvent[]}
 */
function foldAgentSettled(raw) {
  return [{ type: "agent_end", status: raw.aborted === true ? "failed" : "ok" }];
}

/** @param {Record<string, unknown>} raw @returns {string} */
function callIdOf(raw) {
  return String(raw.toolCallId ?? "unknown");
}

/** @param {unknown} value @returns {number} */
function count(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * pi event type → folder. A map, not a switch: adding an engine event means
 * adding one row here (or one entry to IGNORED_EVENTS), never editing a long
 * conditional ladder.
 *
 * @type {ReadonlyMap<string, (raw: Record<string, unknown>) => NormalizedEvent[]>}
 */
const FOLDERS = new Map([
  ["message_update", foldMessageUpdate],
  ["tool_execution_start", foldToolStart],
  ["tool_execution_end", foldToolEnd],
  ["turn_start", () => [{ type: "turn_start" }]],
  ["turn_end", foldTurnEnd],
  ["agent_settled", foldAgentSettled],
]);

/**
 * @param {unknown} event one raw pi session event
 * @returns {NormalizedEvent[]} zero or more neutral events
 */
export function normalizePiEvent(event) {
  if (typeof event !== "object" || event === null || !("type" in event)) {
    return [{ type: "unknown", rawType: "invalid", payload: event }];
  }
  const raw = /** @type {{ type: string } & Record<string, unknown>} */ (event);

  const folder = FOLDERS.get(raw.type);
  if (folder) return folder(raw);
  if (IGNORED_EVENTS.has(raw.type)) return [];
  return [{ type: "unknown", rawType: raw.type, payload: event }];
}
