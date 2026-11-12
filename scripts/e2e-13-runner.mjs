/**
 * Ticket 13 acceptance runner — runs INSIDE the packaged app (asar), driven
 * by scripts/e2e-13.mjs (the orchestrator) via --cubicle-e2e:
 *
 *   phase "boot"    — 干净目录里的安装包显示办公室；数据目录清单（db /
 *                     artifacts / engines / renders）按契约创建；关于页显示
 *                     版本号，且 三方一致（安装包 exe metadata = asar 里的
 *                     package.json = 关于页 DOM）。
 *   phase "second"  — 单实例锁：主实例等 orchestrator 再启动一个副本；副本
 *                     自己退出（orchestrator 断言其退出码），主实例只收到
 *                     second-instance 交接事件且窗口数恒为 1。
 *   phase "ledger"  — 真 codex 在飞时走生产退出路径（supervisor.stop →
 *                     host.shutdown → CLI 宿主账本 taskkill），orchestrator
 *                     按 host pid 采样证明「跑起过」并断言退出后 0 残留。
 *
 * Evidence: tmp/e2e-13/{boot,second,ledger,pids,second-instance}.json.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

import { out, sleep, waitFor, evalIn, click, typeInto, bootAndShowOffice, ensureAllDaySchedule } from "./e2e-harness.mjs";
import { dataLayout, missingDataEntries } from "../src/shared/data-layout.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const E2E_EMPLOYEE = "E2E 打包验收员";
// e2e-11 同款：mock 对这句话回一条 6 秒 powershell 工具调用，让真 codex
// 进程在生产退出路径开始时「确实在飞」。
const MSG_SLOW = "读一下 hello.txt，慢一点：先等 6 秒再给结论。";

/**
 * @typedef {object} E2EContext
 * @property {import("electron").App} app
 * @property {() => import("electron").BrowserWindow | null} getMainWindow
 * @property {{ state: string, pid: number | null, stop: () => void }} supervisor
 * @property {string} dataDir
 * @property {number} bootStartMs
 * @property {string} phase
 * @property {string} outDir
 */

/**
 * 把「我是谁」登记给编排器：主进程 pid（cubicle.exe）+ AgentHost pid
 * （utilityProcess）—— 孤儿进程清扫与 codex 采样都按这两个 pid/路径过滤。
 *
 * @param {E2EContext} ctx
 */
async function publishPids(ctx) {
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      path.join(ctx.outDir, `pids-${ctx.phase}.json`),
      `${JSON.stringify({ phase: ctx.phase, mainPid: process.pid, hostPid: ctx.supervisor.pid, dataDir: ctx.dataDir, exe: process.execPath }, null, 2)}\n`,
      "utf8",
    ),
  );
}

/**
 * @param {E2EContext} ctx
 * @param {(name: string, ok: unknown, detail?: string) => void} add
 */
async function phaseBoot(ctx, add) {
  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return;
  const contents = win.webContents;

  // 验收 3：数据目录按清单创建（清单主人 = src/shared/data-layout.mjs，
  // 产品与验收共用一份契约 —— 不可能漂移）。
  const layout = dataLayout(ctx.dataDir);
  const missing = missingDataEntries(layout, (p) => existsSync(p));
  add("数据目录按清单创建（cubicle.db + artifacts/engines/renders）", missing.length === 0, missing.join(",") || "全部在场");

  const scene3d = await waitFor(
    async () =>
      (await evalIn(
        contents,
        `(() => ({
          canvas: document.querySelector('[data-testid="office-3d"] canvas') !== null,
          desks: document.querySelectorAll('[data-testid="desk"]').length,
          labels: document.querySelectorAll('.amenity-tag, [data-testid="desk-occupant"], [data-testid="desk-light"]').length,
        }))()`,
      )).canvas === true &&
      (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"]').length`)) === 8 &&
      (await evalIn(contents, `document.querySelectorAll('.amenity-tag, [data-testid="desk-occupant"]').length`)) === 0,
    { timeoutMs: 8000 },
  );
  add("打包形态：3D 场景从 asar 加载（WebGL 画布 + 8 工位 + 无文字标签）", scene3d);

  // 验收 5：关于页显示版本号；三方一致 = exe metadata(app.getVersion) =
  // asar package.json（主进程 app-info IPC 对表）= 关于页 DOM。期望版本由
  // 编排器从安装包外独立读取（package.json 原文）经 env 传入。
  const info = /** @type {any} */ (await evalIn(contents, `window.cubicle.appInfo()`));
  const appVersion = app.getVersion();
  add("主进程版本对表：app.getVersion() 与 asar package.json 一致且无漂移", !info.mismatch && info.version === appVersion, JSON.stringify({ ipc: info.version, appVersion, packageVersion: info.packageVersion, mismatch: info.mismatch }));
  const expected = process.env.CUBICLE_EXPECTED_VERSION ?? null;
  add("安装包 metadata == 打包时的 package.json（编排器包外独立对表）", expected !== null && appVersion === expected, `expected=${expected} app.getVersion=${appVersion}`);

  await click(contents, '[data-testid="settings-open"]');
  await click(contents, '[data-testid="settings-tab-about"]');
  const panelUp = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="about-panel"]') !== null`)), { timeoutMs: 4000 });
  add("关于页在设置里打开（画布不动）", panelUp);
  if (panelUp) {
    const shown = String(await evalIn(contents, `document.querySelector('[data-testid="about-version"]')?.textContent ?? ""`));
    add("关于页显示的版本号 = 安装包版本", shown === appVersion && shown === expected, `DOM=${shown} expected=${expected}`);
  }

  await publishPids(ctx);
}

/**
 * @param {E2EContext} ctx
 * @param {(name: string, ok: unknown, detail?: string) => void} add
 */
async function phaseSecond(ctx, add) {
  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return;
  await publishPids(ctx);

  // 等编排器启动第二个实例（不带 --cubicle-e2e）。它的结局由编排器断言
  // （退出码 0、快速退出）；这里断言主实例这一侧：只收到交接事件，且
  // 窗口数恒为 1 —— second-instance.json 是主进程 handler 落的一手证据。
  const handoffFile = path.join(ctx.outDir, "second-instance.json");
  const handoff = await waitFor(async () => existsSync(handoffFile), { timeoutMs: 30_000 });
  add("主实例收到 second-instance 交接（副本没有开自己的窗口）", handoff);
  if (handoff) {
    const { readFileSync } = await import("node:fs");
    const { BrowserWindow } = await import("electron");
    const line = readFileSync(handoffFile, "utf8").trim().split("\n").pop() ?? "";
    const proof = JSON.parse(line || "{}");
    add("交接时窗口数 = 1（没有第二个窗口）", proof.windows === 1 && BrowserWindow.getAllWindows().length === 1, `handoff windows=${proof.windows} now=${BrowserWindow.getAllWindows().length}`);
  }
}

/**
 * @param {E2EContext} ctx
 * @param {(name: string, ok: unknown, detail?: string) => void} add
 */
async function phaseLedger(ctx, add) {
  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return;
  const contents = win.webContents;
  await publishPids(ctx);

  const onDuty = await ensureAllDaySchedule(contents);
  add("全天班表生效（派单闸在上班相位）", onDuty);

  // 招一名员工、切到 codex（带风险手动启用 —— 探针归票 11，本票只要准入
  // 状态可达，重点是打包形态下的进程账本清扫）。
  const roles = /** @type {any[]} */ (await evalIn(contents, `window.cubicle.invoke('role.list').then(r => r.roles)`));
  const programmer = roles.find((r) => r.key === "programmer");
  const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const freeDesk = snapshot.desks.find((/** @type {any} */ d) => d.occupant === null);
  await evalIn(contents, `window.cubicle.invoke('employee.hire', { deskId: ${freeDesk.id}, roleId: ${programmer.id}, name: ${JSON.stringify(E2E_EMPLOYEE)} })`);
  const seated = await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, { timeoutMs: 4000 });
  add("员工坐岗（employee.hire 在打包形态可用）", seated);
  const empSnap = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const employeeId = Number(empSnap.desks.map((/** @type {any} */ d) => d.occupant).find((/** @type {any} */ o) => o)?.id ?? 0);

  const dirs = enginePaths(ctx.dataDir, "codex", employeeId);
  mkdirSync(dirs.workspaceDir, { recursive: true });
  await (await import("node:fs/promises")).writeFile(path.join(dirs.workspaceDir, "hello.txt"), "hello from packaging fixture\n", "utf8");

  const enabled = await evalIn(
    contents,
    `window.cubicle.invoke('engine.enable', { engine: "codex", manualOverride: true }).then(() => true).catch(e => ({ rejected: String((e && e.code) || e) }))`,
  );
  add("codex 带风险启用（打包形态的引擎准入）", enabled === true, JSON.stringify(enabled));
  const switched = await evalIn(
    contents,
    `window.cubicle.invoke('employee.setEngine', { employeeId: ${employeeId}, engine: "codex" }).then(r => r?.employee?.roleSnapshot?.manifest?.engine ?? null).catch(e => ({ rejected: String((e && e.code) || e) }))`,
  );
  add("员工切到 codex", switched === "codex", JSON.stringify(switched));

  // 真 codex 起跑：mock 回一条 6 秒 shell。runner 确认「在飞」后走生产
  // 退出路径：supervisor.stop()（= 主进程 before-quit 的那条门：host.shutdown
  // → CLI 宿主账本 taskkill /T /F → 宿主退出），等 1.2s 宽限落地后交码下线。
  await click(contents, '[data-testid="desk"][data-empty="false"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="engine-card"]') !== null`)), { timeoutMs: 4000 });
  await typeInto(contents, '[data-testid="chat-input"]', MSG_SLOW);
  await click(contents, '[data-testid="chat-send"]');
  const runningSeen = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="chat-running"]')?.dataset.running`)) === "true", { timeoutMs: 20_000 });
  add("codex 运行进入在飞状态（chat-running）", runningSeen);
  await sleep(1500); // 6 秒 shell：此刻真 codex.exe 挂在 AgentHost pid 下

  const hostPidBefore = ctx.supervisor.pid;
  ctx.supervisor.stop(); // 生产退出路径的第一扇门（before-quit 同一动作）
  const settled = await waitFor(async () => ctx.supervisor.pid === null, { timeoutMs: 4000 });
  add("supervisor.stop 后 AgentHost 自行退出（账本清扫在 exit 前完成）", settled, `hostPid was ${hostPidBefore}`);
  await sleep(1200); // 宽限（600ms）之外再给一拍，让 OS 释放句柄
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>}
 */
export async function runE2E(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  try {
    mkdirSync(ctx.outDir, { recursive: true });
    if (ctx.phase === "second") await phaseSecond(ctx, add);
    else if (ctx.phase === "ledger") await phaseLedger(ctx, add);
    else await phaseBoot(ctx, add);
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    add("unexpected error", false, detail);
  }
  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  for (const check of checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path.join(ctx.outDir, `${ctx.phase}.json`),
    `${JSON.stringify({ phase: ctx.phase, allOk, checks }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
