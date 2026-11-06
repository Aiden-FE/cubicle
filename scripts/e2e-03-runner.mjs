/**
 * Ticket 03 acceptance runner — hiring the first employee, driven from the
 * Electron main process but parked under scripts/ (main stays business-free).
 *
 * Phase "hire" (see also scripts/e2e-03.mjs orchestrator):
 *   boot → office with 4 empty desks → fingerprint the user's home directory
 *   (root entries + engine config dirs) → click an empty desk → three-step
 *   wizard (forward, 2→1 back, and 3→2 back) → capability manifest lists
 *   persona / skills / tools / engine / cost → confirm → desk flips from
 *   空置 to 占用中 with the person seated → hire the SAME role onto a second
 *   desk → office snapshot shows both with identical role snapshots (recorded
 *   into hire.json for the restart phase) → home fingerprint unchanged →
 *   reload the view, occupancy intact.
 * Phase "verify": fresh process proves both employees — and their role
 *   snapshots, compared byte-for-byte against the snapshots recorded at hire
 *   time — survived the restart.
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { mkdirSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { out, waitFor, evalIn, click, typeInto, readJson } from "./e2e-harness.mjs";

const E2E_HIRE_A = "E2E 程序员甲";
const E2E_HIRE_B = "E2E 程序员乙";

/**
 * Engine-owned config folders under the user's home. Hiring must not touch
 * any of them (acceptance: 招聘过程不写任何用户家目录下的引擎配置). The home
 * root itself is fingerprinted too, so a write anywhere else under the home
 * that adds/removes a top-level entry (or rewrites the root's mtime) shows up.
 */
const HOME_ENGINE_DIRS = [".pi", ".codex", ".claude", ".qoder", ".agents"];

/**
 * @typedef {object} E2EContext
 * @property {import("electron").App} app
 * @property {() => import("electron").BrowserWindow | null} getMainWindow
 * @property {{ state: string, pid: number | null, send: (m: unknown) => boolean }} supervisor
 * @property {string} dataDir
 * @property {number} bootStartMs
 * @property {"hire" | "verify"} phase
 * @property {string} outDir
 */

/**
 * Snapshot the user's home: root entry count + mtime, and per engine dir the
 * file count + newest mtime (bounded walk). Hiring must leave all of it equal.
 *
 * @returns {Promise<Record<string, { exists: boolean, files: number, newestMtimeMs: number }>>}
 */
async function fingerprintHome() {
  /** @type {Record<string, { exists: boolean, files: number, newestMtimeMs: number }>} */
  const fingerprint = {};
  /** @param {string} root @param {number} maxDepth */
  const walkFingerprint = async (root, maxDepth) => {
    let files = 0;
    let newestMtimeMs = 0;
    let exists = false;
    /** @param {string} folder @param {number} depth */
    const walk = async (folder, depth) => {
      const entries = await readdir(folder, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && depth < maxDepth) {
          await walk(path.join(folder, entry.name), depth + 1);
          continue;
        }
        const info = await stat(path.join(folder, entry.name));
        files += 1;
        newestMtimeMs = Math.max(newestMtimeMs, info.mtimeMs);
      }
    };
    try {
      exists = true;
      await walk(root, 0);
    } catch {
      exists = false;
    }
    return { exists, files, newestMtimeMs };
  };

  // Depth 0 at the home root: top-level entries only — cheap, and any new
  // top-level directory (where engine config would live) changes the count.
  fingerprint["."] = await walkFingerprint(os.homedir(), 0);
  for (const dir of HOME_ENGINE_DIRS) {
    fingerprint[dir] = await walkFingerprint(path.join(os.homedir(), dir), 3);
  }
  return fingerprint;
}

/**
 * @param {{ exists: boolean, files: number, newestMtimeMs: number }} before
 * @param {{ exists: boolean, files: number, newestMtimeMs: number }} after
 */
function homeDirUntouched(before, after) {
  return before.exists === after.exists && before.files === after.files && before.newestMtimeMs === after.newestMtimeMs;
}

const DESK_COUNT_JS = `document.querySelectorAll('[data-testid="desk"]').length`;
const EMPTY_DESK_COUNT_JS = `document.querySelectorAll('[data-testid="desk"][data-empty="true"]').length`;
const OCCUPIED_DESK_COUNT_JS = `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`;
const BADGE_ONLINE_JS = `document.querySelector('[data-testid="host-status"]')?.dataset.online`;
const HIRE_STEP_JS = `document.querySelector('[data-testid="hire-step"]')?.dataset.step`;
const OCCUPANT_TEXT_JS = `Array.from(document.querySelectorAll('[data-testid="desk-occupant"]')).map((n) => n.textContent).join("|")`;

/**
 * Drive the wizard for one hire through the real UI code path (DOM clicks
 * and input events against the live React tree — not bridge shortcuts).
 *
 * @param {import("electron").WebContents} contents
 * @param {{ employeeName: string, backFrom2: boolean, backFrom3: boolean }} options
 * @returns {Promise<{ opened: boolean, roleCount: number, manifestOk: boolean, wentBack2: boolean, wentBack3: boolean, confirmed: boolean }>}
 */
async function hireThroughWizard(contents, { employeeName, backFrom2, backFrom3 }) {
  const outcome = {
    opened: false,
    roleCount: 0,
    manifestOk: false,
    wentBack2: false,
    wentBack3: false,
    confirmed: false,
  };

  await click(contents, '[data-testid="desk"][data-empty="true"]');
  outcome.opened = await waitFor(
    async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="role-option"]').length`)) >= 1,
    { timeoutMs: 3000 },
  );
  if (!outcome.opened) return outcome;
  outcome.roleCount = Number(await evalIn(contents, `document.querySelectorAll('[data-testid="role-option"]').length`));

  await click(contents, '[data-testid="role-option"][data-role-key="programmer"]');
  await click(contents, '[data-testid="hire-next"]');
  const onStep2 = await waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === "2", { timeoutMs: 2000 });
  if (!onStep2) return outcome;

  const manifestText = String(
    await evalIn(contents, `document.querySelector('[data-testid="capability-list"]')?.innerText ?? ''`),
  );
  outcome.manifestOk = ["人格", "技能", "工具", "引擎", "成本", "严谨务实", "git 工作流", "bash", "pi · default", "50 万"].every(
    (needle) => manifestText.includes(needle),
  );

  /** @param {number} fromStep */
  const goBackAndReturn = async (fromStep) => {
    await click(contents, '[data-testid="hire-back"]');
    const back = await waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === String(fromStep - 1), {
      timeoutMs: 2000,
    });
    if (!back) return false;
    await click(contents, '[data-testid="hire-next"]');
    return waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === String(fromStep), { timeoutMs: 2000 });
  };

  if (backFrom2) outcome.wentBack2 = await goBackAndReturn(2);

  await click(contents, '[data-testid="hire-next"]');
  const onStep3 = await waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === "3", { timeoutMs: 2000 });
  if (!onStep3) return outcome;

  if (backFrom3) outcome.wentBack3 = await goBackAndReturn(3);

  await typeInto(contents, '[data-testid="employee-name-input"]', employeeName);
  await click(contents, '[data-testid="hire-confirm"]');
  outcome.confirmed = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="hire-modal"]')`)) === null,
    { timeoutMs: 4000 },
  );
  return outcome;
}

/**
 * @param {E2EContext} ctx
 */
async function bootAndShowOffice(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  await waitFor(async () => ctx.supervisor.state === "online", { timeoutMs: 5000 });
  add("AgentHost 在 5s 内上线", ctx.supervisor.state === "online", `state=${ctx.supervisor.state}`);

  const win = ctx.getMainWindow();
  if (!win) {
    add("主窗口存在", false);
    return { win: null, checks };
  }
  add("主窗口存在", true);

  const desksShown = await waitFor(
    async () => (await evalIn(win.webContents, DESK_COUNT_JS)) === 4,
    { timeoutMs: 5000 },
  );
  add("办公室显示 4 个工位（来自数据库）", desksShown, `${Date.now() - ctx.bootStartMs}ms after boot`);

  const onlineBadge = await waitFor(async () => (await evalIn(win.webContents, BADGE_ONLINE_JS)) === "true", {
    timeoutMs: 4000,
  });
  add("界面显示 AgentHost 在线", onlineBadge);

  return { win, checks };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], snapshots?: any[] }>}
 */
async function phaseHire(ctx) {
  const { win, checks } = await bootAndShowOffice(ctx);
  if (!win) return { checks };
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const homeBefore = await fingerprintHome();

  const first = await hireThroughWizard(win.webContents, { employeeName: E2E_HIRE_A, backFrom2: true, backFrom3: false });
  add("点空工位打开招聘向导，角色库列出 3 个预设", first.opened && first.roleCount === 3, `roles=${first.roleCount}`);
  add("能力清单展示人格、技能、工具、引擎与成本", first.manifestOk);
  add("确认录用提交成功（向导关闭）", first.confirmed);

  const occupiedOne = await waitFor(async () => (await evalIn(win.webContents, OCCUPIED_DESK_COUNT_JS)) === 1, {
    timeoutMs: 4000,
  });
  const labelShown = await waitFor(
    async () => String(await evalIn(win.webContents, OCCUPANT_TEXT_JS)).includes(E2E_HIRE_A),
    { timeoutMs: 4000 },
  );
  add("工位从「空」变「占用」，办公室里出现该员工", occupiedOne && labelShown);

  const second = await hireThroughWizard(win.webContents, { employeeName: E2E_HIRE_B, backFrom2: false, backFrom3: true });
  add("三步可前进/后退（2→1 与 3→2）", first.wentBack2 && second.wentBack3);
  const occupiedTwo = await waitFor(async () => (await evalIn(win.webContents, OCCUPIED_DESK_COUNT_JS)) === 2, {
    timeoutMs: 4000,
  });
  add("同一角色可再招一人，坐不同工位", second.confirmed && occupiedTwo);

  // The host's view of the office: both occupants share one role id with
  // identical frozen snapshots. Record the snapshots into hire.json so the
  // restart phase compares against the HIRE-time bytes, not current presets.
  const snapshot = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('office.get')`));
  const occupants = (snapshot?.desks ?? [])
    .map((/** @type {any} */ d) => d.occupant)
    .filter((/** @type {any} */ o) => o !== null);
  const snapshotsMatch =
    occupants.length === 2 &&
    occupants[0].roleId === occupants[1].roleId &&
    occupants[0].roleSnapshot.key === "programmer" &&
    JSON.stringify(occupants[0].roleSnapshot) === JSON.stringify(occupants[1].roleSnapshot);
  add("两名员工快照同一角色、同一份冻结清单", snapshotsMatch, JSON.stringify(occupants.map((/** @type {any} */ o) => o?.name)));

  const homeAfter = await fingerprintHome();
  const untouched = Object.keys(homeBefore).every((dir) => homeDirUntouched(homeBefore[dir], homeAfter[dir]));
  add("招聘未写入用户家目录（根条目 + 引擎配置目录指纹不变）", untouched, JSON.stringify(homeAfter));

  const pidBefore = ctx.supervisor.pid;
  win.webContents.reload();
  const occupiedAfterReload = await waitFor(
    async () => (await evalIn(win.webContents, OCCUPIED_DESK_COUNT_JS)) === 2,
    { timeoutMs: 5000 },
  );
  add(
    "重载视图后占用照常显示（宿主未重启，pid 不变）",
    occupiedAfterReload && ctx.supervisor.pid === pidBefore,
    `pid ${pidBefore} → ${ctx.supervisor.pid}`,
  );

  return {
    checks,
    snapshots: occupants.map((/** @type {any} */ o) => ({ name: o?.name, roleSnapshot: o?.roleSnapshot })),
  };
}

/**
 * @param {E2EContext} ctx
 */
async function phaseVerify(ctx) {
  const { win, checks } = await bootAndShowOffice(ctx);
  if (!win) return { checks };
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const snapshot = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('office.get')`));
  const occupants = (snapshot?.desks ?? [])
    .map((/** @type {any} */ d) => d.occupant)
    .filter((/** @type {any} */ o) => o !== null);
  const names = occupants.map((/** @type {any} */ o) => o?.name).sort();
  add(
    "重启后：两名员工仍在工位上",
    occupants.length === 2 && names.includes(E2E_HIRE_A) && names.includes(E2E_HIRE_B),
    names.join(","),
  );

  // Snapshot equality against the bytes recorded AT HIRE TIME (different
  // process, different boot), not the current preset rows.
  const hireEvidence = await readJson(path.join(ctx.outDir, "hire.json"));
  /** @type {any[]} */
  const recorded = hireEvidence?.snapshots ?? [];
  const snapshotMatchesHire =
    recorded.length === 2 &&
    occupants.every((/** @type {any} */ o) => {
      const match = recorded.find((r) => r.name === o?.name);
      return match && JSON.stringify(match.roleSnapshot) === JSON.stringify(o?.roleSnapshot);
    });
  add("重启后：角色快照与 hire 阶段录制的录用时刻快照逐字节一致", snapshotMatchesHire, `recorded=${recorded.length}`);

  const canvasShowsBoth = await waitFor(
    async () => (await evalIn(win.webContents, OCCUPIED_DESK_COUNT_JS)) === 2,
    { timeoutMs: 5000 },
  );
  const textShowsBoth = await waitFor(async () => {
    const text = String(await evalIn(win.webContents, OCCUPANT_TEXT_JS));
    return text.includes(E2E_HIRE_A) && text.includes(E2E_HIRE_B);
  }, { timeoutMs: 4000 });
  add("画面显示两名占用员工与其角色名", canvasShowsBoth && textShowsBoth);

  return { checks };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], snapshots?: any[] }} */
  let outcome = { checks: [] };
  try {
    outcome = ctx.phase === "verify" ? await phaseVerify(ctx) : await phaseHire(ctx);
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
