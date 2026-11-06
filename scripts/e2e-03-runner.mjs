/**
 * Ticket 03 acceptance runner — hiring the first employee, driven from the
 * Electron main process but parked under scripts/ (main stays business-free).
 *
 * Phase "hire" (see also scripts/e2e-03.mjs orchestrator):
 *   boot → office with 4 empty desks → fingerprint engine config dirs under
 *   the user's home → click an empty desk → three-step wizard (forward AND
 *   back navigation) → capability manifest lists persona / skills / tools /
 *   engine / cost → confirm → desk flips from 空置 to 占用中 with the person
 *   seated → hire the SAME role onto a second desk → office snapshot shows
 *   both with identical role snapshots → reload the view, occupancy intact.
 * Phase "verify": fresh process proves both employees and their role
 *   snapshots survived the restart, byte-for-byte equal to the hires.
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { mkdirSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const E2E_HIRE_A = "E2E 程序员甲";
const E2E_HIRE_B = "E2E 程序员乙";

/**
 * Engine-owned config folders under the user's home. Hiring must not touch
 * any of them (acceptance: 招聘过程不写任何用户家目录下的引擎配置).
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

/** @param {string} line */
function out(line) {
  process.stdout.write(line + "\n");
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {() => Promise<boolean>} predicate
 * @param {{ timeoutMs: number, intervalMs?: number }} options
 */
async function waitFor(predicate, { timeoutMs, intervalMs = 100 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return true;
    } catch {
      // view not ready yet — keep polling
    }
    await sleep(intervalMs);
  }
  return false;
}

/**
 * @param {import("electron").WebContents} contents
 * @param {string} code
 */
const evalIn = (contents, code) => contents.executeJavaScript(code, true);

/**
 * @param {import("electron").WebContents} contents
 * @param {string} selector
 */
const click = (contents, selector) =>
  evalIn(contents, `document.querySelector(${JSON.stringify(selector)})?.click() ?? null`);

/**
 * Type into a controlled React input without a form trigger.
 *
 * @param {import("electron").WebContents} contents
 * @param {string} selector
 * @param {string} value
 */
async function typeInto(contents, selector, value) {
  await evalIn(
    contents,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
}

/**
 * Snapshot every home-directory engine config dir: does it exist, how many
 * files inside, and the newest mtime. Hiring must leave this unchanged.
 *
 * @returns {Promise<Record<string, { exists: boolean, files: number, newestMtimeMs: number }>>}
 */
async function fingerprintHomeEngineDirs() {
  /** @type {Record<string, { exists: boolean, files: number, newestMtimeMs: number }>} */
  const fingerprint = {};
  for (const dir of HOME_ENGINE_DIRS) {
    const root = path.join(os.homedir(), dir);
    let files = 0;
    let newestMtimeMs = 0;
    let exists = false;
    /** @param {string} folder @param {number} depth */
    const walk = async (folder, depth) => {
      const entries = await readdir(folder, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && depth < 3) {
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
    fingerprint[dir] = { exists, files, newestMtimeMs };
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
 * Drive the wizard for one hire through real clicks.
 *
 * @param {import("electron").WebContents} contents
 * @param {{ employeeName: string, exerciseBack: boolean }} options
 * @returns {Promise<{ opened: boolean, roleCount: number, manifestOk: boolean, wentBack: boolean, confirmed: boolean }>}
 */
async function hireThroughWizard(contents, { employeeName, exerciseBack }) {
  const outcome = { opened: false, roleCount: 0, manifestOk: false, wentBack: false, confirmed: false };

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

  if (exerciseBack) {
    await click(contents, '[data-testid="hire-back"]');
    const backTo1 = await waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === "1", { timeoutMs: 2000 });
    if (backTo1) {
      await click(contents, '[data-testid="hire-next"]');
      outcome.wentBack = await waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === "2", { timeoutMs: 2000 });
    }
  }

  await click(contents, '[data-testid="hire-next"]');
  const onStep3 = await waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === "3", { timeoutMs: 2000 });
  if (!onStep3) return outcome;

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
 */
async function phaseHire(ctx) {
  const { win, checks } = await bootAndShowOffice(ctx);
  if (!win) return { checks };
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const homeBefore = await fingerprintHomeEngineDirs();

  const first = await hireThroughWizard(win.webContents, { employeeName: E2E_HIRE_A, exerciseBack: true });
  add("点空工位打开招聘向导，角色库列出 3 个预设", first.opened && first.roleCount === 3, `roles=${first.roleCount}`);
  add("能力清单展示人格、技能、工具、引擎与成本", first.manifestOk);
  add("三步可前进/后退", first.wentBack);
  add("确认录用提交成功（向导关闭）", first.confirmed);

  const occupiedOne = await waitFor(async () => (await evalIn(win.webContents, OCCUPIED_DESK_COUNT_JS)) === 1, {
    timeoutMs: 4000,
  });
  const labelShown = await waitFor(
    async () => String(await evalIn(win.webContents, OCCUPANT_TEXT_JS)).includes(E2E_HIRE_A),
    { timeoutMs: 4000 },
  );
  add("工位从「空」变「占用」，办公室里出现该员工", occupiedOne && labelShown);

  const second = await hireThroughWizard(win.webContents, { employeeName: E2E_HIRE_B, exerciseBack: false });
  const occupiedTwo = await waitFor(async () => (await evalIn(win.webContents, OCCUPIED_DESK_COUNT_JS)) === 2, {
    timeoutMs: 4000,
  });
  add("同一角色可再招一人，坐不同工位", second.confirmed && occupiedTwo);

  // The host's view of the office: both occupants share one role id with
  // identical frozen snapshots.
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

  const homeAfter = await fingerprintHomeEngineDirs();
  const untouched = Object.keys(homeBefore).every((dir) => homeDirUntouched(homeBefore[dir], homeAfter[dir]));
  add("招聘未写入家目录下的引擎配置", untouched, JSON.stringify(homeAfter));

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

  return { checks };
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

  // The snapshot must equal the role definition as it was at hire time.
  const rolesReply = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('role.list')`));
  const programmer = (rolesReply?.roles ?? []).find((/** @type {any} */ r) => r.key === "programmer");
  const snapshotMatches =
    occupants.length === 2 &&
    occupants.every(
      (/** @type {any} */ o) =>
        JSON.stringify(o.roleSnapshot) ===
        JSON.stringify({ key: programmer.key, name: programmer.name, tagline: programmer.tagline, manifest: programmer.manifest }),
    );
  add("重启后：角色快照与录用时（当前预设未被改动时）逐字节一致", snapshotMatches);

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
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[] }} */
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
