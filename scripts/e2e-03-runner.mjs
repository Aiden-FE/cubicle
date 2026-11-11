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
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
  waitFor,
  evalIn,
  readJson,
  fingerprintHome,
  homeDirUntouched,
  bootAndShowOffice,
  hireThroughWizard,
} from "./e2e-harness.mjs";

const E2E_HIRE_A = "E2E 程序员甲";
const E2E_HIRE_B = "E2E 程序员乙";

/** Capability-manifest needles for step 2 (ticket 05 preset roster). */
const MANIFEST_NEEDLES = ["人格", "技能", "工具", "引擎", "成本", "严谨务实", "git 工作流", "powershell", "pi · E2E Model", "50 万"];

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

const OCCUPIED_DESK_COUNT_JS = `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`;
const OCCUPANT_TEXT_JS = `Array.from(document.querySelectorAll('[data-testid="desk-occupant"]')).map((n) => n.textContent).join("|")`;

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], snapshots?: any[] }>}
 */
async function phaseHire(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };
  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };

  const homeBefore = await fingerprintHome();

  const first = await hireThroughWizard(win.webContents, {
    roleKey: "programmer",
    employeeName: E2E_HIRE_A,
    backFrom2: true,
    backFrom3: false,
    manifestNeedles: MANIFEST_NEEDLES,
  });
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

  const second = await hireThroughWizard(win.webContents, {
    roleKey: "programmer",
    employeeName: E2E_HIRE_B,
    backFrom2: false,
    backFrom3: true,
  });
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
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };
  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };

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
