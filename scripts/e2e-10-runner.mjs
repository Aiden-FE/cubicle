/**
 * Ticket 10 acceptance runner — 「崩溃恢复」，driven from Electron main.
 *
 * Phase "crash" (launch 1): 班表全天 → 桥接招 4 名程序员（3 pi + 1 切到 codex
 * 带风险启用）→ 种 git 工作区 → 4 张慢活工单全部派单（pi 09 mock 永不自收尾；
 * codex 走 6 秒睡眠循环）→ 确认 4 张都在「进行中」+ 都有工具事件 + codex 账本
 * 有行 → 写 crash-ready.json（含 pids 与 checks）→ 挂住等外部 taskkill /F 强杀。
 *   强杀由 orchestrator 执行（杀的是 Electron main，不带 /T）：utilityProcess、
 *   codex.exe 与它的 shell 子进程当场变孤儿 —— 这正是本票要收的现场。
 *
 * Phase "recover" (launch 2, 同一数据目录；启动时主进程先扫两本账):
 *   开库自愈后不静默自动续跑 → task.interrupted.list 列出 4 张中断工单 →
 *   把手抽屉「中断待处置」段可见（浮层）；T3 的恢复指针已被（orchestrator）清掉
 *   → canResume=false，UI 只给重跑/放弃；T1 续跑：追加会话 + 工具事件恢复；
 *   T2 重跑；T3 重跑（续跑被引擎能力门拒 engine_not_resumable）；
 *   T4（codex）放弃 → 失败归档，会话历史保留。
 *
 * Evidence: <outDir>/crash-ready.json + recover.json（+ orchestrator 的
 * crash-samples / recover-samples / db-proof）。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  out,
  sleep,
  waitFor,
  evalIn,
  click,
  bootAndShowOffice,
  ensureAllDaySchedule,
  seedGitWorkspace,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

/** @param {import("electron").WebContents} contents @param {string} method @param {unknown} payload */
const bridge = async (contents, method, payload = {}) =>
  await evalIn(contents, `(async () => await window.cubicle.invoke(${JSON.stringify(method)}, ${JSON.stringify(payload)}))()`);

/**
 * @param {any} history
 */
const toolStarts = (history) =>
  (history?.events ?? []).filter((/** @type {any} */ e) => e.event?.type === "tool_execution_start").length;

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseCrash(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;
  await ensureAllDaySchedule(contents);

  // 招 4 名程序员（招聘向导是 03 票的故事；这里走桥接是诚实的取样点）。
  const snapshot0 = await bridge(contents, "office.get");
  const deskIds = (snapshot0.desks ?? []).map((/** @type {any} */ d) => Number(d.id));
  const roles = await bridge(contents, "role.list");
  const programmerId = Number((roles.roles ?? []).find((/** @type {any} */ r) => r.key === "programmer")?.id ?? 0);
  /** @type {number[]} */
  const hiredIds = [];
  for (let i = 0; i < 4; i += 1) {
    const hired = await bridge(contents, "employee.hire", { deskId: deskIds[i], roleId: programmerId, name: `崩溃票·${i + 1}` });
    hiredIds.push(Number(hired.employee?.id ?? 0));
  }
  add("招进 4 名程序员（3 pi + 1 将切 codex）", hiredIds.every((id) => id > 0), `ids=${hiredIds.join(",")}`);

  // codex：带风险启用（BYOK mock 已在位）+ 第 4 人切引擎。
  const enabled = await bridge(contents, "engine.enable", { engine: "codex", manualOverride: true });
  add("codex 带风险启用（探针不跑，账本/进程证据才是本票要看的）", enabled?.engine?.enabled === true, JSON.stringify(enabled?.engine?.manualOverride));
  await bridge(contents, "employee.setEngine", { employeeId: hiredIds[3], engine: "codex" });

  // 种 git 工作区（fixture），建工单，全部派单。
  const dirs = [];
  for (const [index, employeeId] of hiredIds.entries()) {
    const engine = index === 3 ? "codex" : "pi";
    const d = enginePaths(ctx.dataDir, engine, employeeId);
    dirs.push(d);
    const { headBefore } = seedGitWorkspace(d.workspaceDir, execFileSync);
    if (!/^[0-9a-f]{40}$/.test(headBefore)) add(`工作区 git 初始化 employee-${employeeId}`, false, headBefore);
  }
  add("4 个员工工作区都种成 git 仓库（fixture）", dirs.length === 4);

  const sentences = [
    { goal: "写一份慢日志，慢慢来（T1 续跑用）", engine: "pi" },
    { goal: "写一份慢日志，慢慢来（T2 重跑用）", engine: "pi" },
    { goal: "写一份慢日志，慢慢来（T3 指针丢失·只给重跑用）", engine: "pi" },
    { goal: "读一下 hello.txt，要慢一点（T4 codex 孤儿·放弃用）", engine: "codex" },
  ];
  /** @type {{ taskId: number, employeeId: number, engine: string }[]} */
  const tasks = [];
  for (const [index, sentence] of sentences.entries()) {
    const created = await bridge(contents, "task.create", { employeeId: hiredIds[index], text: sentence.goal });
    const taskId = Number(created?.task?.id ?? 0);
    if (taskId > 0) tasks.push({ taskId, employeeId: hiredIds[index], engine: sentence.engine });
  }
  add("4 张慢活工单建立", tasks.length === 4, tasks.map((t) => `#${t.taskId}@emp${t.employeeId}`).join(" "));
  for (const task of tasks) {
    await bridge(contents, "task.dispatch", { taskId: task.taskId });
  }

  // 等四张都真跑起来：每个员工都有工具事件；codex 账本出现行（进程账本先于强杀落盘）。
  const everyEmployeeBusy = async (/** @type {number[]} */ employeeIds) => {
    for (const employeeId of employeeIds) {
      if (toolStarts(await bridge(contents, "run.history", { employeeId })) < 1) return false;
    }
    return true;
  };
  const active = await waitFor(async () => {
    const list = await bridge(contents, "task.list", { companyId: snapshot0.activeCompanyId });
    const rows = /** @type {any[]} */ (list.tasks ?? []);
    return tasks.every((t) => rows.some((r) => Number(r.id) === t.taskId && r.status === "running")) && (await everyEmployeeBusy(hiredIds));
  }, { timeoutMs: 30_000 });
  add("强杀前：4 张工单都在「进行中」且都有工具事件（pi×3 + codex×1 真在飞）", active);

  const ledgerFile = path.join(ctx.dataDir, "engines", "codex", "children.json");
  const ledgerReady = await waitFor(async () => {
    try {
      const entries = JSON.parse(readFileSync(ledgerFile, "utf8"));
      return Array.isArray(entries) && entries.length >= 1;
    } catch {
      return false;
    }
  }, { timeoutMs: 30_000 });
  add("codex 子进程在强杀前就已进 <dataDir>/engines/codex/children.json", ledgerReady, ledgerFile);

  const listBefore = await bridge(contents, "task.list", { companyId: snapshot0.activeCompanyId });
  add(
    "强杀现场：库里 4 张都是 running（崩溃会把它们落成 interrupted 的前提是它们真在跑）",
    tasks.every((t) => /** @type {any[]} */ (listBefore.tasks ?? []).some((r) => Number(r.id) === t.taskId && r.status === "running")),
  );

  mkdirSync(ctx.outDir, { recursive: true });
  writeFileSync(
    path.join(ctx.outDir, "crash-ready.json"),
    `${JSON.stringify({ phase: "crash", allOk: checks.every((c) => c.ok), checks, pids: { main: process.pid, host: ctx.supervisor.pid }, tasks }, null, 2)}\n`,
    "utf8",
  );
  out("E2E crash-ready — 等 orchestrator taskkill /F（不带 /T）强杀 Electron main");

  // 挂住：orchestrator 将 taskkill /F 这个进程。永不 resolve。
  await new Promise(() => {});
  return { checks };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseRecover(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;
  const snapshot = await bridge(contents, "office.get");
  const companyId = Number(snapshot?.activeCompanyId ?? 0);

  // ① 重启后不静默自动续跑：中断列表就在，且四张都在。
  const interrupted = await bridge(contents, "task.interrupted.list", { companyId });
  const rows = /** @type {any[]} */ (interrupted.tasks ?? []);
  add("重启后中断列表立即可见（不是自动续跑）：4 张崩溃工单都在等三选", rows.length === 4, rows.map((r) => `#${r.id}:${r.status}`).join(" "));
  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  // ② 把手里的浮层入口：段存在、行存在、canResume 判决显示。
  await click(contents, '[data-testid="task-handle"]');
  const drawerOk = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="handle-interrupted"]') !== null`)) === true, { timeoutMs: 5000 });
  add("工单把手出现「中断待处置」段（浮层，不占主画布）", drawerOk);
  const domRows = await evalIn(contents, `document.querySelectorAll('[data-testid="interrupted-row"]').length`);
  add("把手中断段行数 = 4", Number(domRows) === 4, `rows=${domRows}`);

  // T3（第三张 = 指针被清掉）只给重跑/放弃：DOM 上没有续跑按钮、判决是 false。
  const t3 = rows.find((r) => String(r.title).includes("T3"));
  add("指针已丢的任务 canResume=false（宁可给重跑）", t3?.canResume === false, JSON.stringify({ canResume: t3?.canResume, hint: t3?.resumeHint }));
  const domT3 = await evalIn(
    contents,
    `(() => { const row = document.querySelector('[data-testid="interrupted-row"][data-task-id="${t3?.id ?? -1}"]'); return row ? { canResume: row.dataset.canResume ?? '', resumeButtons: row.querySelectorAll('[data-testid="interrupted-resume"]').length, rerun: row.querySelectorAll('[data-testid="interrupted-rerun"]').length, abandon: row.querySelectorAll('[data-testid="interrupted-abandon"]').length } : null })()`,
  );
  add(
    "把手里该任务只有重跑/放弃按钮 + 「不能续跑」提示（续跑按钮缺席）",
    domT3 && domT3.canResume === "false" && domT3.resumeButtons === 0 && domT3.rerun === 1 && domT3.abandon === 1,
    JSON.stringify(domT3),
  );
  const resumeButtonsTotal = await evalIn(contents, `document.querySelectorAll('[data-testid="interrupted-resume"]').length`);
  add("其余可续跑的中断任务显示「续跑」按钮（3 张）", Number(resumeButtonsTotal) === 3, `resumeButtons=${resumeButtonsTotal}`);
  await click(contents, '[data-testid="handle-close"]');

  // ③ 续跑：T1 追加会话 + 引擎从断点继续（工具事件恢复）。
  const t1 = rows.find((r) => String(r.title).includes("T1"));
  const resumeRes = await bridge(contents, "task.resume", { taskId: t1.id });
  add("T1 task.resume 被接受（走 09 resume 通道）", resumeRes?.run?.id != null, JSON.stringify(resumeRes?.run ?? resumeRes));
  const resumed = await waitFor(async () => toolStarts(await bridge(contents, "run.history", { employeeId: t1.employeeId })) >= 1, { timeoutMs: 15_000 });
  add("T1 续跑后工具事件恢复（引擎会话跨重启延续）", resumed);
  const t1Detail = await bridge(contents, "task.detail", { taskId: t1.id });
  add(
    "T1 历史连续：第一轮 interrupted + 续跑新会话（迭代 2）",
    (t1Detail.sessions ?? []).length === 2 && t1Detail.sessions[0].status === "interrupted" && (t1Detail.sessions[1].status === "running" || t1Detail.sessions[1].status === "completed"),
    JSON.stringify((t1Detail.sessions ?? []).map((/** @type {any} */ s) => s.status)),
  );
  add("T1 续跑后任务回到「进行中」", t1Detail.task?.status === "running", t1Detail.task?.status);

  // ④ 重跑：T2 原合同新一轮（06 failed→running 出口语义）。
  const t2 = rows.find((r) => String(r.title).includes("T2"));
  const rerunRes = await bridge(contents, "task.rerun", { taskId: t2.id });
  add("T2 task.rerun 被接受", rerunRes?.run?.id != null);
  const t2Detail = await bridge(contents, "task.detail", { taskId: t2.id });
  add(
    "T2 重跑 = 新 task_session（迭代 2，重发的是原合同）",
    (t2Detail.sessions ?? []).length === 2 && t2Detail.task?.status === "running",
    JSON.stringify((t2Detail.sessions ?? []).map((/** @type {any} */ s) => s.status)),
  );

  // ⑤ 不支持恢复的门：T3 直接调续跑也被 host 拒（引擎能力/指针门）。
  let t3ResumeCode = "";
  try {
    await bridge(contents, "task.resume", { taskId: t3.id });
  } catch (err) {
    t3ResumeCode = String(/** @type {any} */ (err)?.code ?? err);
  }
  add("T3 续跑被 host 拒：engine_not_resumable（UI 与门同一判决）", t3ResumeCode === "engine_not_resumable", t3ResumeCode);
  const t3Rerun = await bridge(contents, "task.rerun", { taskId: t3.id });
  const t3Detail = await bridge(contents, "task.detail", { taskId: t3.id });
  add("T3 重跑成功（只能重跑的引擎照跑）", t3Rerun?.run?.id != null && (t3Detail.sessions ?? []).length === 2);

  // ⑥ 放弃：T4（codex）进失败归档，历史保留。
  const t4 = rows.find((r) => String(r.title).includes("T4"));
  const t4Before = await bridge(contents, "task.detail", { taskId: t4.id });
  const abandon = await bridge(contents, "task.abandon", { taskId: t4.id });
  add("T4 task.abandon 被接受", abandon?.task?.status === "failed", abandon?.task?.status);
  const t4After = await bridge(contents, "task.detail", { taskId: t4.id });
  add(
    "T4 进失败归档但 task_session 历史原样保留",
    t4After.task?.status === "failed" && (t4After.sessions ?? []).length === (t4Before.sessions ?? []).length && (t4After.sessions ?? []).length >= 1,
    `before=${(t4Before.sessions ?? []).length} after=${(t4After.sessions ?? []).length}`,
  );

  // 把手徽标/段仍在给其余没处置完的…处置完后中断段自动变少/消失。
  await click(contents, '[data-testid="task-handle"]');
  const sectionNow = await evalIn(contents, `document.querySelector('[data-testid="handle-interrupted"]')?.innerText ?? ''`);
  add("处置后把手中断段只剩没被动的任务（T1 的续跑一轮不再被列）", !String(sectionNow).includes(`#${t1.id}`), String(sectionNow).slice(0, 120));

  return { checks, evidence: { tasks: rows } };
}

/**
 * @typedef {{
 *   app: import("electron").App,
 *   getMainWindow: () => import("electron").BrowserWindow | null,
 *   supervisor: { pid: number | null, state: string },
 *   dataDir: string,
 *   bootStartMs: number,
 *   phase: string,
 *   outDir: string,
 * }} E2EContext
 */

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    if (ctx.phase === "recover") {
      outcome = await phaseRecover(ctx);
    } else {
      outcome = await phaseCrash(ctx);
    }
  } catch (err) {
    outcome.checks.push({ name: "unexpected error", ok: false, detail: String(err) });
  }

  const allOk = outcome.checks.length > 0 && outcome.checks.every((check) => check.ok);
  for (const check of outcome.checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  if (ctx.phase !== "crash") {
    mkdirSync(ctx.outDir, { recursive: true });
    writeFileSync(
      path.join(ctx.outDir, `${ctx.phase}.json`),
      `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
      "utf8",
    );
  }
  return allOk ? 0 : 1;
}
