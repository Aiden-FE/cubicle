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
 *   then the idle clock: 9s → deterministic coffee (walk → 5s machine →
 *   walk back → seated sip), then phone and minesweeper; screens must be the
 *   Windows desktop; empty and off-duty screens must be black;
 *   then the preference promise: 名牌 off → no plate in DOM, while posture,
 *   screen and the always-on status light still carry the state.
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
  ensureAllDaySchedule,
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
 * Ticket 18 removed every floating label, so the DOM contract is now data
 * attributes only: posture/trip/position/screen/look + the name on the desk.
 */
const DESK_SNAPSHOT_JS = `(() => {
  const d = document.querySelector('[data-testid="desk"][data-empty="false"]');
  return {
    busy: d?.dataset.busy ?? null,
    activity: d?.dataset.activity ?? null,
    tone: d?.dataset.tone ?? null,
    screen: d?.dataset.screen ?? null,
    posture: d?.dataset.posture ?? null,
    tripPhase: d?.dataset.tripPhase || null,
    destination: d?.dataset.destination || null,
    position: d?.dataset.position ?? null,
    blocked: d?.dataset.blocked ?? null,
    offDuty: d?.dataset.offDuty ?? null,
    look: d?.dataset.look ?? null,
    occupantName: d?.dataset.occupantName ?? null,
    labels: document.querySelectorAll('[data-testid="desk-occupant"], [data-testid="desk-light"], [data-testid="desk-bubble"], .amenity-tag').length,
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
  const contents = win.webContents;

  await ensureAllDaySchedule(win.webContents); // 票 09: 默认班表 09:00–18:00，下班中有 off_duty 闸；e2e 配全天班表

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
  const emptyScreenBlack = await waitFor(
    async () =>
      (await evalIn(
        win.webContents,
        `[...document.querySelectorAll('[data-testid="desk"][data-empty="true"]')].every((d) => d.dataset.screen === "black")`,
      )) === true,
    { timeoutMs: 2000 },
  );
  add("空工位的显示器是黑屏（不是待机图案）", emptyScreenBlack);

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
  add("读：程序员显示器是编码界面", read.samples.some((s) => s.activity === "read" && s.screen === "code"), read.trace);
  const textFreeState = await evalIn(
    win.webContents,
    `(() => {
      const desk = document.querySelector('[data-testid="desk"][data-empty="false"]');
      const text = desk?.textContent ?? "";
      const forbidden = ["在看资料", "在写东西", "在跑命令", "在跑测试", "在想事情", "在干活", "干活中", "摸鱼中", "去倒咖啡了", "在玩手机", "在玩扫雷", "在喝咖啡", "咖啡机", "饮水机"];
      return {
        bubbles: document.querySelectorAll('[data-testid="desk-bubble"]').length,
        plates: document.querySelectorAll('[data-testid="desk-occupant"]').length,
        lights: document.querySelectorAll('[data-testid="desk-light"]').length,
        amenities: document.querySelectorAll('.amenity-tag').length,
        forbidden: forbidden.filter((word) => text.includes(word)),
        occupantName: desk?.dataset.occupantName ?? null,
        look: desk?.dataset.look ?? "",
      };
    })()`,
  );
  add(
    "场景内零文字：无状态气泡/名牌/状态灯/设施工牌，姓名只在桌面实体名牌上",
    textFreeState.bubbles === 0 &&
      textFreeState.plates === 0 &&
      textFreeState.lights === 0 &&
      textFreeState.amenities === 0 &&
      textFreeState.forbidden.length === 0 &&
      textFreeState.occupantName === E2E_EMPLOYEE &&
      textFreeState.look.length > 0,
    JSON.stringify(textFreeState),
  );

  const write = await sendAndObserve(ctx, win, MSG_WRITE, { onSample: captureOn((s) => s.activity === "write", "02-write") });
  add("写：屏幕画面切到「写」（真实 write 工具事件驱动）", write.ended && write.samples.some((s) => s.activity === "write"), write.trace);
  add("写：程序员显示器是编码界面", write.samples.some((s) => s.activity === "write" && s.screen === "code"), write.trace);

  const exec = await sendAndObserve(ctx, win, MSG_EXEC, { onSample: captureOn((s) => s.activity === "exec", "03-exec") });
  add("执行：powershell 命令切到「执行」画面", exec.ended && exec.samples.some((s) => s.activity === "exec"), exec.trace);
  add("执行：显示器是终端界面", exec.samples.some((s) => s.activity === "exec" && s.screen === "terminal"), exec.trace);

  // ── 4-5: 测试 — 过 = 绿屏 / 挂 = 红屏 ──────────────────────────
  const passRun = await sendAndObserve(ctx, win, MSG_TEST_PASS, {
    onSample: captureOn((s) => s.activity === "test" && s.tone === "pass", "04-test-pass"),
  });
  add(
    "测试通过：画面切到「测试」且屏幕变绿（node test_ok.mjs exit 0）",
    passRun.ended && passRun.samples.some((s) => s.activity === "test") && passRun.samples.some((s) => s.tone === "pass"),
    passRun.trace,
  );
  add("测试通过：显示器是测试通过界面", passRun.samples.some((s) => s.screen === "test-pass"), passRun.trace);

  const failRun = await sendAndObserve(ctx, win, MSG_TEST_FAIL, {
    onSample: captureOn((s) => s.activity === "test" && s.tone === "fail", "05-test-fail"),
  });
  add(
    "测试失败：屏幕变红（node test_fail.mjs exit 1 → tool isError）",
    failRun.ended && failRun.samples.some((s) => s.activity === "test") && failRun.samples.some((s) => s.tone === "fail"),
    failRun.trace,
  );
  add("测试失败：显示器是测试失败界面", failRun.samples.some((s) => s.screen === "test-fail"), failRun.trace);

  // ── 6: 策略拒绝 — 工位可见提示，不静默 ─────────────────────────
  const danger = await sendAndObserve(ctx, win, MSG_DANGER, {
    onSample: captureOn((s) => s.blocked === "true", "06-blocked"),
  });
  const markerSeen = danger.samples.some((s) => s.blocked === "true");
  const fileSurvived = existsSync(path.join(dirs.workspaceDir, "important.txt"));
  add(
    "被策略拒绝：工位出现可见拒绝标记 + 时间线一行，且危险删除确实没执行",
    danger.ended && markerSeen && danger.final.blockedLines >= 1 && fileSurvived,
    `blockedLines=${danger.final.blockedLines} fileSurvived=${fileSurvived}`,
  );

  // ── 7: 随机摸鱼：咖啡（2.5s 去 + 5s 停留 + 2.5s 回 + 10s 喝）、手机、扫雷 ──
  // Pin the RNG only for the selection moments so the whole story (including
  // the explicit 5s machine stay) is deterministic; production remains random.
  await evalIn(contents, `window.__e2eRandom = Math.random; Math.random = () => 0.6; true`);
  const idleStart = Date.now();
  const coffeeStartSeen = await waitForDesk(
    win,
    (s) => s.posture === "coffee" && s.tripPhase === "to-target",
    { timeoutMs: 13_000 },
  );
  const coffeeAt = coffeeStartSeen ? Date.now() - idleStart : -1;
  const coffeeStart = /** @type {any} */ (await evalIn(contents, DESK_SNAPSHOT_JS));
  if (coffeeStartSeen) screenshots.push(await shot(ctx, win, "07-coffee-walk"));
  add(
    "空闲 9 秒随机到咖啡：起身走向咖啡机，显示器是 Windows 桌面",
    coffeeStartSeen && coffeeStart.screen === "desktop" && coffeeStart.position === "away",
    `coffeeAt=${coffeeAt}ms ${JSON.stringify(coffeeStart)}`,
  );

  const machineSeen = await waitForDesk(
    win,
    (s) => s.posture === "coffee" && s.tripPhase === "at-target",
    { timeoutMs: 5_000 },
  );
  const machineAt = Date.now();
  if (machineSeen) screenshots.push(await shot(ctx, win, "08-coffee-machine"));
  await sleep(4_000);
  const machineStill = /** @type {any} */ (await evalIn(contents, DESK_SNAPSHOT_JS));
  const returningSeen = await waitForDesk(
    win,
    (s) => s.posture === "coffee" && s.tripPhase === "returning",
    { timeoutMs: 2_500 },
  );
  const machineHoldMs = returningSeen ? Date.now() - machineAt : -1;
  add(
    "到咖啡机停留 5 秒后再往回走（4s 时仍在 machine 阶段）",
    machineSeen && machineStill.tripPhase === "at-target" && machineHoldMs >= 4_200,
    `hold=${machineHoldMs}ms`,
  );

  const sippingSeen = await waitForDesk(
    win,
    (s) => s.posture === "coffee" && s.tripPhase === "sipping" && s.position === "desk",
    { timeoutMs: 4_000 },
  );
  const sippingSnap = /** @type {any} */ (await evalIn(contents, DESK_SNAPSHOT_JS));
  if (sippingSeen) screenshots.push(await shot(ctx, win, "09-coffee-seated"));
  add(
    "回到工位坐着喝咖啡，显示器仍是 Windows 桌面",
    sippingSeen && sippingSnap.position === "desk" && sippingSnap.screen === "desktop",
    JSON.stringify(sippingSnap),
  );

  // Coffee sip ends after 10s, then 9s idle → pin 0.1 for phone.
  await evalIn(contents, `Math.random = () => 0.1; true`);
  const phoneSeen = await waitForDesk(win, (s) => s.posture === "phone" && s.position === "desk", { timeoutMs: 26_000 });
  const phoneSnap = /** @type {any} */ (await evalIn(contents, DESK_SNAPSHOT_JS));
  if (phoneSeen) screenshots.push(await shot(ctx, win, "10-phone"));
  add(
    "随机到手机：坐工位拿手机看，显示器是 Windows 桌面",
    phoneSeen && phoneSnap.screen === "desktop" && phoneSnap.position === "desk",
    JSON.stringify(phoneSnap),
  );

  // Phone ends after 12s, then 9s idle → pin 0.3 for minesweeper.
  await evalIn(contents, `Math.random = () => 0.3; true`);
  const mineSeen = await waitForDesk(win, (s) => s.posture === "minesweeper" && s.position === "desk", {
    timeoutMs: 27_000,
  });
  const mineSnap = /** @type {any} */ (await evalIn(contents, DESK_SNAPSHOT_JS));
  if (mineSeen) screenshots.push(await shot(ctx, win, "11-minesweeper"));
  add(
    "随机到扫雷：坐工位玩电脑，显示器是 Windows 桌面",
    mineSeen && mineSnap.screen === "desktop" && mineSnap.position === "desk",
    JSON.stringify(mineSnap),
  );
  // Minesweeper ends after 12s, then 9s idle → pin 0.9 for the water cooler
  // (ticket 18: the other break destination, same aisle graph).
  await evalIn(contents, `Math.random = () => 0.9; true`);
  const waterSeen = await waitForDesk(
    win,
    (s) => s.posture === "water" && s.tripPhase === "at-target",
    { timeoutMs: 40_000 },
  );
  const waterSnap = /** @type {any} */ (await evalIn(contents, DESK_SNAPSHOT_JS));
  if (waterSeen) screenshots.push(await shot(ctx, win, "12-water-cooler"));
  add(
    "随机到打水：走到饮水机停留，显示器仍是 Windows 桌面",
    waterSeen && waterSnap.destination === "water" && waterSnap.screen === "desktop",
    JSON.stringify(waterSnap),
  );
  await evalIn(contents, `if (window.__e2eRandom) Math.random = window.__e2eRandom; true`);

  // ── 8: 名牌可开关；关掉后状态仍由动作/屏幕/状态灯表达 ─────────────
  let prefsShot = false;
  const again = await sendAndObserve(ctx, win, MSG_READ_AGAIN, {
    onSample: async (snap) => {
      if (!prefsShot && snap.busy === "true" && (snap.occupantName ?? "").length > 0) {
        prefsShot = true;
        await click(win.webContents, '[data-testid="settings-open"]');
        await click(win.webContents, '[data-testid="toggle-plate"]');
        await click(win.webContents, '[data-testid="settings-close"]');
        // Settings is a global modal and closed the chat overlay; reopen the
        // employee's conversation so the run's end marker keeps being observed.
        await evalIn(win.webContents, `document.querySelector('[data-testid="desk"][data-empty="false"]')?.click()`);
        await waitFor(async () => (await evalIn(win.webContents, `document.querySelector('[data-testid="chat-input"]') !== null`)) === true, {
          timeoutMs: 3000,
        });
        screenshots.push(await shot(ctx, win, "10-prefs-off-working"));
      }
    },
  });

  const platePrefOff = (await evalIn(win.webContents, `document.querySelector('[data-testid="office-floor"]')?.dataset.nameplates ?? ''`)) === "off";
  const afterToggles = again.samples.filter((s) => s.busy === "true");
  add(
    "名牌关掉后：桌面实体名牌隐藏，但动作/屏幕/busy 仍在 → 在忙可读",
    prefsShot && platePrefOff && afterToggles.length > 0 && afterToggles.every((s) => s.screen === "code"),
    `busySamples=${afterToggles.length} nameplates=${platePrefOff ? "off" : "on"}`,
  );

  const wentIdle = await waitForDesk(win, (s) => s.busy === "false", { timeoutMs: 5_000 });
  // Chat history replay only keeps the latest run, so an agent_end count that
  // fell while Settings was open cannot be compared across the remount. The
  // observable contract is the desk settling: busy=false.
  add(
    "这一轮收尾后回到「在闲」（busy=false）",
    wentIdle,
    JSON.stringify({ ended: again.ended, final: again.final }),
  );

  // Restore the nameplate preference so later phases see a normal office.
  await click(win.webContents, '[data-testid="settings-open"]');
  await click(win.webContents, '[data-testid="toggle-plate"]');
  await click(win.webContents, '[data-testid="settings-close"]');

  // ── 9: 下班 → 所有显示器黑屏；上班后恢复桌面 ───────────────────
  await click(win.webContents, '[data-testid="chat-close"]');
  await click(win.webContents, '[data-testid="rail-duty"]');
  const dutyPanel = await waitFor(
    async () => (await evalIn(win.webContents, `document.querySelector('[data-testid="duty-off"]') !== null`)) === true,
    { timeoutMs: 3000 },
  );
  await click(win.webContents, '[data-testid="duty-off"]');
  const offDutyBlack = await waitFor(
    async () => {
      const info = /** @type {any} */ (
        await evalIn(
          win.webContents,
          `(() => ({
            shell: document.querySelector('[data-testid="app-shell"]')?.dataset.offDuty ?? null,
            desks: [...document.querySelectorAll('[data-testid="desk"]')].map((d) => d.dataset.screen),
          }))()`,
        )
      );
      return info.shell === "true" && info.desks.length > 0 && info.desks.every((/** @type {string} */ screen) => screen === "black") ? info : null;
    },
    { timeoutMs: 4000 },
  );
  if (offDutyBlack) screenshots.push(await shot(ctx, win, "13-off-duty-black"));
  add("下班后：整间办公室所有工位显示器黑屏", dutyPanel && Boolean(offDutyBlack), JSON.stringify(offDutyBlack));

  await click(win.webContents, '[data-testid="duty-on"]');
  const onDutyScreen = await waitFor(
    async () => {
      const snap = /** @type {any} */ (await evalIn(win.webContents, DESK_SNAPSHOT_JS));
      return snap.offDuty === "false" && snap.screen !== "black" ? snap : null;
    },
    { timeoutMs: 4000 },
  );
  add("上班后：占用工位显示器恢复桌面/工作界面", Boolean(onDutyScreen), JSON.stringify(onDutyScreen));

  return {
    checks,
    evidence: {
      employeeId,
      screenshots: screenshots.filter(Boolean),
      shotFailures,
      idleTimingsMs: { coffeeAt, machineHoldMs },
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
    outcome.checks.push({ name: "unexpected error", ok: false, detail: err instanceof Error ? err.stack ?? err.message : String(err) });
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
