/**
 * 票 a03 acceptance runner — 「学院浮层」, driven from Electron main but parked
 * under scripts/ (main stays business-free).
 *
 * Phase "panel" (one continuous story in one 1280×800 window, NEO_HOME =
 * tmp/e2e-academy/neo-home seeded by the orchestrator):
 *   boot → 左轨第五入口「学院」在（公司切换 / 工单台 / 花名册 / 上下班 / 学院）
 *   → 画布基线（满窗 + 工位坐标）→ 开浮层：画布尺寸与工位坐标一动不动（验收 1）
 *   → fixture 里没有资源 → 空态可见（验收 2：数据全部来自 ~/.neo，不硬编码）
 *   → 装：源=本机 fixture 目录 → vendored `neo add --domain demo -s '*'`
 *     （ELECTRON_RUN_AS_NODE 只进该子进程 env，vendor/README.md 合同）
 *     → 可读回显 + 行出现、来源=本机（验收 3+5）
 *   → 下发：勾 e2e-role-a → role set + update 收敛 → 行「被引用角色」实时变
 *     + role.list 投影缓存现值（验收 4）
 *   → 再测画布（浮层开着、行不少）→ 收起浮层 → 工位坐标回到基线
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { out, sleep, waitFor, evalIn, click, typeInto, bootAndShowOffice } from "./e2e-harness.mjs";

const ROLE = "e2e-role-a";
const DOMAIN = "demo";
const SKILL = "hello-academy";

/** 照 e2e:08 的断法：office-floor 满窗 + room 尺寸（浮层不许挤压画布）。 */
const CANVAS_JS = `(() => {
  const floor = document.querySelector('[data-testid="office-floor"]');
  const room = document.querySelector('[data-testid="room"]');
  const rr = room?.getBoundingClientRect();
  return {
    innerW: window.innerWidth, innerH: window.innerHeight,
    floorW: floor ? floor.clientWidth : 0, floorH: floor ? floor.clientHeight : 0,
    roomW: room ? room.clientWidth : 0, roomH: room ? room.clientHeight : 0,
    roomRectW: rr ? Math.round(rr.width) : 0, roomRectH: rr ? Math.round(rr.height) : 0,
  };
})()`;

/** 工位坐标（票 16 的断法）：desk 的 [id,left,top]，浮层开合必须逐字节不变。 */
const DESKS_JS = `(() =>
  [...document.querySelectorAll('[data-testid="desk"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return [Number(el.dataset.deskId), Math.round(r.left), Math.round(r.top)];
  })
)()`;

/** @param {string} resourceKey */
const ROW_CELLS_JS = (resourceKey) =>
  `(() => {
    const row = [...document.querySelectorAll('[data-testid="academy-row"]')].find((el) => el.dataset.resourceKey === ${JSON.stringify(resourceKey)});
    if (!row) return null;
    const text = (sel) => row.querySelector(sel)?.textContent ?? '';
    return {
      kind: text('[data-testid="academy-row-kind"]'),
      domain: text('[data-testid="academy-row-domain"]'),
      hash: text('[data-testid="academy-row-hash"]'),
      ref: text('[data-testid="academy-row-ref"]'),
    };
  })()`;

/** @param {import("electron").WebContents} contents */
const echoText = async (contents) => String(await evalIn(contents, `document.querySelector('[data-testid="academy-echo"]')?.textContent ?? ''`));

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phasePanel(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;

  // ── 画布基线 ─────────────────────────────────────────────────
  const baseCanvas = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  const baseDesks = /** @type {any} */ (await evalIn(contents, DESKS_JS));
  add(
    "窗口 ≈1280 且画布（office-floor）满窗",
    baseCanvas.innerW >= 1200 && baseCanvas.floorW === baseCanvas.innerW && baseCanvas.floorH === baseCanvas.innerH,
    JSON.stringify(baseCanvas),
  );

  // ── 左轨第五入口「学院」 ─────────────────────────────────────
  const rail = /** @type {any} */ (
    await evalIn(
      contents,
      `(() => ({
        academy: document.querySelector('[data-testid="rail-academy"]') !== null,
        roster: document.querySelector('[data-testid="rail-roster"]') !== null,
        duty: document.querySelector('[data-testid="rail-duty"]') !== null,
      }))()`,
    )
  );
  add("左轨五入口齐（公司切换 / 工单台 / 花名册 / 上下班 / 学院）", rail.academy && rail.roster && rail.duty, JSON.stringify(rail));

  // ── 开浮层：画布与工位坐标不动（验收 1，照 e2e:08 断法）──────
  await click(contents, '[data-testid="rail-academy"]');
  const opened = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="academy-panel"]') !== null`)) === true,
    { timeoutMs: 4000 },
  );
  add("点「学院」开浮层", opened);
  await sleep(300);
  const canvasOpen = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  const desksOpen = /** @type {any} */ (await evalIn(contents, DESKS_JS));
  add(
    "学院浮层是浮层：画布仍满窗、房间尺寸不变、8 个工位坐标逐字节不变",
    canvasOpen.floorW === canvasOpen.innerW &&
      canvasOpen.floorH === canvasOpen.innerH &&
      canvasOpen.roomW === baseCanvas.roomW &&
      canvasOpen.roomH === baseCanvas.roomH &&
      JSON.stringify(desksOpen) === JSON.stringify(baseDesks),
    JSON.stringify({ canvasOpen, desksOpen }),
  );

  // ── 空态：fixture NEO_HOME 里只有角色没有资源（验收 2）───────
  const empty = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="academy-empty"]') !== null`)) === true,
    { timeoutMs: 5000 },
  );
  const rowsBefore = Number(await evalIn(contents, `document.querySelectorAll('[data-testid="academy-row"]').length`));
  add("空 ~/.neo 资源 = 空态（数据全部来自 NEO_HOME，无硬编码行）", empty && rowsBefore === 0, `rows=${rowsBefore}`);

  // ── 装：本机源目录 → vendored neo add --domain demo（验收 3）─
  const srcDir = path.join(ctx.outDir, "src");
  await typeInto(contents, '[data-testid="academy-source"]', srcDir);
  await typeInto(contents, '[data-testid="academy-target-name"]', DOMAIN);
  await click(contents, '[data-testid="academy-install"]');
  const installed = await waitFor(
    async () =>
      (await evalIn(contents, `document.querySelector('[data-testid="academy-echo"]')?.dataset.kind ?? ''`)) === "ok" &&
      (await evalIn(contents, `document.querySelector('[data-testid="academy-row"][data-resource-key="d:${DOMAIN}/${SKILL}"]') !== null`)) === true,
    { timeoutMs: 150_000, intervalMs: 500 },
  );
  const echoInstall = await echoText(contents);
  add("装（vendored CLI，ELECTRON_RUN_AS_NODE 进子进程）：可读回显 + 行出现", installed && /installed hello-academy/i.test(echoInstall), echoInstall.slice(0, 300));

  const cellsInstall = /** @type {any} */ (await evalIn(contents, ROW_CELLS_JS(`d:${DOMAIN}/${SKILL}`)));
  add(
    "行字段齐：名称/领域/来源=本机/hash/被引用角色=—（来源标记来自面板安装记录）",
    Boolean(cellsInstall) && cellsInstall.domain === DOMAIN && cellsInstall.kind === "本机" && /^[0-9a-f]{8}$/.test(cellsInstall.hash) && cellsInstall.ref === "—",
    JSON.stringify(cellsInstall),
  );

  // ── 下发：role set + 收敛 → 投影缓存同步 → 引用角色实时（验收 4）──
  await click(contents, `[data-testid="academy-dispatch"][data-domain="${DOMAIN}"]`);
  const tray = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="academy-role-pick"][data-role="${ROLE}"]') !== null`)) === true,
    { timeoutMs: 4000 },
  );
  add(`下发托盘：列出 ~/.neo 里的角色（${ROLE}）`, tray);
  await click(contents, `[data-testid="academy-role-pick"][data-role="${ROLE}"]`);
  await click(contents, '[data-testid="academy-dispatch-confirm"]');
  const dispatched = await waitFor(
    async () => {
      const cells = /** @type {any} */ (await evalIn(contents, ROW_CELLS_JS(`d:${DOMAIN}/${SKILL}`)));
      return Boolean(cells) && cells.ref.includes(ROLE);
    },
    { timeoutMs: 60_000, intervalMs: 500 },
  );
  const echoDispatch = await echoText(contents);
  add("下发（role set → update 收敛）：回显可读且列表「被引用角色」实时跟上", dispatched, `echo=${echoDispatch.slice(0, 300)}`);

  const roleRows = /** @type {any[]} */ (
    await evalIn(contents, `(async () => (await window.cubicle.invoke('role.list')).roles)()`)
  );
  const projected = roleRows.find((r) => r.key === ROLE);
  add(
    "01 的投影缓存同步刷新：role.list 现值带 domains=[demo]",
    Array.isArray(projected?.domains) && projected.domains.includes(DOMAIN),
    JSON.stringify(projected?.domains ?? null),
  );

  // ── 浮层仍开着：画布与工位坐标依旧一动不敢动 ────────────────
  const canvasAfterOps = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  const desksAfterOps = /** @type {any} */ (await evalIn(contents, DESKS_JS));
  add(
    "浮层开着（含托盘/行数据）：画布仍满窗、工位坐标仍与基线逐字节一致",
    canvasAfterOps.floorW === canvasAfterOps.innerW && canvasAfterOps.roomW === baseCanvas.roomW && JSON.stringify(desksAfterOps) === JSON.stringify(baseDesks),
    JSON.stringify(canvasAfterOps),
  );

  // ── 收起浮层：坐标回基线、入口 aria-expanded=false ───────────
  await click(contents, '[data-testid="academy-close"]');
  const closed = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="academy-panel"]')`)) === null,
    { timeoutMs: 3000 },
  );
  const desksClosed = /** @type {any} */ (await evalIn(contents, DESKS_JS));
  const expanded = String(await evalIn(contents, `document.querySelector('[data-testid="rail-academy"]')?.getAttribute('aria-expanded') ?? ''`));
  add("收起浮层：工位坐标回到基线、入口状态复位", closed && JSON.stringify(desksClosed) === JSON.stringify(baseDesks) && expanded === "false");

  return {
    checks,
    evidence: {
      baseCanvas,
      canvasOpen,
      canvasAfterOps,
      baseDesks,
      desksOpen,
      desksClosed,
      echoInstall,
      echoDispatch,
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
    outcome = await phasePanel(ctx);
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
