/**
 * Ticket 02 acceptance runner, executed inside the Electron main process
 * (main → renderer → AgentHost, the full vertical path).
 *
 * Evidence lands in tmp/e2e-02/<phase>.json; the orchestrator
 * (scripts/e2e-02.mjs) launches one Electron per phase.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const E2E_COMPANY = "E2E 公司 02";
const E2E_GROUP = "E2E 项目组 02";

/**
 * @typedef {object} E2EContext
 * @property {import("electron").App} app
 * @property {() => import("electron").BrowserWindow | null} getMainWindow
 * @property {{ state: string, pid: number | null, send: (m: unknown) => boolean }} supervisor
 * @property {string} dataDir
 * @property {number} bootStartMs
 * @property {"create" | "verify"} phase
 * @property {string} outDir
 */

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll an async predicate until it is true or the budget runs out.
 *
 * @param {() => Promise<boolean>} predicate
 * @param {{ timeoutMs: number, intervalMs?: number }} options
 * @returns {Promise<boolean>}
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
 * @param {E2EContext} ctx
 */
async function phaseCreate(ctx) {
  /** @type {{ name: string, ok: boolean, detail: string }[]} */
  const checks = [];
  /**
   * @param {string} name
   * @param {unknown} ok
   * @param {string} [detail]
   */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  await waitFor(async () => ctx.supervisor.state === "online", { timeoutMs: 5000 });
  add("AgentHost 在 5s 内上线", ctx.supervisor.state === "online", `state=${ctx.supervisor.state}`);

  const win = ctx.getMainWindow();
  if (!win) {
    add("主窗口存在", false);
    return { checks };
  }
  add("主窗口存在", true);

  const deskCountSql = `document.querySelectorAll('[data-testid="desk"]').length`;
  const desksShown = await waitFor(async () => (await evalIn(win.webContents, deskCountSql)) === 4, {
    timeoutMs: 5000,
  });
  const bootElapsedMs = Date.now() - ctx.bootStartMs;
  add("办公室画面显示 4 个工位（来自数据库）", desksShown, `${bootElapsedMs}ms after boot`);

  const onlineBadge = await waitFor(
    async () =>
      (await evalIn(
        win.webContents,
        `document.querySelector('[data-testid="host-status"]')?.dataset.online`,
      )) === "true",
    { timeoutMs: 3000 },
  );
  add("界面显示 AgentHost 在线", onlineBadge);

  const snapshot = /** @type {any} */ (
    await evalIn(win.webContents, `window.cubicle.invoke('office.get')`)
  );
  const userData = ctx.app.getPath("userData");
  add(
    "数据落在应用数据目录（非家目录）",
    snapshot?.host?.dataDir === userData && snapshot?.host?.dbPath === path.join(userData, "cubicle.db"),
    snapshot?.host?.dataDir,
  );
  add(
    "数据库与 artifacts/engines/renders 目录已就位",
    existsSync(snapshot?.host?.dbPath ?? "") &&
      ["artifacts", "engines", "renders"].every((folder) =>
        existsSync(path.join(userData, folder)),
      ),
  );

  const knownCompany = (snapshot?.companies ?? []).find(
    (/** @type {{ name: string }} */ c) => c.name === E2E_COMPANY,
  );
  const company = knownCompany
    ? knownCompany
    : await evalIn(
        win.webContents,
        `window.cubicle.invoke('company.create', { name: ${JSON.stringify(E2E_COMPANY)} })`,
      );
  add("创建公司成功", company?.id > 0, `id=${company?.id}`);

  const knownGroup = (snapshot?.groups ?? []).find(
    (/** @type {{ name: string }} */ g) => g.name === E2E_GROUP,
  );
  const groupResult = knownGroup
    ? { group: knownGroup, desks: [] }
    : await evalIn(
        win.webContents,
        `window.cubicle.invoke('projectGroup.create', { companyId: ${snapshot.activeCompanyId}, name: ${JSON.stringify(E2E_GROUP)} })`,
      );
  add(
    "创建项目组成功且自动配 4 个工位",
    knownGroup ? true : groupResult?.group?.id > 0 && groupResult?.desks?.length === 4,
  );

  const railShowsBoth = await waitFor(
    async () => {
      const text = await evalIn(win.webContents, `document.querySelector('.rail-panel')?.innerText ?? ''`);
      return text.includes(E2E_COMPANY) && text.includes(E2E_GROUP);
    },
    { timeoutMs: 3000 },
  );
  add("浮层列表显示新建的公司与项目组", railShowsBoth);

  const pidBefore = ctx.supervisor.pid;
  win.webContents.reload();
  const desksAfterReload = await waitFor(
    async () => (await evalIn(win.webContents, deskCountSql)) === 4,
    { timeoutMs: 5000 },
  );
  // The fresh view only learns "online" when the next heartbeat lands (≤2s),
  // so poll the badge instead of reading it once.
  const badgeAfterReload = await waitFor(
    async () =>
      (await evalIn(
        win.webContents,
        `document.querySelector('[data-testid="host-status"]')?.dataset.online`,
      )) === "true",
    { timeoutMs: 4000 },
  );
  add(
    "重载视图后：工位照常显示、宿主仍在线且未重启（pid 不变）",
    desksAfterReload && badgeAfterReload && ctx.supervisor.pid === pidBefore,
    `pid ${pidBefore} → ${ctx.supervisor.pid}`,
  );

  return { checks, bootElapsedMs };
}

/**
 * @param {E2EContext} ctx
 */
async function phaseVerify(ctx) {
  /** @type {{ name: string, ok: boolean, detail: string }[]} */
  const checks = [];
  /**
   * @param {string} name
   * @param {unknown} ok
   * @param {string} [detail]
   */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  await waitFor(async () => ctx.supervisor.state === "online", { timeoutMs: 5000 });
  add("AgentHost 在 5s 内上线（新进程）", ctx.supervisor.state === "online");

  const win = ctx.getMainWindow();
  if (!win) {
    add("主窗口存在", false);
    return { checks };
  }

  const desksShown = await waitFor(
    async () =>
      (await evalIn(win.webContents, `document.querySelectorAll('[data-testid="desk"]').length`)) === 4,
    { timeoutMs: 5000 },
  );
  const bootElapsedMs = Date.now() - ctx.bootStartMs;
  add("办公室照常显示 4 个工位", desksShown, `${bootElapsedMs}ms after boot`);

  const snapshot = /** @type {any} */ (
    await evalIn(win.webContents, `window.cubicle.invoke('office.get')`)
  );
  add("重启后：公司仍在", (snapshot?.companies ?? []).some((/** @type {{ name: string }} */ c) => c.name === E2E_COMPANY));
  add("重启后：项目组仍在", (snapshot?.groups ?? []).some((/** @type {{ name: string }} */ g) => g.name === E2E_GROUP));
  add("数据目录仍指向应用数据目录", snapshot?.host?.dataDir === ctx.app.getPath("userData"));

  return { checks, bootElapsedMs };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], bootElapsedMs?: number }} */
  let outcome = { checks: [] };
  try {
    outcome = ctx.phase === "verify" ? await phaseVerify(ctx) : await phaseCreate(ctx);
  } catch (err) {
    outcome.checks.push({ name: "unexpected error", ok: false, detail: String(err) });
  }

  const allOk = outcome.checks.length > 0 && outcome.checks.every((check) => check.ok);
  for (const check of outcome.checks) {
    console.log(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  await mkdir(ctx.outDir, { recursive: true });
  await writeFile(
    path.join(ctx.outDir, `${ctx.phase}.json`),
    `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
