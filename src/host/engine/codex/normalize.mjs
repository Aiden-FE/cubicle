/**
 * codex JSONL → normalized event stream (ticket 11).
 *
 * `codex exec --json` (proven against codex-cli 0.163.0) emits whole items,
 * not token deltas: one `agent_message` becomes one `text_delta`, and the
 * stream's terminal fact is the process closing, not an engine event — so
 * `end()` synthesizes exactly one `agent_end`, mirroring the pi adapter's
 * protocol duty (every run ends with one agent_end, see run-manager).
 *
 * This is a table folder like pi/normalize.mjs — a new codex record type is
 * one row in RECORD_FOLDERS, not another switch arm. Non-JSON lines (stderr
 * diagnostics merged into stdout) are counted and skipped; unrecognized
 * records become `unknown` events so a codex upgrade never silently eats a
 * turn. Item-level `type: "error"` records ride as error events, except the
 * benign warnings this app's own launch flags produce (hook-trust bypass,
 * unknown model metadata) — those are counted into `warningLines` instead of
 * scaring the timeline red.
 *
 * @typedef {import("../events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("../events.mjs").Usage} Usage
 *
 * @typedef {object} CodexNormalizer
 * @property {(line: string) => void} push Feed one raw stdout line.
 * @property {() => NormalizedEvent[]} end Flush the terminal event, return the stream.
 * @property {number} ignoredLines Count of blank or non-JSON lines.
 * @property {number} warningLines Count of benign engine warnings folded away.
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {number} */
function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * codex's usage object → the shared Usage shape (same field names the pi
 * normalize produces, so the timeline renders both identically).
 * @param {unknown} raw @returns {Usage}
 */
function toUsage(raw) {
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
 * Launch flags this adapter sets itself produce warning items every run;
 * forwarding them as `error` events would put red lines on every codex
 * conversation. Matched by message needle, counted, and shown in the engine
 * card's probe report instead.
 */
const BENIGN_WARNING_NEEDLES = [
  "--dangerously-bypass-hook-trust",
  "Model metadata for",
];

/**
 * codex `command_execution` item → tool vocabulary. The normalized tool name
 * stays "shell" (M0 convention): policy.mjs treats it as a shell tool, and
 * the desk's tool-activity table maps it to the exec/test postures.
 *
 * @param {Record<string, any>} item
 * @param {"started" | "completed"} phase
 * @returns {NormalizedEvent[]}
 */
function foldCommandExecution(item, phase) {
  const toolCallId = typeof item.id === "string" ? item.id : "unknown";
  if (phase === "started") {
    return [
      {
        type: "tool_execution_start",
        toolCallId,
        toolName: "shell",
        args: { command: item.command },
      },
    ];
  }
  const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;
  const status = typeof item.status === "string" ? item.status : "unknown";
  return [
    {
      type: "tool_execution_end",
      toolCallId,
      toolName: "shell",
      isError: status !== "completed" || (exitCode !== null && exitCode !== 0),
      result: {
        output: typeof item.aggregated_output === "string" ? item.aggregated_output : "",
        exitCode,
        status,
      },
    },
  ];
}

/**
 * Item-type folder table for `item.started` / `item.completed` records.
 * @type {ReadonlyMap<string, (item: Record<string, any>, phase: "started" | "completed") => NormalizedEvent[]>}
 */
const ITEM_FOLDERS = new Map([
  [
    "reasoning",
    (item, phase) =>
      phase === "completed" && typeof item.text === "string" && item.text.length > 0
        ? [{ type: "thinking_delta", text: item.text }]
        : [],
  ],
  [
    "agent_message",
    (item, phase) =>
      phase === "completed" && typeof item.text === "string"
        ? [{ type: "text_delta", text: item.text }]
        : [],
  ],
  ["command_execution", foldCommandExecution],
]);

/**
 * @returns {CodexNormalizer}
 */
export function createCodexNormalizer() {
  /** @type {NormalizedEvent[]} */
  const events = [];
  /** @type {"ok" | "failed" | "unknown"} */
  let lastTurnStatus = "unknown";
  let ignoredLines = 0;
  let warningLines = 0;

  function foldItemRecord(/** @type {Record<string, any>} */ record) {
    const phase = record.type === "item.started" ? "started" : "completed";
    const item = isRecord(record.item) ? record.item : {};
    const folder = ITEM_FOLDERS.get(typeof item.type === "string" ? item.type : "");
    if (folder) {
      events.push(...folder(item, phase));
      return;
    }
    if (item.type === "error" && typeof item.message === "string") {
      if (BENIGN_WARNING_NEEDLES.some((needle) => item.message.includes(needle))) {
        warningLines += 1;
        return;
      }
      events.push({ type: "error", code: "codex_item_error", message: item.message });
      return;
    }
    events.push({ type: "unknown", rawType: String(record.type), payload: item });
  }

  /**
   * Top-level record table. A new codex record type = one row here; the
   * default keeps forward compatibility as `unknown` diagnostics.
   * @type {ReadonlyMap<string, (record: Record<string, any>) => void>}
   */
  const RECORD_FOLDERS = new Map([
    [
      "thread.started",
      (record) => {
        events.push({
          type: "session_start",
          sessionId: typeof record.thread_id === "string" ? record.thread_id : undefined,
        });
      },
    ],
    [
      "turn.started",
      () => {
        lastTurnStatus = "unknown";
        events.push({ type: "turn_start" });
      },
    ],
    ["item.started", foldItemRecord],
    ["item.completed", foldItemRecord],
    [
      "turn.completed",
      (record) => {
        lastTurnStatus = "ok";
        events.push({ type: "turn_end", status: "ok", usage: toUsage(record.usage) });
      },
    ],
    [
      "turn.failed",
      (record) => {
        lastTurnStatus = "failed";
        const error = isRecord(record.error) ? record.error : {};
        events.push({
          type: "error",
          code: "turn_failed",
          message: typeof error.message === "string" ? error.message : "codex turn failed",
        });
        events.push({ type: "turn_end", status: "failed" });
      },
    ],
    [
      "error",
      (record) => {
        events.push({
          type: "error",
          code: "provider_error",
          message: typeof record.message === "string" ? record.message : "codex error",
        });
      },
    ],
  ]);

  return {
    get ignoredLines() {
      return ignoredLines;
    },
    get warningLines() {
      return warningLines;
    },

    push(line) {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

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

      const fold = RECORD_FOLDERS.get(record.type);
      if (fold) {
        fold(record);
        return;
      }
      events.push({ type: "unknown", rawType: record.type, payload: record });
    },

    end() {
      // The process closed: whatever the last turn reported is the run's
      // verdict; a stream that never completed a turn is an honest "unknown"
      // (run-manager records that as failed — never a clean end).
      events.push({ type: "agent_end", status: lastTurnStatus });
      return events;
    },
  };
}
