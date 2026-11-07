/**
 * Ticket 11 acceptance runner. Two phases, one orchestrator (e2e-11.mjs):
 *
 *   phase "absent"  — with CUBICLE_CODEX_PATH pointing at nothing, the engine
 *                     card shows codex 未装 (gray badge) + an install guide.
 *   phase "risk"    — codex is installed but has no BYOK models.json: the badge
 *                     reads 待配 key, the probe fails with a visible reason, and
 *                     带风险启用 admits it while the card keeps the ⚠ risk flag.
 *   phase "engine"  — real codex against a local Responses mock:
 *                     1. a programmer reads hello.txt on PI (chat mock) — the
 *                        desk animates from real pi events;
 *                     2. the engine card runs the ADMISSION PROBE on codex;
 *                        four verdicts (注入生效 / 工具可见 / 拒绝可见 /
 *                        事件完整) land on the card and admit it;
 *                     3. switch the SAME employee to codex and re-run the
 *                        SAME sentence — the desk animates from real codex
 *                        events too (one animation vocabulary, two engines);
 *                     4. a dangerous command on the codex desk is blocked at
 *                        the engine's own PreToolUse hook → the same
 *                        policy_blocked marker (被拒不静默) and the file lives;
 *                     5. abort a codex run mid-flight; the runner marks the
 *                        window so the orchestrator proves, by sampling the
 *                        host pid's child processes throughout, that codex
 *                        really spawned AND left no residue after the abort.
 *
 * Evidence: tmp/e2e-11/{absent,engine,child-samples}.json + hostpid.txt.
 */
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { out, sleep, waitFor, evalIn, click, typeInto, bootAndShowOffice, hireThroughWizard, ensureAllDaySchedule } from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const E2E_EMPLOYEE = "E2E 换擎员";
const MSG_READ = "读一下 hello.txt，告诉我里面写了什么。";
const MSG_DANGER = "执行这条危险命令清掉临时文件：Remove-Item -Recurse -Force important.txt。";
// The mock answers this one with a 6-second shell command, so the abort click
// lands while a real codex child is provably in flight (进程回收要抓现行).
const MSG_SLOW = "读一下 hello.txt，慢一点：先等 6 秒再给结论。";

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

/** Engine-card DOM probes (EngineCard.jsx). */
const CARD_STATE_JS = `(() => {
  const card = document.querySelector('[data-testid="engine-card"]');
  const current = document.querySelector('[data-testid="engine-current"]');
  const codexAlt = document.querySelector('[data-testid="engine-alt"][data-engine="codex"]');
  const verdicts = Array.from(document.querySelectorAll('[data-testid="engine-current"] [data-testid="engine-probe-verdict"]'))
    .map((n) => ({ verdict: n.dataset.verdict, result: n.dataset.result }));
  return {
    currentEngine: card?.dataset.currentEngine ?? null,
    currentBadge: current?.dataset.badge ?? null,
    codexAltBadge: codexAlt?.dataset.badge ?? null,
    codexAltProbe: codexAlt ? { ...codexAlt.dataset } : null,
    hasSwitchCodex: document.querySelector('[data-testid="engine-switch-codex"]') !== null,
    hasProbeCodex: document.querySelector('[data-testid="engine-probe-codex"]') !== null,
    hasCodexGuide: document.querySelector('[data-testid="engine-install-guide"][data-engine="codex"]') !== null,
    hasRiskEnable: document.querySelector('[data-testid="engine-enable-risk-codex"]') !== null,
    altRiskFlag: document.querySelector('[data-testid="engine-alt"][data-engine="codex"] [data-testid="engine-risk-flag"]') !== null,
    codexAltProbeStatus: document.querySelector('[data-testid="engine-alt"][data-engine="codex"] [data-testid="engine-alt-probe"]')?.dataset.status ?? null,
    probeError: document.querySelector('[data-testid="engine-probe-error"]')?.textContent ?? null,
    hasRiskEnable: document.querySelector('[data-testid="engine-enable-risk-codex"]') !== null,
    altRiskFlag: document.querySelector('[data-testid="engine-alt"][data-engine="codex"] [data-testid="engine-risk-flag"]') !== null,
    codexAltProbeStatus: document.querySelector('[data-testid="engine-alt"][data-engine="codex"] [data-testid="engine-alt-probe"]')?.dataset.status ?? null,
    probeError: document.querySelector('[data-testid="engine-probe-error"]')?.textContent ?? null,
    probeErrorPresent: document.querySelector('[data-testid="engine-probe-error"]') !== null,
    currentProbeStatus: document.querySelector('[data-testid="engine-current"] [data-testid="engine-probe-status"]')?.dataset.status ?? null,
    verdicts,
    ends: document.querySelectorAll('[data-testid="event-item"][data-type="agent_end"]').length,
    blockedLines: document.querySelectorAll('[data-testid="event-item"][data-type="policy_blocked"]').length,
    // What the overlay's timeline actually saw, in order — the same events
    // the desk reducer folds, so a missing posture becomes explainable.
    feed: Array.from(document.querySelectorAll('[data-testid="event-item"][data-type]')).map((n) => n.dataset.type).join(","),
  };
})()`;

const DESK_SNAPSHOT_JS = `(() => {
  const d = document.querySelector('[data-testid="desk"][data-empty="false"]');
  return {
    busy: d?.dataset.busy ?? null,
    activity: d?.dataset.activity ?? null,
    blocked: d?.dataset.blocked ?? null,
  };
})()`;

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: any[], evidence?: Record<string, unknown> }>}
 */
async function phaseAbsent(ctx) {
  /** @type {any[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };

  const roles = /** @type {any[]} */ (await evalIn(win.webContents, `window.cubicle.invoke('role.list').then(r => r.roles)`));
  const programmer = roles.find((r) => r.key === "programmer");
  const snapshot = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('office.get')`));
  const freeDesk = snapshot.desks.find((/** @type {any} */ d) => d.occupant === null);
  await evalIn(
    win.webContents,
    `window.cubicle.invoke('employee.hire', { deskId: ${freeDesk.id}, roleId: ${programmer.id}, name: ${JSON.stringify(E2E_EMPLOYEE)} })`,
  );
  await waitFor(async () => (await evalIn(win.webContents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, { timeoutMs: 4000 });
  await click(win.webContents, '[data-testid="desk"][data-empty="false"]');
  const card = await waitFor(async () => (await evalIn(win.webContents, `document.querySelector('[data-testid="engine-card"]') !== null`)), { timeoutMs: 4000 });
  add("引擎卡出现在对话浮层", card);

  const state = await evalIn(win.webContents, CARD_STATE_JS);
  add("codex 未装：灰徽章（not_installed）", state.codexAltBadge === "not_installed", `badge=${state.codexAltBadge}`);
  add("未装引擎给出安装引导", state.hasCodexGuide === true);
  add("pi 显示已登录（随应用打包 + 已配 key）", state.currentBadge === "logged_in", `badge=${state.currentBadge}`);
  return { checks, evidence: state };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: any[], evidence?: Record<string, unknown> }>}
 */
async function phaseEngine(ctx) {
  /** @type {any[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;

  // Publish the host pid so the orchestrator can sample its child processes.
  const office = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  await writeFile(path.join(ctx.outDir, "hostpid.txt"), String(office?.host?.pid ?? ""), "utf8");

  // 票 09: 默认班表 09:00–18:00，下班中 run.start 会被 off_duty 闸拒；本票验的
  // 是引擎切换，不是上下班 —— 配全天班表并等相位真的翻到「上班中」再派活。
  const onDuty = await ensureAllDaySchedule(contents);
  add("全天班表已生效：公司相位是「上班中」", onDuty);

  const hired = await hireThroughWizard(contents, { roleKey: "programmer", employeeName: E2E_EMPLOYEE, backFrom2: false, backFrom3: false });
  add("招聘一名程序员", hired.confirmed);
  await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, { timeoutMs: 4000 });
  const snap = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const employeeId = Number(snap.desks.map((/** @type {any} */ d) => d.occupant).find((/** @type {any} */ o) => o)?.id ?? 0);

  // Seed BOTH engine workspaces (each engine owns its private dir).
  for (const engine of ["pi", "codex"]) {
    const dirs = enginePaths(ctx.dataDir, engine, employeeId);
    mkdirSync(dirs.workspaceDir, { recursive: true });
    await writeFile(path.join(dirs.workspaceDir, "hello.txt"), "hello from e2e fixture\n", "utf8");
    await writeFile(path.join(dirs.workspaceDir, "important.txt"), "must survive\n", "utf8");
  }

  await click(contents, '[data-testid="desk"][data-empty="false"]');
  const cardUp = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="engine-card"]') !== null`)), { timeoutMs: 4000 });
  add("引擎卡出现", cardUp);

  // ── 1. PI run: real pi events drive the desk ───────────────────────────
  const piRun = await sendAndObserveDesk(ctx, win, MSG_READ);
  const piPosture = postureEvidence(piRun, "read");
  add("PI：read 工具事件驱动工位（activity=read）", piRun.ended && piPosture.seen, `changes=${piPosture.changes} samples=${piPosture.samples}`);
  const piHistory = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('run.history', { employeeId: ${employeeId} })`));
  add("PI 跑完：落库 completed，引擎 pi", piHistory?.lastRun?.status === "completed" && piHistory?.lastRun?.engine === "pi", JSON.stringify(piHistory?.lastRun));

  // ── 2. ADMISSION PROBE on codex → four verdicts ─────────────────────────
  const codexInstalled = await waitFor(async () => (await evalIn(contents, CARD_STATE_JS)).codexAltBadge === "logged_in", { timeoutMs: 15_000 });
  add("codex 已装已配 key（徽章 logged_in）", codexInstalled);
  await click(contents, '[data-testid="engine-probe-codex"]');
  const probePassed = await waitFor(async () => {
    const s = await evalIn(contents, CARD_STATE_JS);
    return s.hasSwitchCodex === true; // a pass admits codex → 切换按钮出现
  }, { timeoutMs: 90_000 });
  add("准入探针通过并自动准入 codex（切换按钮出现）", probePassed);

  await click(contents, '[data-testid="engine-switch-codex"]');
  const switched = await waitFor(async () => (await evalIn(contents, CARD_STATE_JS)).currentEngine === "codex", { timeoutMs: 5000 });
  add("员工切换到 codex（同一员工，roleSnapshot.engine=codex）", switched);
  const state = await evalIn(contents, CARD_STATE_JS);
  const verdictOk = ["injection", "tools", "refusal", "events"].every((key) => state.verdicts.find((/** @type {any} */ v) => v.verdict === key)?.result === "pass");
  add(
    "探针四项结论写进引擎卡：注入生效/工具可见/拒绝可见/事件完整 全 pass",
    state.currentProbeStatus === "passed" && verdictOk,
    `status=${state.currentProbeStatus} verdicts=${JSON.stringify(state.verdicts)}`,
  );

  // ── 3. SAME task on codex: real codex events drive the SAME animation ───
  const codexRun = await sendAndObserveDesk(ctx, win, MSG_READ);
  const codexPosture = postureEvidence(codexRun, "exec");
  add(
    "CODEX：同一句话换引擎能跑通，工位由真实 codex 事件驱动（activity=exec）",
    codexRun.ended && codexPosture.seen,
    `feed=${codexRun.feed} changes=${JSON.stringify(codexRun.changes)} samples=${codexPosture.samples}`,
  );
  const codexHistory = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('run.history', { employeeId: ${employeeId} })`));
  add("CODEX 跑完：落库 completed，引擎 codex", codexHistory?.lastRun?.status === "completed" && codexHistory?.lastRun?.engine === "codex", JSON.stringify(codexHistory?.lastRun));

  // ── 4. Policy refusal on the codex desk (engine's own PreToolUse hook) ──
  const danger = await sendAndObserveDesk(ctx, win, MSG_DANGER);
  const markerSeen = danger.samples.some((s) => s.blocked === "true");
  const { existsSync } = await import("node:fs");
  const codexDirs = enginePaths(ctx.dataDir, "codex", employeeId);
  const fileSurvived = existsSync(path.join(codexDirs.workspaceDir, "important.txt"));
  const dangerFinal = await evalIn(contents, CARD_STATE_JS);
  add(
    "codex 引擎的卡口复用同一 decideToolAccess：拒绝可见（工位 marker + 时间线一行），危险删除没执行",
    markerSeen && dangerFinal.blockedLines >= 1 && fileSurvived,
    `blockedLines=${dangerFinal.blockedLines} fileSurvived=${fileSurvived}`,
  );

  // ── 5. Abort a codex run mid-flight (orchestrator samples the process) ──
  /** @type {Record<string, unknown>} */
  const childWatch = { startedAt: Date.now() };
  await typeInto(contents, '[data-testid="chat-input"]', MSG_SLOW);
  await click(contents, '[data-testid="chat-send"]');
  const runningSeen = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="chat-running"]')?.dataset.running`)) === "true", { timeoutMs: 15_000 });
  await sleep(1500); // the mock's 6s shell command: codex is genuinely mid-flight here
  childWatch.abortAt = Date.now();
  await click(contents, '[data-testid="chat-abort"]');
  const wentIdle = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="chat-running"]')?.dataset.running`)) === "false", { timeoutMs: 15_000 });
  const abortHistory = /** @type {any} */ (
    await evalIn(
      contents,
      `window.cubicle.invoke('run.history', { employeeId: ${employeeId} }).then(h => h).catch(e => ({ rejected: String((e && e.code) || e) }))`,
    )
  );
  const abortNote = await evalIn(contents, `document.querySelector('[data-testid="chat-note"]')?.textContent ?? null`);
  add(
    "中止一次 codex 运行：面板回空闲，落库 aborted",
    runningSeen && wentIdle && abortHistory?.lastRun?.status === "aborted",
    `running=${runningSeen} idle=${wentIdle} note=${JSON.stringify(abortNote)} history=${JSON.stringify(abortHistory?.lastRun ?? abortHistory)}`,
  );

  // Hold a quiet window so the orchestrator can sample "settled" host children.
  childWatch.idleStartAt = Date.now();
  await sleep(2500);
  childWatch.idleEndAt = Date.now();
  childWatch.employeeId = employeeId;
  await writeFile(path.join(ctx.outDir, "childwatch.json"), `${JSON.stringify(childWatch, null, 2)}\n`, "utf8");

  return {
    checks,
    evidence: { employeeId, piRunTrace: piRun.trace, codexRunTrace: codexRun.trace, dangerTrace: danger.trace, verdicts: state.verdicts },
  };
}

/**
 * Record every data-activity / data-busy change on the seated desk, so the
 * evidence does not depend on where a 90ms poll happens to land.
 */
const DESK_WATCH_JS = `(() => {
  const d = document.querySelector('[data-testid="desk"][data-empty="false"]');
  if (!d) return false;
  window.__deskWatch = [];
  const record = () => window.__deskWatch.push(\`\${d.dataset.activity ?? ""}/\${d.dataset.busy ?? ""}\`);
  record();
  new MutationObserver(record).observe(d, { attributes: true, attributeFilter: ["data-activity", "data-busy"] });
  return true;
})()`;

/**
 * Did the desk take this posture? The MutationObserver record is the precise
 * signal (a 90ms poll can land between two frames); the samples show it held
 * long enough to be seen by a human.
 *
 * @param {{ changes?: string[], samples?: any[] }} run
 * @param {string} kind
 */
function postureEvidence(run, kind) {
  const changes = (run.changes ?? []).filter((line) => line.startsWith(`${kind}/`)).length;
  const samples = (run.samples ?? []).filter((s) => s.activity === kind).length;
  return { seen: changes > 0 || samples > 0, changes, samples };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: any[], evidence?: Record<string, unknown> }>}
 */
async function phaseRisk(ctx) {
  /** @type {any[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;

  // codex is installed here but has NO models.json (BYOK not filled in), so the
  // badge must read 待配 key and the probe must fail with a visible reason.
  const roles = /** @type {any[]} */ (await evalIn(contents, `window.cubicle.invoke('role.list').then(r => r.roles)`));
  const programmer = roles.find((r) => r.key === "programmer");
  const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const freeDesk = snapshot.desks.find((/** @type {any} */ d) => d.occupant === null);
  await evalIn(
    contents,
    `window.cubicle.invoke('employee.hire', { deskId: ${freeDesk.id}, roleId: ${programmer.id}, name: ${JSON.stringify(E2E_EMPLOYEE)} })`,
  );
  await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, { timeoutMs: 4000 });
  await click(contents, '[data-testid="desk"][data-empty="false"]');
  const cardUp = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="engine-card"]') !== null`)), { timeoutMs: 4000 });
  add("引擎卡出现", cardUp);

  const before = await evalIn(contents, CARD_STATE_JS);
  add("已装但没配 key：徽章 needs_key", before.codexAltBadge === "needs_key", `badge=${before.codexAltBadge}`);

  await click(contents, '[data-testid="engine-probe-codex"]');
  const failedOver = await waitFor(async () => {
    const s = await evalIn(contents, CARD_STATE_JS);
    return s.codexAltProbeStatus === "failed" && s.hasRiskEnable === true;
  }, { timeoutMs: 60_000 });
  const afterProbe = await evalIn(contents, CARD_STATE_JS);
  add(
    "探针没通过（没配 key），失败原因写进引擎卡，并给出「带风险启用」入口",
    failedOver && afterProbe.probeErrorPresent === true,
    `status=${afterProbe.codexAltProbeStatus} probeError=${JSON.stringify(afterProbe.probeError ?? "").slice(0, 160)}`,
  );

  await click(contents, '[data-testid="engine-enable-risk-codex"]');
  const enabled = await waitFor(async () => {
    const s = await evalIn(contents, CARD_STATE_JS);
    return s.hasSwitchCodex === true && s.altRiskFlag === true;
  }, { timeoutMs: 5000 });
  const afterEnable = await evalIn(contents, CARD_STATE_JS);
  add("手动启用后可切换，且引擎卡带 ⚠ 风险标识", enabled && afterEnable.altRiskFlag === true, `risk=${afterEnable.altRiskFlag} switch=${afterEnable.hasSwitchCodex}`);

  const admitted = await evalIn(contents, `window.cubicle.invoke('engine.list').then(r => r.engines.find((e) => e.engine === "codex"))`);
  add(
    "带风险启用的引擎确实准入（enabled），风险位（manualOverride）留在库里",
    admitted?.enabled === true && admitted?.manualOverride === true && admitted?.probeStatus === "failed",
    JSON.stringify({ enabled: admitted?.enabled, manualOverride: admitted?.manualOverride, probeStatus: admitted?.probeStatus }),
  );

  return { checks, evidence: { before, afterProbe, afterEnable } };
}

/**
 * Send one sentence, then watch the workstation it drives: polled samples of
 * the desk dataset plus every posture change the page itself recorded.
 *
 * @param {E2EContext} ctx
 * @param {import("electron").BrowserWindow} win
 * @param {string} message
 * @returns {Promise<{ samples: any[], ended: boolean, feed: string, changes: string[], trace: string }>}
 */
async function sendAndObserveDesk(ctx, win, message) {
  const contents = win.webContents;
  const before = Number((await evalIn(contents, CARD_STATE_JS)).ends) || 0;
  await evalIn(contents, DESK_WATCH_JS);
  await typeInto(contents, '[data-testid="chat-input"]', message);
  await click(contents, '[data-testid="chat-send"]');
  /** @type {any[]} */
  const samples = [];
  const deadline = Date.now() + 90_000;
  let ended = false;
  while (Date.now() < deadline) {
    const snap = await evalIn(contents, DESK_SNAPSHOT_JS);
    samples.push(snap);
    const ends = Number((await evalIn(contents, CARD_STATE_JS)).ends) || 0;
    if (ends > before) {
      ended = true;
      break;
    }
    await sleep(80);
  }
  const feed = String((await evalIn(contents, CARD_STATE_JS)).feed ?? "");
  const changes = /** @type {string[]} */ (await evalIn(contents, `window.__deskWatch ?? []`));
  return { samples, ended, feed, changes, trace: samples.map((s) => `${s.activity ?? "-"}/${s.busy ?? "-"}`).join(" ") };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>}
 */
export async function runE2E(ctx) {
  /** @type {{ checks: any[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    mkdirSync(ctx.outDir, { recursive: true });
    outcome =
      ctx.phase === "absent" ? await phaseAbsent(ctx) : ctx.phase === "risk" ? await phaseRisk(ctx) : await phaseEngine(ctx);
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    outcome.checks.push({ name: "unexpected error", ok: false, detail });
  }
  const allOk = outcome.checks.length > 0 && outcome.checks.every((c) => c.ok);
  for (const check of outcome.checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  await writeFile(
    path.join(ctx.outDir, `${ctx.phase}.json`),
    `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
