/**
 * Ticket 12 acceptance runner — "失败与成本", one continuous office story:
 *
 *  A. 坏模型路径 → run 失败 → 人话原因（不是堆栈）+ 一键「重试」→ 新会话、
 *     历史与产出保留、迭代计数可见；
 *  B. 小预算工单：80% 黄点（budget_warning）、100% host 自动暂停（复用 09 的
 *     paused 落盘层，任务仍「进行中」挂「预算到顶」）→ 一键「+50%」落库 1.5×
 *     并续跑收尾；
 *  C. 未计量的 mock（provider 不报 usage）→ 任务显示「未计量」而非 0；
 *  D. 三层 token 可见：任务侧边栏（含 80%/100% 标记）、员工名牌（员工级）、
 *     公司面板（公司级）—— 聚合都在 host，走信封。
 *
 * Fixture verbs the runner owns (like 05/06's seedGitWorkspace): rewrite the
 * BYOK models.json (坏/好) and UPDATE the task's token_budget via SQLite —
 * the app itself still never writes git, and its DB stays single-writer for
 * normal traffic (this UPDATE is test setup against WAL, busy_timeout set).
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import {
  out,
  waitFor,
  evalIn,
  click,
  typeInto,
  setSelect,
  bootAndShowOffice,
  ensureAllDaySchedule,
  hireThroughWizard,
  seedGitWorkspace,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const E1_NAME = "E2E 成本员甲";
const E2_NAME = "E2E 成本员乙";
const FAIL_SENTENCE = "坏配置会挂的活：给 greet.txt 加一行欢迎语";
const BURN_SENTENCE = "烧钱工单：慢慢写一段话";
const UNMEASURED_SENTENCE = "未计量引擎工单：跑一步就好";
const OBSERVATION_TIMEOUT = 90_000;

/** @param {number} taskId */
const ROW_STATUS_JS = (taskId) =>
  `(() => {
    const row = document.querySelector('[data-testid="task-row"][data-task-id="${taskId}"]');
    if (row) return row.dataset.status ?? '';
    const detail = document.querySelector('[data-testid="task-detail"][data-task-id="${taskId}"]');
    return detail ? detail.querySelector('[data-testid="task-status"]')?.dataset.status ?? '' : '';
  })()`;

/** @param {import("electron").WebContents} contents @param {number} taskId @param {string} wanted */
const waitRowStatus = (contents, taskId, wanted, timeoutMs = OBSERVATION_TIMEOUT) =>
  waitFor(async () => String(await evalIn(contents, ROW_STATUS_JS(taskId))) === wanted, { timeoutMs, intervalMs: 300 });

const TOKEN_CODE_JS = `document.querySelector('[data-testid="task-tokens"] code')?.textContent ?? ''`;
const TOKEN_STATE_JS = `document.querySelector('[data-testid="task-tokens"]')?.dataset.budgetState ?? ''`;
const WARN_DOT_JS = `document.querySelector('[data-testid="token-warn-dot"]') !== null`;
const CAPPED_JS = `document.querySelector('[data-testid="token-exhausted-badge"]') !== null`;
const PAUSED_REASON_JS = `document.querySelector('[data-testid="detail-paused-badge"]')?.dataset.reason ?? ''`;
const BUDGET_LINE_JS = `document.querySelector('[data-testid="task-budget-line"]')?.dataset.budget ?? ''`;
const FAIL_REASON_JS = `document.querySelector('[data-testid="task-fail-reason"]')?.textContent ?? ''`;
const ITERATIONS_JS = `document.querySelector('[data-testid="task-iterations"]')?.textContent ?? ''`;
const SESSIONS_JS = `Array.from(document.querySelectorAll('[data-testid^="task-session-"]')).map((el) => el.textContent).join(' | ')`;
const ARTIFACT_COUNT_JS = `document.querySelectorAll('[data-testid="task-detail"] [data-testid^="artifact-"]').length`;

/**
 * Open the task detail through the real drawer: make sure the list is showing,
 * click the row, and wait for the detail header of THAT task.
 *
 * @param {import("electron").WebContents} contents
 * @param {number} taskId
 */
async function openTaskDetail(contents, taskId) {
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-row"][data-task-id="${taskId}"]') !== null`)) === true, {
    timeoutMs: OBSERVATION_TIMEOUT,
  });
  await click(contents, `[data-testid="task-row"][data-task-id="${taskId}"]`);
  return waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="task-detail"]')?.dataset.taskId ?? ''`)) === String(taskId),
    { timeoutMs: 10_000 },
  );
}

/** @param {string} dataDir @returns {(healthy: boolean) => void} switch the BYOK provider key between healthy/broken */
function modelsJsonToggle(dataDir) {
  const file = path.join(dataDir, "engines", "pi", "models.json");
  /** @param {boolean} healthy */
  return (healthy) => {
    const config = JSON.parse(readFileSync(file, "utf8"));
    const providers = { ...config.providers };
    if (healthy) {
      providers.cubicle = providers.cubicle_broken;
      delete providers.cubicle_broken;
    } else {
      providers.cubicle_broken = providers.cubicle;
      delete providers.cubicle;
    }
    writeFileSync(file, `${JSON.stringify({ ...config, providers }, null, 2)}\n`, "utf8");
  };
}

/**
 * Fixture UPDATE/READ against the host's WAL database from the runner
 * (busy_timeout keeps the short test write behind the host's single-writer
 * traffic; this is setup, not app behavior).
 *
 * @param {string} dataDir
 * @param {(db: DatabaseSync) => any} fn
 */
function withDb(dataDir, fn) {
  const db = new DatabaseSync(path.join(dataDir, "cubicle.db"));
  db.exec("PRAGMA busy_timeout = 5000;");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** @param {import("electron").WebContents} contents @param {number} employeeId @param {string} sentence */
async function createAndDispatch(contents, employeeId, sentence) {
  const created = /** @type {any} */ (
    await evalIn(
      contents,
      `(async () => {
        const created = await window.cubicle.invoke('task.create', { employeeId: ${employeeId}, text: ${JSON.stringify(sentence)}, goal: ${JSON.stringify(sentence)}, acceptance: [] });
        await window.cubicle.invoke('task.dispatch', { taskId: created.task.id });
        return created.task;
      })()`,
    )
  );
  return Number(created?.id ?? 0);
}

/**
 * The acceptance story. It writes into the caller-owned checks/evidence: when
 * an unexpected error throws mid-phase, the checks collected SO FAR still
 * reach the evidence file (`outcome = await phaseCost(...)` would drop them
 * all — that is how a mid-phase reject first appeared as one bare line).
 *
 * @param {E2EContext} ctx
 * @param {{ name: string, ok: boolean, detail?: string }[]} checks
 * @param {Record<string, any>} evidence
 */
async function phaseCost(ctx, checks, evidence) {
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return;
  const contents = win.webContents;
  await ensureAllDaySchedule(contents); // 票 09: 全天班表，off_duty 闸不干扰验收

  // 工单台抽屉先打开并保持：TaskBench 挂载才接得住 budget_* 事件流（黄点要在
  // 轮收尾前上屏），任务行也要在 DOM 里才点得开（06/09 runner 同款动作）。
  await click(contents, '[data-testid="task-rail"]');
  const benchOpen = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="task-bench"]') !== null`)) === true,
    { timeoutMs: 3000 },
  );
  add("工单台已打开（预算信号要在事件流上被接住）", benchOpen);
  if (!benchOpen) return;

  const setHealthy = modelsJsonToggle(ctx.dataDir);

  // — 招聘两名程序员 + 种 git 工作区 —
  const hired1 = await hireThroughWizard(contents, { roleKey: "programmer", employeeName: E1_NAME, backFrom2: false, backFrom3: false });
  add("招聘员工甲（失败/预算故事的 owner）", hired1.confirmed);
  const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const e1 = (snapshot?.desks ?? []).map((/** @type {any} */ d) => d.occupant).find((/** @type {any} */ o) => o?.name === E1_NAME);
  const e1Id = Number(e1?.id ?? 0);
  add("拿到员工甲 id", e1Id > 0, `e1=${e1Id}`);
  const dirs1 = enginePaths(ctx.dataDir, "pi", e1Id);
  const { headBefore } = seedGitWorkspace(dirs1.workspaceDir, execFileSync);
  add("甲的工作区被种成 git 仓库（fixture）", /^[0-9a-f]{40}$/.test(headBefore), `head=${headBefore.slice(0, 7)}`);

  // — A. 失败人话 + 一键重试（历史与产出保留）—
  setHealthy(false); // 坏模型路径：engine_model_missing 在 run.open 时炸
  const failTaskId = await createAndDispatch(contents, e1Id, FAIL_SENTENCE);
  add("A · 工单已派出（模型配置此刻是坏的）", failTaskId > 0, `taskId=${failTaskId}`);
  const failedShown = await waitRowStatus(contents, failTaskId, "failed");
  add("A · 坏配置让 run 当场失败，工单落「失败」", failedShown);
  const opened = await openTaskDetail(contents, failTaskId);
  add("A · 打开失败工单详情", opened);
  const failReason = String(await evalIn(contents, FAIL_REASON_JS));
  add(
    "A · 失败显示人话原因（模型配置 + 错误码），不是堆栈",
    failReason.includes("模型") && failReason.includes("engine_model_missing") && !failReason.includes("\n    at "),
    failReason.slice(0, 100),
  );
  const sessions1 = String(await evalIn(contents, SESSIONS_JS));
  add("A · 失败那一轮的历史可见（第 1 轮 失败）", sessions1.includes("第 1 轮") && sessions1.includes("失败"), sessions1);
  const retryOffered = (await evalIn(contents, `document.querySelector('[data-testid="task-retry"]') !== null`)) === true;
  add("A · 一键「重试」按钮在场", retryOffered);

  setHealthy(true); // 模型配置修好 — 重试这条路应该通
  await click(contents, '[data-testid="task-retry"]');
  const retryRunning = await waitRowStatus(contents, failTaskId, "running", 10_000);
  add("A · 点重试后回到「进行中」（06 的 失败→进行中 出口）", retryRunning);
  const retryReview = await waitRowStatus(contents, failTaskId, "review");
  add("A · 重试这一轮正常跑完，回到「待验收」", retryReview);
  await waitFor(async () => Number(await evalIn(contents, ARTIFACT_COUNT_JS)) >= 8, { timeoutMs: 15_000 });
  const iterations = String(await evalIn(contents, ITERATIONS_JS));
  const sessions2 = String(await evalIn(contents, SESSIONS_JS));
  add(
    "A · 重试 = 新会话：迭代 2 可见、旧会话原样保留",
    iterations.includes("2") && sessions2.includes("第 1 轮") && sessions2.includes("失败") && sessions2.includes("第 2 轮") && sessions2.includes("已完成"),
    `${iterations} · ${sessions2}`,
  );
  const retryTokens = Number(await evalIn(contents, TOKEN_CODE_JS));
  add("A · 重试轮计量正常（token > 0）", retryTokens > 0, `tokens=${retryTokens}`);
  const failReasonNow = String(await evalIn(contents, FAIL_REASON_JS));
  add("A · 重试成功后不再显示旧失败人话（failure 归 null）", failReasonNow.length === 0, failReasonNow.slice(0, 60));

  // 回列表，准备 B
  await click(contents, '[data-testid="task-back"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-list"]') !== null`)) === true, { timeoutMs: 3000 });

  // — B. 预算软闸：80% 黄点 → 100% 自动暂停 → +50% 续跑 —
  const burnTaskId = await createAndDispatch(contents, e1Id, BURN_SENTENCE);
  add("B · 烧钱工单已派出", burnTaskId > 0, `taskId=${burnTaskId}`);
  withDb(ctx.dataDir, (db) => db.prepare("UPDATE task SET token_budget = 500 WHERE id = ?").run(burnTaskId)); // fixture：小预算演示软闸
  const burnRunning = await waitRowStatus(contents, burnTaskId, "running", 15_000);
  add("B · 烧钱工单进入「进行中」", burnRunning);
  const detailB = await openTaskDetail(contents, burnTaskId);
  add("B · 打开烧钱工单详情", detailB);

  const warnShown = await waitFor(async () => (await evalIn(contents, WARN_DOT_JS)) === true, { timeoutMs: 30_000, intervalMs: 250 });
  add("B · 用量过 80% 出现黄点（budget_warning 事件上屏）", warnShown, `state=${await evalIn(contents, TOKEN_STATE_JS)}`);
  const cappedShown = await waitFor(async () => (await evalIn(contents, CAPPED_JS)) === true, { timeoutMs: 60_000, intervalMs: 250 });
  add("B · 100% 到顶：显示「预算到顶」", cappedShown);
  const pausedReason = String(await evalIn(contents, PAUSED_REASON_JS));
  add("B · 到顶自动暂停：徽标挂「预算到顶」（复用 09 paused 落盘层）", pausedReason === "budget", `reason=${pausedReason}`);
  const taskStillRunning = String(await evalIn(contents, `document.querySelector('[data-testid="task-status"]')?.dataset.status ?? ''`)) === "running";
  add("B · 暂停不是第六态：任务仍「进行中」", taskStillRunning);
  const pausedInDb = withDb(ctx.dataDir, (db) =>
    db.prepare("SELECT status FROM run WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(burnTaskId),
  );
  add("B · 库里最近一轮 run = paused（复用 09 落盘层）", /** @type {any} */ (pausedInDb)?.status === "paused", `run=${/** @type {any} */ (pausedInDb)?.status}`);
  const tokensAtCap = Number(await evalIn(contents, TOKEN_CODE_JS));
  add("B · 到顶时账单诚实：已烧 token 显示且 ≥ 预算", tokensAtCap >= 500, `tokens=${tokensAtCap}`);

  const plusShown = (await evalIn(contents, `document.querySelector('[data-testid="task-budget-plus50"]') !== null`)) === true;
  add("B · 「+50% 继续」按钮在场", plusShown);
  await click(contents, '[data-testid="task-budget-plus50"]');
  const budget750 = await waitFor(async () => String(await evalIn(contents, BUDGET_LINE_JS)) === "750", { timeoutMs: 5000 });
  add("B · +50%：预算 500 → 750 落库可见", budget750, `budget=${await evalIn(contents, BUDGET_LINE_JS)}`);
  const burnReview = await waitRowStatus(contents, burnTaskId, "review");
  add("B · +50% 当场续跑：这一路跑到「待验收」", burnReview);
  const tokensFinal = Number(await evalIn(contents, TOKEN_CODE_JS));
  add("B · 续跑收尾：总 token 落在新预算内（530..750）", tokensFinal >= 500 && tokensFinal < 750, `tokens=${tokensFinal}`);
  const sessionsB = String(await evalIn(contents, SESSIONS_JS));
  add(
    "B · 暂停轮保留 + 续跑轮追加（会话历史连续）",
    sessionsB.includes("第 1 轮") && sessionsB.includes("下班暂停") && sessionsB.includes("第 2 轮") && sessionsB.includes("已完成"),
    sessionsB,
  );

  // 回列表再开 C 的详情：还挂在任务 2 的 detail 上时，任务 3 的行根本不在 DOM 里。
  await click(contents, '[data-testid="task-back"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-list"]') !== null`)) === true, { timeoutMs: 3000 });

  // — C. 未计量（乙员工 + 不报 usage 的 mock）—
  const hired2 = await hireThroughWizard(contents, { roleKey: "programmer", employeeName: E2_NAME, backFrom2: false, backFrom3: false });
  add("招聘员工乙（未计量故事的 owner）", hired2.confirmed);
  const snapshot2 = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const e2 = (snapshot2?.desks ?? []).map((/** @type {any} */ d) => d.occupant).find((/** @type {any} */ o) => o?.name === E2_NAME);
  const e2Id = Number(e2?.id ?? 0);
  add("拿到员工乙 id", e2Id > 0, `e2=${e2Id}`);
  if (e2Id > 0) {
    seedGitWorkspace(enginePaths(ctx.dataDir, "pi", e2Id).workspaceDir, execFileSync);
  }
  const unmeasuredTaskId = await createAndDispatch(contents, e2Id, UNMEASURED_SENTENCE);
  add("C · 未计量工单已派出（mock 这一路不报 usage）", unmeasuredTaskId > 0, `taskId=${unmeasuredTaskId}`);
  const unmeasuredReview = await waitRowStatus(contents, unmeasuredTaskId, "review");
  add("C · 未计量工单正常跑完到「待验收」", unmeasuredReview);
  await openTaskDetail(contents, unmeasuredTaskId);
  const unmeasuredLabel = String(await evalIn(contents, TOKEN_CODE_JS));
  add("C · 任务侧边栏显示「未计量」而不是 0", unmeasuredLabel === "未计量", `label=${unmeasuredLabel}`);

  // — D. 三层可见：员工名牌 + 公司面板 —
  await click(contents, '[data-testid="task-back"]');
  const plates = /** @type {any[]} */ (
    await evalIn(
      contents,
      `Array.from(document.querySelectorAll('[data-testid="desk"]')).map((d) => ({
        empty: d.dataset.empty,
        token: d.querySelector('[data-testid="desk-token"]')?.textContent ?? '',
        measured: d.querySelector('[data-testid="desk-token"]')?.dataset.measured ?? '',
      }))`,
    )
  );
  const plateE1 = plates.find((p) => p.measured === "true");
  const plateE2 = plates.find((p) => p.token === "未计量");
  add("D · 员工名牌（甲）显示员工级 token 聚合（计量过）", Boolean(plateE1) && /^\d+$/.test(plateE1?.token ?? ""), JSON.stringify(plateE1));
  add("D · 员工名牌（乙）显示「未计量」（不是 0）", Boolean(plateE2), JSON.stringify(plateE2));

  await click(contents, '[data-testid="company-switcher"]');
  const companyTokenShown = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="company-tokens"]') !== null`)) === true,
    { timeoutMs: 4000 },
  );
  const companyToken = String(await evalIn(contents, `document.querySelector('[data-testid="company-tokens"]')?.textContent ?? ''`));
  const companyMeasured = String(await evalIn(contents, `document.querySelector('[data-testid="company-tokens"]')?.dataset.measured ?? ''`));
  add("D · 公司面板显示公司级 token 聚合（走信封，计量过 → 数字）", companyTokenShown && companyMeasured === "true" && /tokens \d+/.test(companyToken), companyToken);
  await click(contents, '[data-testid="company-switcher"]');

  evidence.failTaskId = failTaskId;
  evidence.burnTaskId = burnTaskId;
  evidence.unmeasuredTaskId = unmeasuredTaskId;
  evidence.e1Id = e1Id;
  evidence.e2Id = e2Id;
  evidence.headBefore = headBefore;
  evidence.workspaceDir = dirs1.workspaceDir;
  evidence.tokens = { failTask: retryTokens, burnCap: tokensAtCap, burnFinal: tokensFinal };
  evidence.unmeasuredLabel = unmeasuredLabel;
}

/**
 * A bridge reject is a PLAIN object { code, message } (contextBridge swallows
 * Error custom props) — String(err) would print [object Object] and hide the
 * whole diagnosis. Name the code, keep the message.
 *
 * @param {unknown} err
 * @returns {string}
 */
function humanThrown(err) {
  if (err !== null && typeof err === "object") {
    const record = /** @type {{ code?: unknown, message?: unknown }} */ (err);
    if (record.code !== undefined || typeof record.message === "string") {
      return `${String(record.code ?? "thrown")}: ${String(record.message ?? "")}`;
    }
  }
  return String(err);
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
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  const evidence = /** @type {Record<string, any>} */ ({});
  try {
    await phaseCost(ctx, checks, evidence);
  } catch (err) {
    checks.push({ name: "unexpected error", ok: false, detail: humanThrown(err) });
  }
  const outcome = { checks, evidence };

  const allOk = outcome.checks.length > 0 && outcome.checks.every((check) => check.ok);
  for (const check of outcome.checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  mkdirSync(ctx.outDir, { recursive: true });
  await writeFile(
    path.join(ctx.outDir, `${ctx.phase}.json`),
    `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
