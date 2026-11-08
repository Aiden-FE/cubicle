/**
 * Ticket 09 acceptance runner — 「上下班」, driven from Electron main but
 * parked under scripts/ (main stays business-free).
 *
 * Phase "duty" (launch 1):
 *   boot → 招程序员 → 上下班面板把「下班」配成 15 秒后（秒级），宽限 5 秒 →
 *   派慢活（永不自收尾的 mock）→ 到点进宽限：run 继续、宽限内仍有工具调用 →
 *   宽限到期：run/task_session 落 paused、任务仍「进行中」挂「已下班·暂停」徽标 →
 *   暂停后 0 新工具调用 → 手动「立即上班」：同任务追加会话续跑、工具恢复，
 *   时间表一个字没改 → 窗口关闭：三选对话出现（脚本按「直接退」），
 *   pauseAll 落盘完成后窗口才销毁。
 *
 * Phase "resume" (launch 2, same dataDir):
 *   重启后：任务仍「进行中」挂暂停徽标（开库自愈没有翻它）、详情两轮 paused →
 *   「立即上班」：续跑新会话、工具事件恢复 → 窗口关闭选「取消」：窗口照开。
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
  sleep,
  waitFor,
  evalIn,
  click,
  typeInto,
  setSelect,
  bootAndShowOffice,
  hireThroughWizard,
  seedGitWorkspace,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const EMPLOYEE_NAME = "E2E 打卡员";
const SLOW_SENTENCE = "写一份慢日志，慢慢来";
const GRACE_SECONDS = 5;
const WORK_END_AHEAD_MS = 15_000;

/** @param {Date} date @returns {string} HH:MM:SS（本地时间，秒级可配） */
function hhmmss(date) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** @param {number} taskId */
const ROW_JS = (taskId) =>
  `(() => {
    const row = document.querySelector('[data-testid="task-row"][data-task-id="${taskId}"]');
    return row ? { status: row.dataset.status ?? '', paused: row.dataset.paused ?? '' } : null;
  })()`;

/**
 * @param {import("electron").WebContents} contents
 * @param {number} companyId
 */
const scheduleRead = async (contents, companyId) =>
  /** @type {any} */ (
    await evalIn(contents, `(async () => await window.cubicle.invoke('schedule.get', { companyId: ${companyId} }))()`)
  );

/**
 * @param {import("electron").WebContents} contents
 * @param {number} employeeId
 */
const historyRead = async (contents, employeeId) =>
  /** @type {any} */ (
    await evalIn(contents, `(async () => await window.cubicle.invoke('run.history', { employeeId: ${employeeId} }))()`)
  );

/** @param {any} history */
const toolStarts = (history) =>
  (history?.events ?? []).filter((/** @type {any} */ e) => e.event?.type === "tool_execution_start").length;

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseDuty(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;

  // ── 招人 + 种 git 工作区（fixture）+ 配时间表 ─────────────────────────
  const hired = await hireThroughWizard(contents, { roleKey: "programmer", employeeName: EMPLOYEE_NAME, backFrom2: false, backFrom3: false });
  add("招聘程序员（打卡小白）", hired.confirmed);
  await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, { timeoutMs: 4000 });

  const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const companyId = Number(snapshot?.activeCompanyId ?? 0);
  const groupId = Number(snapshot?.activeGroupId ?? 0);
  const workerId = Number((snapshot?.desks ?? []).map((/** @type {any} */ d) => d.occupant).find((/** @type {any} */ o) => o?.name === EMPLOYEE_NAME)?.id ?? 0);
  add("拿到员工 id", workerId > 0, `worker=${workerId}`);

  const dirs = enginePaths(ctx.dataDir, "pi", workerId);
  const { headBefore } = seedGitWorkspace(dirs.workspaceDir, execFileSync);
  add("工作区已种成 git 仓库（fixture，非应用行为）", /^[0-9a-f]{40}$/.test(headBefore), `head=${headBefore.slice(0, 7)}`);

  await click(contents, '[data-testid="rail-duty"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="workclock-panel"]') !== null`)) === true, { timeoutMs: 3000 });
  const defaultInfo = await scheduleRead(contents, companyId);
  add(
    "没配过时间表的公司读默认班表 09:00–18:00 · 宽限 90s（configured=false）",
    defaultInfo?.configured === false &&
      defaultInfo?.schedule?.workStart === "09:00" &&
      defaultInfo?.schedule?.workEnd === "18:00" &&
      defaultInfo?.schedule?.graceSeconds === 90,
    JSON.stringify(defaultInfo?.schedule),
  );

  const workEnd = hhmmss(new Date(Date.now() + WORK_END_AHEAD_MS));
  await typeInto(contents, '[data-testid="schedule-work-start"]', "00:00");
  await typeInto(contents, '[data-testid="schedule-work-end"]', workEnd);
  await typeInto(contents, '[data-testid="schedule-grace"]', String(GRACE_SECONDS));
  await click(contents, '[data-testid="schedule-save"]');
  const scheduleOk = await waitFor(
    async () => {
      const info = await scheduleRead(contents, companyId);
      return info?.configured === true && info?.schedule?.workEnd === workEnd && info?.schedule?.graceSeconds === GRACE_SECONDS;
    },
    { timeoutMs: 4000 },
  );
  add(`时间表可配到秒并落库：下班 ${workEnd}、宽限 ${GRACE_SECONDS}s（验收 1 前半）`, scheduleOk, `workEnd=${workEnd}`);
  // 相位是 tick 循环推出来的（1s 内）：保存后相位应当翻到「上班中」
  const phaseOnSeen = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="duty-phase"]')?.dataset.phase ?? ''`)) === "on",
    { timeoutMs: 5000, intervalMs: 300 },
  );
  add("保存后相位徽标翻到「上班中」（00:00 → 今天 " + workEnd + " 的窗口内）", phaseOnSeen);
  await click(contents, '[data-testid="workclock-close"]');

  // ── 派慢活：永不自收尾，下班才是它的终点 ────────────────────────────
  await click(contents, '[data-testid="task-rail"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-bench"]') !== null`)) === true, { timeoutMs: 3000 });
  await typeInto(contents, '[data-testid="task-sentence"]', SLOW_SENTENCE);
  await waitFor(async () => String(await evalIn(contents, `document.querySelector('[data-testid="task-playbook"]')?.textContent ?? ''`)).includes("写文档"), { timeoutMs: 3000 });
  await setSelect(contents, '[data-testid="task-employee"]', String(workerId));
  await click(contents, '[data-testid="task-dispatch"]');
  // task.create is async (git is async): wait for the row before reading the
  // list, otherwise slowTaskId=0 and every later selector targets task 0.
  await waitFor(async () => {
    const list = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${groupId} })`));
    return (list?.tasks ?? []).length > 0;
  }, { timeoutMs: 5000 });
  const taskList = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${groupId} })`));
  const slowTaskId = Number((taskList?.tasks ?? [])[0]?.id ?? 0);
  add("慢活工单已派出", slowTaskId > 0, `taskId=${slowTaskId}`);
  const runningRow = await waitFor(async () => (await evalIn(contents, ROW_JS(slowTaskId)))?.status === "running", { timeoutMs: 25_000, intervalMs: 300 });
  add("慢活进入「进行中」（此后它不会自己收尾）", runningRow);

  // ── 到点：先进宽限，宽限内工具照常 ──────────────────────────────────
  const boundaryAt = Date.now();
  const graceSeen = await waitFor(async () => (await scheduleRead(contents, companyId))?.status?.phase === "grace", { timeoutMs: 30_000, intervalMs: 300 });
  add(`到点自动进「宽限中」（下班点 ${workEnd} + ${GRACE_SECONDS}s 宽限；发现于 +${Date.now() - boundaryAt}ms）`, graceSeen);
  const graceInfo = await scheduleRead(contents, companyId);
  add(
    "宽限从下班界点起算（不是从发现时刻）",
    Number(graceInfo?.status?.graceUntil ?? 0) > Number(graceInfo?.status?.phaseSince ?? 0),
    `graceUntil=${graceInfo?.status?.graceUntil} phaseSince=${graceInfo?.status?.phaseSince}`,
  );
  const toolsInGrace0 = toolStarts(await historyRead(contents, workerId));
  await sleep(2500); // 宽限内（还剩 ~2.5s）
  const graceMid = await historyRead(contents, workerId);
  add("宽限内 run 不停：工具调用照常发生（验收 3/5 的『宽限内 ≥1』）", toolStarts(graceMid) - toolsInGrace0 >= 1, `tools=+${toolStarts(graceMid) - toolsInGrace0}`);
  add("宽限内任务仍是「进行中」且没有暂停徽标", (await evalIn(contents, ROW_JS(slowTaskId)))?.paused === "false");

  // ── 宽限到期：落盘 paused，任务仍「进行中」挂徽标 ───────────────────
  const offSeen = await waitFor(async () => (await scheduleRead(contents, companyId))?.status?.phase === "off", { timeoutMs: 15_000, intervalMs: 300 });
  add("宽限到期：相位自动落「下班中」", offSeen);
  const pausedRun = await waitFor(async () => (await historyRead(contents, workerId))?.lastRun?.status === "paused", { timeoutMs: 8000, intervalMs: 200 });
  add("run 落 paused（引擎 abort 收尾，run 行合上）", pausedRun);
  const badgeSeen = await waitFor(
    async () => {
      const row = await evalIn(contents, ROW_JS(slowTaskId));
      return row?.status === "running" && row?.paused === "true";
    },
    { timeoutMs: 6000, intervalMs: 200 },
  );
  add("验收 3：下班后任务进暂停态 —— 界面仍是「进行中」+「已下班·暂停」徽标（五状态不新增）", badgeSeen);
  const detailSessions = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.detail', { taskId: ${slowTaskId} })`));
  add("最近一轮 task_session = paused（暂停落在会话层）", (detailSessions?.sessions ?? []).at(-1)?.status === "paused", `sessions=${(detailSessions?.sessions ?? []).map((/** @type {any} */ s) => s.status).join(",")}`);

  const toolsAfterPause0 = toolStarts(await historyRead(contents, workerId));
  await sleep(3000);
  const afterPauseHistory = await historyRead(contents, workerId);
  add(
    "验收 5：暂停后不再产生任何新工具调用（3s 采样 0 新增）",
    toolStarts(afterPauseHistory) - toolsAfterPause0 === 0 && afterPauseHistory?.lastRun?.status === "paused",
    `tools=+${toolStarts(afterPauseHistory) - toolsAfterPause0} lastRun=${afterPauseHistory?.lastRun?.status}`,
  );

  // ── 手动 override：立即上班续跑；时间表一个字不改 ───────────────────
  await click(contents, '[data-testid="task-close"]');
  await click(contents, '[data-testid="rail-duty"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="workclock-panel"]') !== null`)) === true, { timeoutMs: 3000 });
  await click(contents, '[data-testid="duty-on"]');
  const resumed = await waitFor(async () => (await historyRead(contents, workerId))?.lastRun?.status === "running", { timeoutMs: 15_000, intervalMs: 300 });
  add("验收 2：手动「立即上班」立即生效 —— 挂起的慢活当场续跑", resumed);
  const resumeHistory = await historyRead(contents, workerId);
  const detailAfterResume = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.detail', { taskId: ${slowTaskId} })`));
  add(
    "上班续跑 = 同一任务追加一条 task_session（与打回同构）",
    (detailAfterResume?.sessions ?? []).length >= 2 && (detailAfterResume?.sessions ?? []).at(-1)?.status === "running" && (detailAfterResume?.sessions ?? []).at(-2)?.status === "paused",
    `sessions=${(detailAfterResume?.sessions ?? []).map((/** @type {any} */ s) => s.status).join(",")}`,
  );
  const toolsResumed0 = toolStarts(resumeHistory);
  await sleep(2000);
  const toolsResumed1 = toolStarts(await historyRead(contents, workerId));
  add("续跑后工具调用恢复（暂停 ≠ 终止）", toolsResumed1 - toolsResumed0 >= 1, `tools=+${toolsResumed1 - toolsResumed0}`);
  const afterOverride = await scheduleRead(contents, companyId);
  add(
    "验收 2：override 不改动时间表 —— 班表仍是 00:00 → " + workEnd + "、宽限 " + GRACE_SECONDS + "s",
    afterOverride?.schedule?.workStart === "00:00" && afterOverride?.schedule?.workEnd === workEnd && afterOverride?.schedule?.graceSeconds === GRACE_SECONDS,
    JSON.stringify(afterOverride?.schedule),
  );
  add("override 记录独立存在（mode=on），与配置行是两条状态", afterOverride?.override?.mode === "on", JSON.stringify(afterOverride?.override));
  await click(contents, '[data-testid="workclock-close"]');

  // ── 退出三选：选「直接退」→ 先下班落盘，落完才关窗 ──────────────────
  // 注意：这一步会让进程自我终结 — 证据必须在 close() 之前、以同步方式落盘。
  // 「直接退先落盘」的顺序由 orchestrator 核对：exit-dialog.json（对话框真的
  // 出现过、按钮就是那三个）+ 退出后库里最后 run=paused + 退出协调器单测。
  const runBeforeExit = (await historyRead(contents, workerId))?.lastRun?.status ?? "";
  add("退出前慢活仍在续跑（『直接退』要下班落盘的正是它）", runBeforeExit === "running", `lastRun=${runBeforeExit}`);
  out("E2E 触发窗口关闭（dialog 由脚本按『直接退』点）…");
  win.close();
  // 窗口只有在「pauseAll 落库完成」后才被销毁（exit-coordinator 的顺序），
  // 所以「等到窗口没了」就是「落盘先于退出」的现场证据。
  const windowGone = await waitFor(async () => ctx.getMainWindow() === null, { timeoutMs: 25_000, intervalMs: 250 });
  add("验收 4：三选「直接退」→ pauseAll 落盘完成后窗口才销毁（进程随之下线）", windowGone);

  return {
    checks,
    evidence: {
      companyId,
      groupId,
      workerId,
      slowTaskId,
      workEnd,
      headBefore,
      workspaceDir: dirs.workspaceDir,
      boundaryAt,
      graceUntil: graceInfo?.status?.graceUntil ?? null,
      runBeforeExit,
      exitTriggered: true,
    },
  };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseResume(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  let firstPhase = /** @type {any} */ ({});
  try {
    firstPhase = JSON.parse(await readFile(path.join(ctx.outDir, "duty.json"), "utf8"));
  } catch {
    add("读不到第一阶段的证据（duty.json）", false);
    return { checks };
  }
  const workerId = Number(firstPhase?.evidence?.workerId ?? 0);
  const slowTaskId = Number(firstPhase?.evidence?.slowTaskId ?? 0);
  add("第一阶段证据在手", workerId > 0 && slowTaskId > 0, `worker=${workerId} task=${slowTaskId}`);

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;

  // 重启后：暂停状态还在（开库自愈没有把 paused 任务翻回待办），徽标照挂
  await click(contents, '[data-testid="task-rail"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-bench"]') !== null`)) === true, { timeoutMs: 3000 });
  const badgeAfterRestart = await waitFor(
    async () => {
      const row = await evalIn(contents, ROW_JS(slowTaskId));
      return row?.status === "running" && row?.paused === "true";
    },
    { timeoutMs: 8000, intervalMs: 300 },
  );
  add("验收 3：重启后任务仍「进行中」挂「已下班·暂停」——下班落盘没被开库自愈抹掉", badgeAfterRestart);
  const detail = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.detail', { taskId: ${slowTaskId} })`));
  const statuses = (detail?.sessions ?? []).map((/** @type {any} */ s) => s.status);
  add("重启后详情里两轮都是 paused：历史连续可查", statuses.filter((/** @type {string} */ s) => s === "paused").length >= 2, `sessions=${statuses.join(",")}`);

  // 立即上班 → 续跑 + 工具恢复
  await click(contents, '[data-testid="task-close"]');
  await click(contents, '[data-testid="rail-duty"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="workclock-panel"]') !== null`)) === true, { timeoutMs: 3000 });
  await click(contents, '[data-testid="duty-on"]');
  const resumedAgain = await waitFor(async () => (await historyRead(contents, workerId))?.lastRun?.status === "running", { timeoutMs: 15_000, intervalMs: 300 });
  add("重启后「立即上班」续跑成功（新 run 在跑）", resumedAgain);
  const resumeHistory = await historyRead(contents, workerId);
  const tools0 = toolStarts(resumeHistory);
  await sleep(2000);
  const tools1 = toolStarts(await historyRead(contents, workerId));
  add("续跑后工具事件恢复（重启没丢引擎会话的记忆链）", tools1 - tools0 >= 1, `tools=+${tools1 - tools0}`);
  await click(contents, '[data-testid="workclock-close"]');

  // 取消退出：三选里选「取消」→ 窗口照开、什么都不发生
  out("E2E 触发窗口关闭（dialog 由脚本按『取消』点）…");
  win.close();
  await sleep(1500);
  const stillOpen = ctx.getMainWindow() !== null && !ctx.getMainWindow()?.isDestroyed();
  add("验收 4 另一半：三选里选「取消」→ 窗口照开，退出被放弃", stillOpen);

  return {
    checks,
    evidence: { workerId, slowTaskId, sessionStatuses: statuses, tools0, tools1 },
  };
}

/**
 * @typedef {object} E2EContext
 * @property {import("electron").App} app
 * @property {() => import("electron").BrowserWindow | null} getMainWindow
 * @property {{ state: string, pid: number | null, send: (m: unknown) => boolean }} supervisor
 * @property {string} dataDir
 * @property {number} bootStartMs
 * @property {string} phase
 * @property {string} outDir
 */

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    if (ctx.phase === "resume") {
      outcome = await phaseResume(ctx);
    } else {
      outcome = await phaseDuty(ctx);
    }
  } catch (err) {
    outcome.checks.push({ name: "unexpected error", ok: false, detail: String(err) });
  }

  const allOk = outcome.checks.length > 0 && outcome.checks.every((check) => check.ok);
  for (const check of outcome.checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  mkdirSync(ctx.outDir, { recursive: true });
  // 同步写：phase duty 结束时进程正在被我们要求自杀，异步 fs 会输给 app.exit。
  writeFileSync(
    path.join(ctx.outDir, `${ctx.phase}.json`),
    `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
