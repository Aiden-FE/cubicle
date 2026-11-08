/**
 * codex JSONL → normalized event stream (ticket 11).
 *
 * `codex exec --json` (proven against codex-cli 0.163.0) emits whole items,
 * not token deltas: one `agent_message` becomes one `text_delta`, and the
 * stream's terminal fact is the process closing, not an engine event — so
 * `end()` synthesizes exactly one `agent_end`, mirroring the pi adapter's
 * protocol duty (every run ends with one agent_end, see run-manager).
 *
 * `push` returns the events folded from THAT line, not a growing transcript:
 * the CLI host forwards them as the lines land, so a codex run animates the
 * 工位 while it works (read → exec → done) exactly like the SDK host. Buffering
 * everything until exit would paint the whole run in one frame and the desk
 * would never show a posture (ticket 11's 复用 07 的工位 reducer).
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
 * @property {(line: string) => NormalizedEvent[]} push Feed one raw stdout line; returns that line's events.
 * @property {(exitOk?: boolean) => NormalizedEvent[]} end Flush the terminal event (exactly one agent_end).
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
        // The artifact collector caps display text; the event tail must not
        // carry a 10 MB command log into memory / across the process bridge.
        output: String(typeof item.aggregated_output === "string" ? item.aggregated_output : "").slice(0, 20_000),
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
  /** @type {"ok" | "failed" | "unknown"} */
  let lastTurnStatus = "unknown";
  let ignoredLines = 0;
  let warningLines = 0;

  /** @param {Record<string, any>} record @returns {NormalizedEvent[]} */
  function foldItemRecord(record) {
    const phase = record.type === "item.started" ? "started" : "completed";
    const item = isRecord(record.item) ? record.item : {};
    const folder = ITEM_FOLDERS.get(typeof item.type === "string" ? item.type : "");
    if (folder) return folder(item, phase);
    if (item.type === "error" && typeof item.message === "string") {
      if (BENIGN_WARNING_NEEDLES.some((needle) => item.message.includes(needle))) {
        warningLines += 1;
        return [];
      }
      return [{ type: "error", code: "codex_item_error", message: item.message }];
    }
    return [{ type: "unknown", rawType: String(record.type), payload: item }];
  }

  /**
   * Top-level record table. A new codex record type = one row here; the
   * default keeps forward compatibility as `unknown` diagnostics.
   * @type {ReadonlyMap<string, (record: Record<string, any>) => NormalizedEvent[]>}
   */
  const RECORD_FOLDERS = new Map([
    [
      "thread.started",
      (record) => [
        {
          type: "session_start",
          sessionId: typeof record.thread_id === "string" ? record.thread_id : undefined,
        },
      ],
    ],
    [
      "turn.started",
      () => {
        lastTurnStatus = "unknown";
        return [{ type: "turn_start" }];
      },
    ],
    ["item.started", foldItemRecord],
    ["item.completed", foldItemRecord],
    [
      "turn.completed",
      (record) => {
        lastTurnStatus = "ok";
        const usage = toUsage(record.usage);
        // pi treats an all-zero usage as "the provider never spoke about
        // tokens"; codex must use the same semantics or an unmeasured engine
        // silently bills as 0 and the budget gate never trips.
        return [
          {
            type: "turn_end",
            status: "ok",
            ...(Object.values(usage).some((n) => n > 0) ? { usage } : {}),
          },
        ];
      },
    ],
    [
      "turn.failed",
      (record) => {
        lastTurnStatus = "failed";
        const error = isRecord(record.error) ? record.error : {};
        return [
          {
            type: "error",
            code: "turn_failed",
            message: typeof error.message === "string" ? error.message : "codex turn failed",
          },
          { type: "turn_end", status: "failed" },
        ];
      },
    ],
    [
      "error",
      (record) => [
        {
          type: "error",
          code: "provider_error",
          message: typeof record.message === "string" ? record.message : "codex error",
        },
      ],
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
      if (trimmed.length === 0) return [];

      /** @type {unknown} */
      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        ignoredLines += 1;
        return [];
      }
      if (!isRecord(record) || typeof record.type !== "string") {
        ignoredLines += 1;
        return [];
      }

      const fold = RECORD_FOLDERS.get(record.type);
      if (fold) return fold(record);
      return [{ type: "unknown", rawType: record.type, payload: record }];
    },

    end(exitOk = true) {
      // The process closed: whatever the last turn reported is the run's
      // verdict; a stream that never completed a turn is an honest "unknown"
      // (run-manager records that as failed — never a clean end). A non-zero
      // exit after the last turn overrides "ok": a partially successful
      // process must not be recorded as a clean completion.
      return [{ type: "agent_end", status: exitOk ? lastTurnStatus : "failed" }];
    },
  };
}
