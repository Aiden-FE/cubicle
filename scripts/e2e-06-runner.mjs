/**
 * Ticket 06 acceptance runner — "验收与打回", driven from the Electron main
 * process but parked under scripts/ (main stays business-free).
 *
 * Phase "review" (one continuous office story on one employee):
 *   boot → hire a programmer → seed their workspace as a git repo (fixture)
 *   → 派单 (一句话工单) → 跑完自动进入 待验收（不是 完成）
 *   → 对照：一张只创建未派单的工单停在 待办，host 拒绝 待办→完成 / 待办→打回
 *   → 打回（带打回意见）→ 同一任务回到 进行中 → 第二轮跑完又待验收
 *     （迭代 2 轮可见、历史两条会话连续、四件套 ×2、第 2 轮 diff 仍相对任务起点）
 *   → 通过 → 完成（终态）；侧边栏显示本任务 token（两轮累加 > 0）
 *   → 再派一张慢活工单 → 点「取消」→ 终止并标记 失败
 *   → 五个状态（待办/进行中/待验收/完成/失败）全部出现过。
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
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

const EMPLOYEE_NAME = "E2E 验收员甲";
const SENTENCE = "给 greet.txt 加一行欢迎语";
const REJECT_REASON = "欢迎语必须全小写，这条没过验收";
const SLOW_SENTENCE = "写一份慢文档，慢慢来";
const OBSERVATION_TIMEOUT = 90_000;

/** @param {number} taskId */
const ROW_STATUS_JS = (taskId) =>
  // 列表行优先；详情浮层打开时列表被替换，退回读详情头部的状态徽标。
  `(() => {
    const row = document.querySelector('[data-testid="task-row"][data-task-id="${taskId}"]');
    if (row) return row.dataset.status ?? '';
    const detail = document.querySelector('[data-testid="task-detail"][data-task-id="${taskId}"]');
    return detail ? detail.querySelector('[data-testid="task-status"]')?.dataset.status ?? '' : '';
  })()`;
const DETAIL_STATUS_JS = `document.querySelector('[data-testid="task-status"]')?.dataset.status ?? ''`;
const ARTIFACT_COUNT_JS = `document.querySelectorAll('[data-testid="task-detail"] [data-testid^="artifact-"]').length`;
/** @param {string} kind @param {number} index */
const ARTIFACT_JS = (kind, index = 0) =>
  `document.querySelectorAll('[data-testid="task-detail"] [data-testid="artifact-${kind}"] pre')[${index}]?.textContent ?? ''`;
const TOKEN_TOTAL_JS = `Number(document.querySelector('[data-testid="task-tokens"] code')?.textContent ?? '0')`;
const ITERATIONS_JS = `document.querySelector('[data-testid="task-iterations"]')?.textContent ?? ''`;
const SESSIONS_JS = `Array.from(document.querySelectorAll('[data-testid^="task-session-"]')).map((el) => el.textContent).join(' | ')`;
const TASK_ERROR_JS = `document.querySelector('[data-testid="task-error"]')?.textContent ?? ''`;

/**
 * Poll a task row's data-status until it matches, recording every state the
 * view showed along the way (票 06 验收 5：五个状态在界面上可见).
 *
 * @param {import("electron").WebContents} contents
 * @param {number} taskId
 * @param {string} wanted
 * @param {Set<string>} observed
 * @param {number} timeoutMs
 */
async function waitRowStatus(contents, taskId, wanted, observed, timeoutMs = OBSERVATION_TIMEOUT) {
  return waitFor(
    async () => {
      const status = String(await evalIn(contents, ROW_STATUS_JS(taskId)));
      if (status) observed.add(status);
      return status === wanted;
    },
    { timeoutMs, intervalMs: 300 },
  );
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseReview(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };
  /** every status the office list ever showed */
  const observed = /** @type {Set<string>} */ (new Set());

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;

  const hired = await hireThroughWizard(contents, { roleKey: "programmer", employeeName: EMPLOYEE_NAME, backFrom2: false, backFrom3: false });
  add("招聘程序员（工单 owner）", hired.confirmed);
  await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, {
    timeoutMs: 4000,
  });

  const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const programmer = (snapshot?.desks ?? [])
    .map((/** @type {any} */ d) => d.occupant)
    .find((/** @type {any} */ o) => o?.name === EMPLOYEE_NAME);
  const programmerId = Number(programmer?.id ?? 0);
  add("拿到员工 id", programmerId > 0, `programmer=${programmerId}`);

  const dirs = enginePaths(ctx.dataDir, "pi", programmerId);
  const { headBefore } = seedGitWorkspace(dirs.workspaceDir, execFileSync);
  add("程序员工作区被种成 git 仓库（fixture，非应用行为）", /^[0-9a-f]{40}$/.test(headBefore), `head=${headBefore.slice(0, 7)}`);

  // — 派单：one sentence → 进行中 —
  await click(contents, '[data-testid="task-rail"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-bench"]') !== null`)) === true, { timeoutMs: 3000 });
  await typeInto(contents, '[data-testid="task-sentence"]', SENTENCE);
  await waitFor(async () => String(await evalIn(contents, `document.querySelector('[data-testid="task-playbook"]')?.textContent ?? ''`)).includes("加功能"), { timeoutMs: 3000 });
  await setSelect(contents, '[data-testid="task-employee"]', String(programmerId));
  await click(contents, '[data-testid="task-dispatch"]');

  const created = /** @type {any} */ (
    await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${snapshot?.activeGroupId ?? 0} })`)
  );
  const mainTask = (created?.tasks ?? [])[0];
  const mainTaskId = Number(mainTask?.id ?? 0);
  add("派单成功（工单落库）", mainTaskId > 0, `taskId=${mainTaskId}`);
  if (!mainTaskId) return { checks, evidence: { headBefore, workspaceDir: dirs.workspaceDir } };

  const runningShown = await waitRowStatus(contents, mainTaskId, "running", observed);
  add("派单后工单显示「进行中」", runningShown);

  // — 对照工单：只创建不派单 → 停在 待办；host 拒绝跳状态 —
  const probe = /** @type {any} */ (
    await evalIn(
      contents,
      `(async () => {
        const created = await window.cubicle.invoke('task.create', { employeeId: ${programmerId}, text: "对照：这张工单永远待办", goal: "对照：这张工单永远待办", acceptance: [] });
        const probeId = created.task.id;
        let acceptCode = '', rejectCode = '';
        try { await window.cubicle.invoke('task.accept', { taskId: probeId }); } catch (err) { acceptCode = err.code; }
        try { await window.cubicle.invoke('task.reject', { taskId: probeId }); } catch (err) { rejectCode = err.code; }
        return { probeId, acceptCode, rejectCode };
      })()`,
    )
  );
  const probeId = Number(probe?.probeId ?? 0);
  const openRowShown = await waitRowStatus(contents, probeId, "open", observed, 5000);
  add(
    "待办工单在界面上可见，且「待办→完成 / 待办→打回」被 host 拒绝（不可跳过）",
    openRowShown && probe?.acceptCode === "invalid_transition" && probe?.rejectCode === "invalid_transition",
    `accept=${probe?.acceptCode} reject=${probe?.rejectCode}`,
  );

  // — 跑完自动进入 待验收（不是 完成）—
  const reviewShown = await waitRowStatus(contents, mainTaskId, "review", observed);
  add("任务跑完自动进入「待验收」，未点通过前不算完成", reviewShown);
  if (!reviewShown) {
    return { checks, evidence: { headBefore, workspaceDir: dirs.workspaceDir, rowStatus: await evalIn(contents, ROW_STATUS_JS(mainTaskId)) } };
  }
  add("中途从未显示「完成」", !observed.has("done"), `observed=${[...observed].join(",")}`);

  // — 打开详情：四件套 ×1 + token + 第 1 轮 —
  await click(contents, `[data-testid="task-row"][data-task-id="${mainTaskId}"]`);
  await waitFor(async () => (await evalIn(contents, DETAIL_STATUS_JS)) === "review", { timeoutMs: 3000 });
  await waitFor(async () => Number(await evalIn(contents, ARTIFACT_COUNT_JS)) === 4, { timeoutMs: 10_000 });
  const firstDiff = String(await evalIn(contents, ARTIFACT_JS("diff_summary")));
  const firstReport = String(await evalIn(contents, ARTIFACT_JS("report")));
  add("待验收详情已含四件套（第 1 轮）", firstDiff.includes(headBefore.slice(0, 7)) && firstReport.includes("收尾报告"), firstDiff.slice(0, 70).replace(/\n/g, " ⏎ "));
  const tokens1 = Number(await evalIn(contents, TOKEN_TOTAL_JS));
  add("侧边栏显示本任务 token（第 1 轮 > 0，来自 run 的 usage）", tokens1 > 0, `tokens=${tokens1}`);
  const sessions1 = String(await evalIn(contents, SESSIONS_JS));
  add("历史连续可见：第 1 轮会话", sessions1.includes("第 1 轮") && sessions1.includes("已完成"), sessions1);

  // — 打回：同一任务追加第二轮 —
  await typeInto(contents, '[data-testid="task-reject-reason"]', REJECT_REASON);
  await click(contents, '[data-testid="task-reject"]');
  const running2 = await waitRowStatus(contents, mainTaskId, "running", observed);
  add("打回后同一任务回到「进行中」（同一工单，不新建）", running2);
  const review2 = await waitRowStatus(contents, mainTaskId, "review", observed);
  add("第二轮跑完又自动回到「待验收」", review2);

  await waitFor(async () => Number(await evalIn(contents, ARTIFACT_COUNT_JS)) === 8, { timeoutMs: 10_000 });
  const secondDiff = String(await evalIn(contents, ARTIFACT_JS("diff_summary", 1)));
  const secondFiles = String(await evalIn(contents, ARTIFACT_JS("changed_files", 1)));
  const secondReport = String(await evalIn(contents, ARTIFACT_JS("report", 1)));
  add(
    "第 2 轮四件套：diff 仍相对任务起点（起点 SHA + 员工改动都在其中）",
    secondDiff.includes(headBefore.slice(0, 7)) && secondFiles.includes("greet.txt") && secondReport.includes("打回意见已处理"),
    secondDiff.slice(0, 70).replace(/\n/g, " ⏎ "),
  );
  const iterations = String(await evalIn(contents, ITERATIONS_JS));
  const sessions2 = String(await evalIn(contents, SESSIONS_JS));
  add("迭代次数可见：两轮会话连续追加", iterations.includes("2") && sessions2.includes("第 1 轮") && sessions2.includes("第 2 轮"), `${iterations} · ${sessions2}`);
  const tokens2 = Number(await evalIn(contents, TOKEN_TOTAL_JS));
  add("token 跨迭代累加在同一任务上", tokens2 > tokens1, `tokens=${tokens1} → ${tokens2}`);

  // — 通过 → 完成（终态）—
  await click(contents, '[data-testid="task-accept"]');
  const doneShown = await waitRowStatus(contents, mainTaskId, "done", observed, 10_000);
  add("点通过后状态为「完成」", doneShown);
  const detailDone = String(await evalIn(contents, DETAIL_STATUS_JS));
  const doneLabel = String(await evalIn(contents, `document.querySelector('[data-testid="task-status"]')?.textContent ?? ''`));
  add("完成态在侧边栏可见", detailDone === "done" && doneLabel.includes("完成"), doneLabel);

  // 完成是终态：host 拒绝再打回
  const lateReject = /** @type {any} */ (
    await evalIn(
      contents,
      `(async () => { try { await window.cubicle.invoke('task.reject', { taskId: ${mainTaskId} }); return { ok: true }; } catch (err) { return { code: err.code }; } })()`,
    )
  );
  add("完成是终态：再打回被 host 拒绝", lateReject?.code === "invalid_transition", JSON.stringify(lateReject));

  // — 取消：慢活工单 → 终止并标记失败 —（先回列表，让行可见）
  await click(contents, '[data-testid="task-back"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-list"]') !== null`)) === true, { timeoutMs: 3000 });
  await typeInto(contents, '[data-testid="task-sentence"]', SLOW_SENTENCE);
  await waitFor(async () => String(await evalIn(contents, `document.querySelector('[data-testid="task-playbook"]')?.textContent ?? ''`)).includes("写文档"), { timeoutMs: 3000 });
  await click(contents, '[data-testid="task-dispatch"]');
  const slowList = /** @type {any} */ (
    await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${snapshot?.activeGroupId ?? 0} })`)
  );
  const slowTask = (slowList?.tasks ?? []).find((/** @type {any} */ t) => t.title === SLOW_SENTENCE);
  const slowTaskId = Number(slowTask?.id ?? 0);
  add("慢活工单已派出", slowTaskId > 0, `taskId=${slowTaskId}`);
  const slowRunning = await waitRowStatus(contents, slowTaskId, "running", observed, 15_000);
  add("慢活工单进入「进行中」", slowRunning);
  if (slowRunning) {
    await click(contents, `[data-testid="task-row"][data-task-id="${slowTaskId}"]`);
    await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-cancel"]') !== null`)) === true, { timeoutMs: 3000 });
    await click(contents, '[data-testid="task-cancel"]');
    const failedShown = await waitRowStatus(contents, slowTaskId, "failed", observed, 20_000);
    add("点「取消」后运行被终止，工单标记为「失败」", failedShown, `detail=${await evalIn(contents, DETAIL_STATUS_JS)}`);
    const slowDetail = /** @type {any} */ (
      await evalIn(contents, `window.cubicle.invoke('task.detail', { taskId: ${slowTaskId} })`)
    );
    const abortedSession = (slowDetail?.sessions ?? [])[0]?.status;
    const abortedRun = await evalIn(
      contents,
      `(async () => { const h = await window.cubicle.invoke('run.history', { employeeId: ${programmerId} }); return h.lastRun?.status ?? ''; })()`,
    );
    add("取消落库诚实：任务会话 aborted + run aborted", abortedSession === "aborted" && abortedRun === "aborted", `session=${abortedSession} run=${abortedRun}`);
    // 失败不是终态：界面提供「重试」，host 接受 失败→进行中
    const retryOffered = (await evalIn(contents, `document.querySelector('[data-testid="task-retry"]') !== null`)) === true;
    add("失败工单提供「重试」出口（失败→进行中 合法）", retryOffered);
  }

  // — 五个状态全部出现过（列表行的 data-status 证据）—
  const fiveStates = ["open", "running", "review", "done", "failed"];
  const missing = fiveStates.filter((state) => !observed.has(state));
  add("五个状态（待办/进行中/待验收/完成/失败）都在界面上出现过", missing.length === 0, `observed=${[...observed].join(",")}${missing.length ? ` missing=${missing}` : ""}`);

  const noteText = String(await evalIn(contents, TASK_ERROR_JS));
  add("全程没有出现「操作失败」弹错", noteText.length === 0, noteText.slice(0, 80));

  const audit = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.gitAudit')`));

  return {
    checks,
    evidence: {
      programmerId,
      headBefore,
      workspaceDir: dirs.workspaceDir,
      mainTaskId,
      probeTaskId: probeId,
      slowTaskId,
      tokens1,
      tokens2,
      observed: [...observed],
      gitAudit: audit?.commands ?? [],
      artifacts: { firstDiff, firstReport, secondDiff, secondFiles, secondReport },
    },
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
    outcome = await phaseReview(ctx);
  } catch (err) {
    outcome.checks.push({ name: "unexpected error", ok: false, detail: String(err) });
  }

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
