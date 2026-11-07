/**
 * Ticket 07 acceptance runner — "工位动画", driven from the Electron main
 * process but parked under scripts/ (main stays business-free).
 *
 * Phase "desk" (see scripts/e2e-07.mjs orchestrator):
 *   boot → hire one programmer → seed the workspace (hello.txt, test_ok.mjs,
 *   test_fail.mjs, important.txt) → open the drawer → then six scripted
 *   sentences whose REAL tool executions must switch the工位 screen:
 *     读 read / 写 write / 执行 bash-echo / 测试过 (green) / 测试挂 (red) /
 *     危险命令 → 策略拦截 (desk marker + timeline line + file survives),
 *   sampled from the live DOM while each run is in flight;
 *   then the idle clock: 9s 摸鱼 → 45s 去咖啡 (chair empties) → 回工位;
 *   then the preference promise: 名牌+气泡 off → no plate/bubble in DOM,
 *   while the always-on status light + busy flag keep 在忙/在闲 readable.
 *
 * Progress goes to process.stdout.write; evidence lands in
 * <outDir>/desk.json plus <outDir>/*.png screenshots.
 */
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
  sleep,
  waitFor,
  evalIn,
  click,
  typeInto,
  bootAndShowOffice,
  hireThroughWizard,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const E2E_EMPLOYEE = "E2E 动画员";
const MSG_READ = "读一下 hello.txt，告诉我里面写了什么。";
const MSG_WRITE = "写一份周报草稿到 weekly-draft.md。";
const MSG_EXEC = "跑一条命令：echo building，看看输出。";
const MSG_TEST_PASS = "跑一下测试，这次测试要过。";
const MSG_TEST_FAIL = "再跑一次测试，这次测试要挂。";
const MSG_DANGER = "执行这条危险命令清掉临时文件：Remove-Item -Recurse -Force important.txt。";
const MSG_READ_AGAIN = "再读一下 hello.txt 确认内容还在。";

const SEED_FILES = {
  "hello.txt": "hello from e2e fixture\n",
  "test_ok.mjs": "console.log('all green');\nprocess.exit(0);\n",
  "test_fail.mjs": "console.log('boom');\nprocess.exit(1);\n",
  "important.txt": "this file must survive the blocked rm\n",
};

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
 * One eval: the occupied desk's full animation state + the drawer's counters.
 * data-activity/tone/posture/position/blocked + light are the DOM contract
 * the scene layer paints (OfficeFloor.jsx).
 */
const DESK_SNAPSHOT_JS = `(() => {
  const d = document.querySelector('[data-testid="desk"][data-empty="false"]');
  const bubble = document.querySelector('[data-testid="desk-bubble"]');
  const light = document.querySelector('[data-testid="desk-light"]');
  const plate = document.querySelector('[data-testid="desk-occupant"]');
  return {
    busy: d?.dataset.busy ?? null,
    activity: d?.dataset.activity ?? null,
    tone: d?.dataset.tone ?? null,
    posture: d?.dataset.posture ?? null,
    position: d?.dataset.position ?? null,
    blocked: d?.dataset.blocked ?? null,
    bubble: bubble?.dataset.bubble ?? null,
    hasPlate: plate !== null,
    light: light ? { tone: light.dataset.tone, visible: light.offsetWidth > 0 && light.offsetHeight > 0 } : null,
    ends: document.querySelectorAll('[data-testid="event-item"][data-type="agent_end"]').length,
    blockedLines: document.querySelectorAll('[data-testid="event-item"][data-type="policy_blocked"]').length,
  };
})()`;

/** @type {string[]} */
const shotFailures = [];

/**
 * Best-effort screenshot. On this machine a service-session Electron may
 * have no display surface (capturePage throws) — the acceptance itself is
 * proven by DOM-state assertions; screenshots are extra human-readable
 * evidence and must never take the run down.
 *
 * @param {E2EContext} ctx @param {import("electron").BrowserWindow} win @param {string} name
 */
async function shot(ctx, win, name) {
  try {
    const image = await win.webContents.capturePage();
    await writeFile(path.join(ctx.outDir, `${name}.png`), image.toPNG());
    return `${name}.png`;
  } catch (err) {
    shotFailures.push(`${name}: ${String(err)}`);
    return null;
  }
}

/**
 * Send one sentence, then sample the desk every 60ms until this run's
 * agent_end lands — the observation window for "屏幕画面随状态切换".
 *
 * @param {E2EContext} ctx
 * @param {import("electron").BrowserWindow} win
 * @param {string} message
 * @param {{ maxMs?: number, onSample?: (snap: any) => Promise<void> | void }} [options]
 */
async function sendAndObserve(ctx, win, message, { maxMs = 60_000, onSample } = {}) {
  const contents = win.webContents;
  const before = Number((await evalIn(contents, DESK_SNAPSHOT_JS)).ends) || 0;
  await typeInto(contents, '[data-testid="chat-input"]', message);
  await click(contents, '[data-testid="chat-send"]');

  /** @type {any[]} */
  const samples = [];
  const deadline = Date.now() + maxMs;
  let ended = false;
  while (Date.now() < deadline) {
    const snap = await evalIn(contents, DESK_SNAPSHOT_JS);
    samples.push(snap);
    if (onSample) await onSample(snap);
    if (snap.ends > before) {
      ended = true;
      break;
    }
    await sleep(40);
  }
  const final = await evalIn(contents, DESK_SNAPSHOT_JS);
  samples.push(final);
  return { samples, final, ended, trace: samples.map((s) => `${s.activity ?? "-"}/${s.tone ?? "-"}/${s.busy ?? "-"}/${s.ends}`).join(" ") };
}

/**
 * @param {import("electron").BrowserWindow} win
 * @param {(snap: any) => boolean} pred
 * @param {{ timeoutMs: number, intervalMs?: number }} options
 */
const waitForDesk = (win, pred, options) =>
  waitFor(async () => pred(await evalIn(win.webContents, DESK_SNAPSHOT_JS)), options);

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseDesk(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };
  /** @type {(string | null)[]} */
  const screenshots = [];

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };

  const hired = await hireThroughWizard(win.webContents, {
    roleKey: "programmer",
    employeeName: E2E_EMPLOYEE,
    backFrom2: false,
    backFrom3: false,
  });
  add("招聘一名程序员（票 03 向导路径）", hired.confirmed);
  const seated = await waitFor(
    async () => (await evalIn(win.webContents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1,
    { timeoutMs: 4000 },
  );
  add("新员工坐进工位", seated);
  if (!seated) return { checks };

  const snapshot = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('office.get')`));
  const employeeId = Number(
    (snapshot?.desks ?? [])
      .map((/** @type {any} */ d) => d.occupant)
      .find((/** @type {any} */ o) => o !== null)?.id ?? 0,
  );

  // Seed the employee's private workspace BEFORE any run.
  const dirs = enginePaths(ctx.dataDir, "pi", employeeId);
  mkdirSync(dirs.workspaceDir, { recursive: true });
  for (const [name, body] of Object.entries(SEED_FILES)) {
    await writeFile(path.join(dirs.workspaceDir, name), body, "utf8");
  }

  const drawerOpen = await waitFor(
    async () => {
      await click(win.webContents, '[data-testid="desk"][data-empty="false"]');
      return (await evalIn(win.webContents, `document.querySelector('[data-testid="chat-input"]') !== null`)) === true;
    },
    { timeoutMs: 3000 },
  );
  add("点击在岗员工打开对话浮层", drawerOpen);
  if (!drawerOpen) return { checks };

  // ── 1-3: 四类工具映射 — 读 / 写 / 执行（测试的两条在下面）────────
  /**
   * Screenshot when a condition holds for TWO consecutive samples: this
   * machine's GPU compositor intermittently serves a stale frame to
   * capturePage, so a single matched sample isn't enough for the still to
   * show the matched state. (The DOM assertions stay single-sample — they
   * read the live tree, not the compositor.)
   *
   * @param {(snap: any) => boolean} match @param {string} shotName
   */
  const captureOn = (match, shotName) => {
    let done = false;
    let matchedOnce = false;
    return async (/** @type {any} */ snap) => {
      if (done) return;
      if (!match(snap)) {
        matchedOnce = false;
        return;
      }
      if (!matchedOnce) {
        matchedOnce = true;
        return;
      }
      done = true;
      screenshots.push(await shot(ctx, win, shotName));
    };
  };

  const read = await sendAndObserve(ctx, win, MSG_READ, { onSample: captureOn((s) => s.activity === "read", "01-read") });
  add("读：屏幕画面切到「读」（真实 read 工具事件驱动）", read.ended && read.samples.some((s) => s.activity === "read"), read.trace);

  const write = await sendAndObserve(ctx, win, MSG_WRITE, { onSample: captureOn((s) => s.activity === "write", "02-write") });
  add("写：屏幕画面切到「写」（真实 write 工具事件驱动）", write.ended && write.samples.some((s) => s.activity === "write"), write.trace);

  const exec = await sendAndObserve(ctx, win, MSG_EXEC, { onSample: captureOn((s) => s.activity === "exec", "03-exec") });
  add("执行：powershell 命令切到「执行」画面", exec.ended && exec.samples.some((s) => s.activity === "exec"), exec.trace);

  // ── 4-5: 测试 — 过 = 绿屏 / 挂 = 红屏 ──────────────────────────
  const passRun = await sendAndObserve(ctx, win, MSG_TEST_PASS, {
    onSample: captureOn((s) => s.activity === "test" && s.tone === "pass", "04-test-pass"),
  });
  add(
    "测试通过：画面切到「测试」且屏幕变绿（node test_ok.mjs exit 0）",
    passRun.ended && passRun.samples.some((s) => s.activity === "test") && passRun.samples.some((s) => s.tone === "pass"),
    passRun.trace,
  );

  const failRun = await sendAndObserve(ctx, win, MSG_TEST_FAIL, {
    onSample: captureOn((s) => s.activity === "test" && s.tone === "fail", "05-test-fail"),
  });
  add(
    "测试失败：屏幕变红（node test_fail.mjs exit 1 → tool isError）",
    failRun.ended && failRun.samples.some((s) => s.activity === "test") && failRun.samples.some((s) => s.tone === "fail"),
    failRun.trace,
  );

  // ── 6: 策略拒绝 — 工位可见提示，不静默 ─────────────────────────
  const danger = await sendAndObserve(ctx, win, MSG_DANGER, {
    onSample: captureOn((s) => s.blocked === "true", "06-blocked"),
  });
  const markerSeen = danger.samples.some((s) => s.blocked === "true");
  const lightBlocked = danger.samples.some((s) => s.light?.tone === "blocked");
  const fileSurvived = existsSync(path.join(dirs.workspaceDir, "important.txt"));
  add(
    "被策略拒绝：工位出现可见拒绝提示（marker + 红灯 + 时间线一行），且危险删除确实没执行",
    danger.ended && markerSeen && danger.final.blockedLines >= 1 && fileSurvived,
    `blockedLines=${danger.final.blockedLines} fileSurvived=${fileSurvived} lightBlocked=${lightBlocked}`,
  );

  // ── 7: 空闲 9 秒摸鱼、45 秒去咖啡并返回工位 ────────────────────
  const idleStart = Date.now();
  const slackAt =
    (await waitForDesk(win, (s) => s.posture === "slack", { timeoutMs: 12_000 }))
      ? Date.now() - idleStart
      : -1;
  if (slackAt >= 0) screenshots.push(await shot(ctx, win, "07-slack"));
  add("空闲 9 秒 → 摸鱼（posture=slack，实测 " + slackAt + "ms）", slackAt >= 8_000 && slackAt <= 12_000);

  const awayAt =
    (await waitForDesk(win, (s) => s.posture === "coffee" && s.position === "away", { timeoutMs: 40_000 }))
      ? Date.now() - idleStart
      : -1;
  if (awayAt >= 0) screenshots.push(await shot(ctx, win, "08-coffee-away"));
  add("空闲 45 秒 → 去咖啡离座（position=away，实测 " + awayAt + "ms）", awayAt >= 44_000 && awayAt <= 52_000);

  const backAt =
    (await waitForDesk(win, (s) => s.position === "desk", { timeoutMs: 15_000 })) ? Date.now() - idleStart : -1;
  if (backAt >= 0) screenshots.push(await shot(ctx, win, "09-back-desk"));
  add("倒完咖啡返回工位（position 回到 desk）", backAt >= 0);

  // ── 8: 名牌与气泡可开关；关掉后仍能看出「在忙/在闲」─────────────
  let prefsShot = false;
  const again = await sendAndObserve(ctx, win, MSG_READ_AGAIN, {
    onSample: async (snap) => {
      if (!prefsShot && snap.busy === "true" && snap.hasPlate && snap.bubble === "在看资料") {
        prefsShot = true;
        await click(win.webContents, '[data-testid="toggle-plate"]');
        await click(win.webContents, '[data-testid="toggle-bubble"]');
        screenshots.push(await shot(ctx, win, "10-prefs-off-working"));
      }
    },
  });
  const bubbleWhileBusy = again.samples.some((s) => s.busy === "true" && s.bubble === "在看资料");
  add("气泡开：干活时头顶冒出「在看资料」", bubbleWhileBusy);

  const afterToggles = again.samples.filter((s) => s.busy === "true" && !s.hasPlate && s.bubble === null);
  const lightReadableWhileBusy = afterToggles.some((s) => s.light?.tone === "working" && s.light?.visible);
  add(
    "名牌+气泡关掉后：DOM 里再无名牌/气泡，但状态灯（working）+ busy 仍在 → 在忙可读",
    prefsShot && afterToggles.length > 0 && lightReadableWhileBusy,
    `busySamples=${afterToggles.length}`,
  );

  const wentIdle = await waitForDesk(
    win,
    (s) => s.busy === "false" && s.light?.tone !== "working",
    { timeoutMs: 5_000 },
  );
  add("这一轮收尾后回到「在闲」（busy=false、灯不再是 working）", wentIdle && again.ended);

  return {
    checks,
    evidence: {
      employeeId,
      screenshots: screenshots.filter(Boolean),
      shotFailures,
      idleTimingsMs: { slackAt, awayAt, backAt },
      sampleCounts: { read: read.samples.length, pass: passRun.samples.length, fail: failRun.samples.length, danger: danger.samples.length },
    },
  };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    mkdirSync(ctx.outDir, { recursive: true });
    outcome = await phaseDesk(ctx);
  } catch (err) {
    outcome.checks.push({ name: "unexpected error", ok: false, detail: String(err) });
  }

  const allOk = outcome.checks.length > 0 && outcome.checks.every((check) => check.ok);
  for (const check of outcome.checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  await writeFile(
    path.join(ctx.outDir, "desk.json"),
    `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
