/**
 * Task artifacts — the 四件套 a finished work order leaves behind
 * (ticket 05: diff 摘要 / 变更文件清单 / 命令输出 / 收尾报告).
 *
 * The run manager hands this module the whole normalized event tail of a
 * task run plus the run outcome; the git door (src/host/git) supplies the
 * diff relative to the start HEAD the task recorded at creation. Everything
 * it produces is honest text: an unreadable workspace says so in the
 * artifact instead of leaving the slot empty, and an engine that never
 * spoke gets a report that says nobody spoke.
 */

/**
 * @typedef {import("../engine/events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("../store.mjs").RunRow} RunRow
 *
 * @typedef {{ at: number, event: NormalizedEvent }} TimedEvent
 * @typedef {{ run: RunRow, status: "completed" | "aborted" | "failed", events: TimedEvent[] }} TaskRunFinished
 */

/** Keep artifacts viewable through IPC: generous, but bounded. */
const TEXT_CAP = 20_000;

/**
 * @param {string} text
 * @returns {string}
 */
function cap(text) {
  if (text.length <= TEXT_CAP) return text;
  return `${text.slice(0, TEXT_CAP)}\n…（已截断，共 ${text.length} 字符）`;
}

/** @param {string} sha @returns {string} */
function short(sha) {
  return `${sha.slice(0, 7)}…`;
}

/**
 * Render a tool result as display text (strings pass through, anything
 * else is JSON — an object result is data, not something to pretty-print
 * half away).
 *
 * @param {unknown} result
 * @returns {string}
 */
function resultText(result) {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "";
  try {
    return JSON.stringify(result, null, 2) ?? String(result);
  } catch {
    return String(result);
  }
}

/**
 * Every bash command the run executed, with its output — this is where
 * 测试 output surfaces in the artifacts (验收: 命令输出).
 *
 * @param {TimedEvent[]} events
 * @returns {string}
 */
export function commandTranscript(events) {
  // commands ride the START events; outputs ride the END events — join on call id.
  /** @type {Map<string, string>} */
  const commands = new Map();
  for (const { event } of events) {
    if (event.type !== "tool_execution_start" || event.toolName !== "bash") continue;
    const args = /** @type {Record<string, unknown> | null} */ (event.args);
    commands.set(String(event.toolCallId), typeof args?.command === "string" ? args.command : "(命令未知)");
  }
  const blocks = [];
  for (const { event } of events) {
    if (event.type !== "tool_execution_end" || event.toolName !== "bash") continue;
    const command = commands.get(String(event.toolCallId)) ?? "(命令未知)";
    blocks.push(`$ ${command}\n${resultText(event.result)}${event.isError ? "\n[失败]" : ""}`);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : "（本轮没有命令输出）";
}

/**
 * The closing report: the assistant's text after its last tool call — the
 * playbook prompt asks the employee to end with 收尾报告, so whatever it
 * says last is the report.
 *
 * @param {TimedEvent[]} events
 * @returns {string}
 */
export function finalReport(events) {
  let lastToolIndex = -1;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].event.type === "tool_execution_end") lastToolIndex = i;
  }
  let text = "";
  for (let i = lastToolIndex + 1; i < events.length; i += 1) {
    const event = events[i].event;
    if (event.type === "text_delta") text += event.text;
  }
  return text.trim();
}

/**
 * The run-manager hook for task runs. Order of writes is deliberate:
 * artifacts first (so the UI never opens a finished task with empty slots),
 * then the task session's outcome, then the task itself.
 *
 * @param {{ store: ReturnType<import("../store.mjs").openStore>, git: Pick<import("../git/reader.mjs").GitReader, "diffInfo"> }} deps
 * @returns {(finished: TaskRunFinished) => void}
 */
export function createTaskRunHook({ store, git }) {
  return ({ run, events }) => {
    if (run.taskId === null) return;
    const task = store.taskById(run.taskId);

    /** @type {string[]} */
    let diffLines = ["无法读取 diff：缺少任务记录。"];
    /** @type {string[]} */
    let fileLines = ["无法列出变更：缺少任务记录。"];
    if (task) {
      const info = git.diffInfo(task.workspaceDir, task.baseHead);
      if (info.ok) {
        diffLines = [
          `起点 ${short(task.baseHead)} → 当前 ${short(info.headNow)}`,
          info.stat.length > 0 ? info.stat : "（相对起点没有文件变化）",
          info.porcelain.length > 0 ? `未提交改动：\n${info.porcelain}` : "未提交改动：（工作树干净）",
        ];
        fileLines =
          info.nameStatus.length > 0
            ? info.nameStatus.map((entry) => `${entry.status} ${entry.path}`)
            : ["（相对起点没有文件变化）"];
      } else {
        diffLines = [`无法读取 diff：${info.message ?? info.code}`];
        fileLines = [`无法列出变更：${info.message ?? info.code}`];
      }
    }

    const report = finalReport(events);
    store.createArtifact({ taskId: run.taskId, runId: run.id, kind: "diff_summary", content: cap(diffLines.join("\n")) });
    store.createArtifact({ taskId: run.taskId, runId: run.id, kind: "changed_files", content: cap(fileLines.join("\n")) });
    store.createArtifact({ taskId: run.taskId, runId: run.id, kind: "command_output", content: cap(commandTranscript(events)) });
    store.createArtifact({
      taskId: run.taskId,
      runId: run.id,
      kind: "report",
      content: cap(report.length > 0 ? report : "（引擎没有留下收尾报告）"),
    });

    // The task session row is closed by the run manager (single owner of the
    // run lifecycle); this hook writes the deliverables and marks the task.
    if (task) {
      store.setTaskStatus(task.id, "finished");
    }
  };
}
