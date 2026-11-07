/**
 * Failure folding — a failed run becomes ONE human sentence (票 12 验收 1:
 * 失败显示人话原因，不是堆栈).
 *
 * The run manager owns the facts: the status a run settled at plus the
 * normalized event tail it saw (error events, turn outcomes, agent_end).
 * This module is pure: same facts, same sentence — and the sentence is what
 * the store keeps as `run.fail_reason`, so the UI never re-derives anything.
 *
 * Vocabulary note (GLOSSARY: 执行 Run / 会话 Session): one 会话 has one run;
 * the reason is recorded on the run and read back through the task's latest
 * failed session.
 */

/**
 * @typedef {import("./events.mjs").NormalizedEvent} NormalizedEvent
 */

/**
 * Engine error codes the host itself raises (adapter / run manager), each
 * with the sentence the boss should see. Unknown codes keep the code and
 * the engine's own message — traceable, still one line.
 */
const KNOWN_CODES = /** @type {Record<string, string>} */ ({
  engine_not_configured: "引擎还没配置模型：去「引擎中心」把 models.json 放进 engines/pi/（BYOK）。",
  engine_model_missing: "引擎里找不到员工用的这个模型：检查引擎中心的模型配置（models.json）。",
  engine_unavailable: "这个引擎在当前版本里没有适配器：换员工的引擎，或等这个引擎的适配上线。",
  engine_failed: "引擎跑挂了，没有给出更细的原因。",
});

/**
 * @param {unknown} value
 * @returns {string} one line, no stack, capped
 */
function oneLine(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * Fold the run's ending into one human sentence.
 *
 * @param {{ status: "completed" | "aborted" | "failed" | "interrupted" | "paused", events: NormalizedEvent[] }} run
 *   the settled status and the normalized events the run streamed (in order)
 * @returns {string | null} null when no explanation is needed (completed, paused)
 */
export function explainRunFailure({ status, events }) {
  if (status === "completed" || status === "paused") return null;
  if (status === "interrupted") return "应用中途退出：这一轮被打断，没有跑完（崩溃恢复属票 10）。";
  if (status === "aborted") return "已取消：这一轮被叫停，工单按失败落账。";

  // failed: an error event is the most specific witness — the LAST one wins
  // (a run can surface several; the latest is closest to the ending).
  /** @type {{ code: string, message: string } | null} */
  let lastError = null;
  let lastTurnFailed = false;
  /** @type {string | null} */
  let endStatus = null;
  for (const event of events ?? []) {
    if (event.type === "error") lastError = { code: String(event.code ?? ""), message: String(event.message ?? "") };
    if (event.type === "turn_end" && event.status === "failed") lastTurnFailed = true;
    if (event.type === "agent_end") endStatus = String(event.status ?? "");
  }

  if (lastError) {
    const curated = KNOWN_CODES[lastError.code];
    const message = oneLine(lastError.message);
    if (curated) {
      const tail = message.length > 0 ? `（引擎原话：${message}）` : "";
      return `开跑失败：${curated}${tail}（${lastError.code}）`;
    }
    return `引擎报错（${lastError.code || "unknown"}）：${message || "引擎没有给出说明。"}`;
  }

  // An 'unknown' agent_end is the manager's honest marker for "the engine
  // settled without ever emitting agent_end" — say exactly that.
  if (endStatus === "unknown") {
    return "引擎没有回音就收场了：没有发出收尾事件，按失败处理。";
  }

  if (lastTurnFailed) {
    return "引擎这一轮以失败收场：模型侧报告失败，但没有留下更具体的说明。";
  }

  // No terminal marker at all (truncated tail): still the silent-settle story.
  if (endStatus === null) {
    return "引擎没有回音就收场了：没有发出收尾事件，按失败处理。";
  }
  return "执行失败：引擎没有报告更具体的原因。";
}
