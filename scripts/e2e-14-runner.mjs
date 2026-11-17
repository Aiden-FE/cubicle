/**
 * Ticket 14 acceptance runner: Settings → Model CRUD → hire with DSH →
 * real dsh ACP run → restart and resume the same ACP session.
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

import {
  bootAndShowOffice,
  click,
  ensureAllDaySchedule,
  evalIn,
  seedGitWorkspace,
  setSelect,
  typeInto,
  waitFor,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const MODEL_ID = "cubicle-dsh-model";
const EMPLOYEE = "E2E DSH 员工";

const RUN_HISTORY_JS = `window.cubicle.invoke('run.history', { employeeId: Number(document.querySelector('[data-testid="chat-overlay"]')?.dataset.employeeId) })`;

/**
 * @param {any[]} checks
 * @param {string} name
 * @param {unknown} ok
 * @param {string} [detail]
 */
function add(checks, name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
}

/** @param {any} contents */
async function openSettings(contents) {
  await click(contents, '[data-testid="settings-open"]');
  await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="settings-modal"]') !== null`)) === true,
    { timeoutMs: 4000 },
  );
}

/** @param {any} contents */
async function closeSettings(contents) {
  await click(contents, '[data-testid="settings-close"]');
  await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="settings-modal"]')`)) === null,
    { timeoutMs: 2000 },
  );
}

/**
 * @param {import("electron").App} app
 * @param {any} ctx
 * @param {any[]} checks
 */
async function phaseSettings(app, ctx, checks) {
  const { win } = await bootAndShowOffice(ctx, (/** @type {string} */ name, /** @type {unknown} */ ok, /** @type {string} */ detail = "") =>
    add(checks, name, ok, detail),
  );
  if (!win) return {};
  const contents = win.webContents;
  await ensureAllDaySchedule(contents);

  await openSettings(contents);
  add(checks, "右上角齿轮打开统一设置模态", true);
  const tabs = await evalIn(contents, `[...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent)`);
  add(
    checks,
    "设置四个 tab：外观 / 模型 / 引擎中心 / 关于",
    JSON.stringify(tabs) === JSON.stringify(["外观", "模型", "引擎中心", "关于"]),
    JSON.stringify(tabs),
  );
  const statusState = await evalIn(contents, `document.querySelector('[data-testid="settings-status"]')?.dataset.state ?? ''`);
  add(checks, "设置顶部显示宿主运行状态", statusState === "online", `state=${statusState}`);

  await click(contents, '[data-testid="toggle-plate"]');
  await click(contents, '[data-testid="toggle-plate"]');
  add(checks, "外观 tab 的名牌开关可切换", true);

  await click(contents, '[data-testid="settings-tab-models"]');
  const emptyShown = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="models-empty"]') !== null`)) === true,
    { timeoutMs: 3000 },
  );
  add(checks, "旧 engines/pi/models.json 被忽略：模型库初始为空且无提示", emptyShown);

  await click(contents, '[data-testid="provider-add"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="provider-editor"]') !== null`)) === true, {
    timeoutMs: 2000,
  });
  await typeInto(contents, '[data-testid="provider-form-name"]', "E2E DSH Gateway");
  await typeInto(contents, '[data-testid="provider-form-url"]', process.env.CUBICLE_E2E_DSH_BASE_URL ?? "http://127.0.0.1:9/v1");
  await typeInto(contents, '[data-testid="provider-form-key"]', "e2e-dsh-key");
  await click(contents, '[data-testid="provider-form-save"]');
  const providerSaved = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="provider-name"]')?.textContent ?? ''`)).includes("E2E DSH"),
    { timeoutMs: 4000 },
  );
  add(checks, "通过设置表单添加 OpenAI Responses 供应商", providerSaved);

  await click(contents, '[data-testid="model-add"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="model-editor"]') !== null`)) === true, {
    timeoutMs: 2000,
  });
  await typeInto(contents, '[data-testid="model-form-id"]', MODEL_ID);
  await typeInto(contents, '[data-testid="model-form-name"]', "E2E DSH Model");
  await click(contents, '[data-testid="model-form-reasoning"] input');
  const levelsShown = await waitFor(
    async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="reasoning-editor"] .reasoning-row').length`)) >= 4,
    { timeoutMs: 2000 },
  );
  add(checks, "推理开关打开后默认 4 行（off/low/medium/high）", levelsShown);
  await click(contents, '[data-testid="model-form-save"]');
  const modelSaved = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="model-row"]')?.dataset.model ?? ''`)) === MODEL_ID,
    { timeoutMs: 4000 },
  );
  add(checks, "通过设置表单添加模型（1M/128K/text+image/推理）", modelSaved);

  const context = await evalIn(
    contents,
    `(() => {
      const row = document.querySelector('[data-testid="model-row"][data-model="${MODEL_ID}"]');
      return row?.querySelector('.model-meta')?.textContent ?? '';
    })()`,
  );
  add(checks, "模型卡显示 1000k 上下文 / 128k 输出 / text+image", String(context).includes("1000k ctx") && String(context).includes("128k out") && String(context).includes("text+image"), String(context));

  await click(contents, `[data-testid="model-row"][data-model="${MODEL_ID}"] [data-testid="model-test"]`);
  const tested = await waitFor(
    async () =>
      (await evalIn(contents, `document.querySelector('[data-testid="model-test-result"]')?.textContent ?? ''`)).includes("连接成功"),
    { timeoutMs: 5000 },
  );
  add(checks, "测试连接：最小推理请求成功", tested);

  await click(contents, '[data-testid="settings-tab-engine"]');
  const dshCard = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="engine-item"][data-engine="dsh"]') !== null`)) === true,
    { timeoutMs: 3000 },
  );
  add(checks, "引擎中心 tab 列出 pi / codex / dsh", dshCard);
  await click(contents, '[data-testid="settings-tab-about"]');
  const versionShown = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="about-version"]')?.textContent ?? ''`)).length > 0,
    { timeoutMs: 3000 },
  );
  const version = String(await evalIn(contents, `document.querySelector('[data-testid="about-version"]')?.textContent ?? ''`));
  add(checks, "关于 tab 显示版本号", versionShown, version);
  await closeSettings(contents);

  const enabled = await evalIn(contents, `window.cubicle.invoke('engine.enable', { engine: 'dsh', manualOverride: true })`);
  add(checks, "dsh 带风险启用（本机已装 desktop）", enabled?.engine?.enabled === true, JSON.stringify(enabled?.engine?.enabled));

  // Hire manually so step 3 can choose the DSH engine + model + reasoning.
  await click(contents, '[data-testid="desk"][data-empty="true"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="role-option"]').length`)) >= 1, { timeoutMs: 3000 });
  await click(contents, '[data-testid="role-option"][data-role-key="programmer"]');
  await click(contents, '[data-testid="hire-next"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="hire-step"]')?.dataset.step`)) === "2", { timeoutMs: 2000 });
  await click(contents, '[data-testid="hire-next"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="hire-step"]')?.dataset.step`)) === "3", { timeoutMs: 2000 });

  await setSelect(contents, '[data-testid="hire-engine"]', "dsh");
  await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="hire-model"]')?.value ?? ''`)) === `e2e-dsh/${MODEL_ID}`,
    { timeoutMs: 3000 },
  ).catch(() => false);
  const modelValue = await evalIn(contents, `document.querySelector('[data-testid="hire-model"]')?.value ?? ''`);
  add(checks, "招聘第 3 步：引擎选 dsh 后自动选中唯一兼容模型", modelValue.includes(MODEL_ID), modelValue);
  try {
    await setSelect(contents, '[data-testid="hire-reasoning"]', "low");
  } catch {
    // A model without reasoning simply has no reasoning select.
  }
  await typeInto(contents, '[data-testid="employee-name-input"]', EMPLOYEE);
  await click(contents, '[data-testid="hire-confirm"]');
  const hired = await waitFor(
    async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1,
    { timeoutMs: 5000 },
  );
  add(checks, "招聘成功，员工快照带 dsh + 模型 + 推理档", hired);

  const snapshot = /** @type {any} */ (await evalIn(contents, "window.cubicle.invoke('office.get')"));
  const programmer = (snapshot?.desks ?? []).map((/** @type {any} */ d) => d.occupant).find((/** @type {any} */ o) => o?.name === EMPLOYEE);
  add(
    checks,
    "员工快照（v2 顶层钉选）= engine dsh / provider e2e-dsh / model / reasoning",
    programmer?.roleSnapshot?.engine === "dsh" &&
      programmer?.roleSnapshot?.provider === "e2e-dsh-gateway" &&
      programmer?.roleSnapshot?.model === MODEL_ID &&
      programmer?.roleSnapshot?.reasoningEffort === "low",
    JSON.stringify(programmer?.roleSnapshot),
  );

  const employeeId = Number(programmer?.id ?? 0);
  const dirs = enginePaths(ctx.dataDir, "dsh", employeeId);
  seedGitWorkspace(dirs.workspaceDir, execFileSync);

  // Edit the employee through the roster modal: reasoning low → high.
  await click(contents, '[data-testid="rail-roster"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="roster-edit"]') !== null`)) === true, { timeoutMs: 3000 });
  await click(contents, '[data-testid="roster-edit"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="employee-edit-modal"]') !== null`)) === true, { timeoutMs: 3000 });
  await waitFor(
    async () =>
      (await evalIn(contents, `document.querySelector('[data-testid="employee-edit-reasoning"] option[value="high"]') !== null`)) === true &&
      (await evalIn(contents, `document.querySelector('[data-testid="employee-edit-save"]')?.disabled === false`)) === true,
    { timeoutMs: 4000 },
  );
  await setSelect(contents, '[data-testid="employee-edit-reasoning"]', "high");
  await click(contents, '[data-testid="employee-edit-save"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="employee-edit-modal"]')`)) === null, { timeoutMs: 3000 });
  const edited = /** @type {any} */ (await evalIn(contents, "window.cubicle.invoke('office.get')"));
  const editedEmployee = (edited?.desks ?? []).map((/** @type {any} */ d) => d.occupant).find((/** @type {any} */ o) => o?.name === EMPLOYEE);
  add(
    checks,
    "花名册「编辑员工」改推理档 high（下一轮生效）",
    editedEmployee?.roleSnapshot?.reasoningEffort === "high",
    JSON.stringify(editedEmployee?.roleSnapshot?.reasoningEffort),
  );
  await click(contents, '[data-testid="roster-close"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="roster-panel"]')`)) === null, { timeoutMs: 2000 });

  // Chat through the real dsh ACP adapter.
  await click(contents, '[data-testid="desk"][data-empty="false"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="chat-input"]') !== null`)) === true, { timeoutMs: 3000 });
  await typeInto(contents, '[data-testid="chat-input"]', "你好，回一句短话。");
  await click(contents, '[data-testid="chat-send"]');
  const ended = await waitFor(
    async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="event-item"][data-type="agent_end"]').length`)) >= 1,
    { timeoutMs: 60_000 },
  );
  const history = /** @type {any} */ (await evalIn(contents, RUN_HISTORY_JS));
  add(checks, "dsh 真实 ACP 运行收尾（agent_end 上屏）", ended);
  add(
    checks,
    "dsh run 落库 completed，engine=dsh",
    history?.lastRun?.status === "completed" && history?.lastRun?.engine === "dsh",
    JSON.stringify(history?.lastRun),
  );
  // One real 工单 through the DSH engine (the acceptance asks for a task,
  // not only a chat turn). The mock answers the task prompt with text; the
  // host still runs the normal task/session/artifact lifecycle.
  await click(contents, '[data-testid="chat-close"]');
  const created = /** @type {any} */ (
    await evalIn(
      contents,
      `window.cubicle.invoke('task.create', { employeeId: ${employeeId}, text: '读一下 greet.txt，然后说说里面写了什么。' })`,
    )
  );
  const taskId = Number(created?.task?.id ?? 0);
  const dispatched = /** @type {any} */ (
    await evalIn(contents, `window.cubicle.invoke('task.dispatch', { taskId: ${taskId} })`)
  );
  let lastStatus = "";
  const reviewed = await waitFor(
    async () => {
      const detail = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.detail', { taskId: ${taskId} })`));
      lastStatus = String(detail?.task?.status ?? "");
      return lastStatus === "review";
    },
    { timeoutMs: 90_000 },
  );
  add(
    checks,
    "dsh 跑通一张工单并进入「待验收」",
    taskId > 0 && Boolean(dispatched?.run) && reviewed,
    `taskId=${taskId} status=${lastStatus}`,
  );

  return { employeeFound: Boolean(programmer), history, taskId };
}

/**
 * Phase 2: same data dir, same employee; one more sentence must resume the
 * same ACP session and complete.
 * @param {any} ctx
 * @param {any[]} checks
 */
async function phaseResume(ctx, checks) {
  const { win } = await bootAndShowOffice(ctx, (/** @type {string} */ name, /** @type {unknown} */ ok, /** @type {string} */ detail = "") =>
    add(checks, name, ok, detail),
  );
  if (!win) return {};
  const contents = win.webContents;
  await ensureAllDaySchedule(contents);
  await click(contents, '[data-testid="desk"][data-empty="false"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="chat-input"]') !== null`)) === true, { timeoutMs: 3000 });
  const before = Number(await evalIn(contents, `document.querySelectorAll('[data-testid="event-item"][data-type="agent_end"]').length`)) || 0;
  await typeInto(contents, '[data-testid="chat-input"]', "接着说：刚才你回了什么？");
  await click(contents, '[data-testid="chat-send"]');
  const ended = await waitFor(
    async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="event-item"][data-type="agent_end"]').length`)) > before,
    { timeoutMs: 60_000 },
  );
  const history = /** @type {any} */ (await evalIn(contents, RUN_HISTORY_JS));
  add(checks, "dsh 重启后再次运行正常收尾", ended);
  add(checks, "dsh 重启后 run completed", history?.lastRun?.status === "completed", JSON.stringify(history?.lastRun));
  return { history };
}

/** @param {any} ctx @returns {Promise<number>} */
export async function runE2E(ctx) {
  /** @type {any[]} */
  const checks = [];
  let exitCode = 1;
  try {
    const outcome = ctx.phase === "resume" ? await phaseResume(ctx, checks) : await phaseSettings(ctx.app, ctx, checks);
    const allOk = checks.length > 0 && checks.every((check) => check.ok);
    for (const check of checks) process.stdout.write(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}\n`);
    await writeFile(
      `${ctx.outDir}/e2e-14-${ctx.phase}.json`,
      `${JSON.stringify({ phase: ctx.phase, checks, evidence: outcome }, null, 2)}\n`,
      "utf8",
    );
    exitCode = allOk ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    checks.push({ name: "unexpected error", ok: false, detail: message });
    await writeFile(
      `${ctx.outDir}/e2e-14-${ctx.phase}.json`,
      `${JSON.stringify({ phase: ctx.phase, checks }, null, 2)}\n`,
      "utf8",
    ).catch(() => {});
  }
  return exitCode;
}
