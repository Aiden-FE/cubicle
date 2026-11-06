/**
 * Ticket 02 acceptance runner — driven from the Electron main process but
 * deliberately parked under scripts/: the main layer stays window/updates/
 * preferences only.
 *
 * Phase "create"  (see also scripts/e2e-02.mjs orchestrator):
 *   boot → office with 4 DB desks ≤5s → host badge online → data-dir evidence
 *   → create company AND project group through the actual left-rail form
 *   → assert the canvas switches to the new group's desks (DB change → view)
 *   → reload the view; host pid unchanged, badge online again.
 * Phase "verify": fresh process proves the created company/group survived.
 *
 * Progress goes to process.stdout.write (Electron console output never reaches
 * a parent pipe); machine-readable evidence lands in <outDir>/<phase>.json.
 */
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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

/** @param {string} line */
function out(line) {
  process.stdout.write(line + "\n");
}

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
 * Open a dropdown switcher panel, type into a controlled React input and
 * submit through its button, so the acceptance run exercises the real UI
 * path, not just the bridge.
 *
 * @param {import("electron").WebContents} contents
 * @param {string} triggerSelector
 * @param {string} inputSelector
 * @param {string} value
 * @param {string} buttonSelector
 */
async function fillForm(contents, triggerSelector, inputSelector, value, buttonSelector) {
  await evalIn(contents, `document.querySelector(${JSON.stringify(triggerSelector)})?.click()`);
  await sleep(150);
  await evalIn(
    contents,
    `(() => {
      const input = document.querySelector(${JSON.stringify(inputSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
  await evalIn(contents, `document.querySelector(${JSON.stringify(buttonSelector)}).click()`);
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ win: import("electron").BrowserWindow | null, checks: { name: string, ok: boolean, detail?: string }[] }>}
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
  add("办公室画面显示 4 个工位（来自数据库）", desksShown, `${Date.now() - ctx.bootStartMs}ms after boot`);

  const onlineBadge = await waitFor(async () => (await evalIn(win.webContents, BADGE_ONLINE_JS)) === "true", {
    timeoutMs: 4000,
  });
  add("界面显示 AgentHost 在线", onlineBadge);

  return { win, checks };
}

const DESK_COUNT_JS = `document.querySelectorAll('[data-testid="desk"]').length`;
const BADGE_ONLINE_JS = `document.querySelector('[data-testid="host-status"]')?.dataset.online`;
const GROUP_NAME_JS = `document.querySelector('[data-testid="group-name"]')?.textContent`;

/**
 * @param {E2EContext} ctx
 */
async function phaseCreate(ctx) {
  const { win, checks } = await bootAndShowOffice(ctx);
  if (!win) return { checks };
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const snapshot = /** @type {any} */ (
    await evalIn(win.webContents, `window.cubicle.invoke('office.get')`)
  );
  const userData = ctx.app.getPath("userData");
  add(
    "数据目录 = 当前 userData（生产默认 %APPDATA%\\cubicle）",
    snapshot?.host?.dataDir === userData && snapshot?.host?.dbPath === path.join(userData, "cubicle.db"),
    snapshot?.host?.dataDir,
  );
  add(
    "数据库与 artifacts/engines/renders 目录已就位",
    existsSync(snapshot?.host?.dbPath ?? "") &&
      ["artifacts", "engines", "renders"].every((folder) => existsSync(path.join(userData, folder))),
  );

  const companyExists = (snapshot?.companies ?? []).some(
    (/** @type {{ name: string }} */ c) => c.name === E2E_COMPANY,
  );
  const groupExists = (snapshot?.groups ?? []).some(
    (/** @type {{ name: string }} */ g) => g.name === E2E_GROUP,
  );

  // Create through the actual dropdown switcher — the same path a human clicks.
  if (!companyExists) {
    await fillForm(
      win.webContents,
      '[data-testid="company-switcher"]',
      '[data-testid="company-name-input"]',
      E2E_COMPANY,
      '[data-testid="company-create"]',
    );
  }
  const companyShown = await waitFor(async () => {
    const fresh = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('office.get')`));
    return (fresh?.companies ?? []).some((/** @type {{ name: string }} */ c) => c.name === E2E_COMPANY);
  }, { timeoutMs: 4000 });
  add("通过表单创建公司成功", companyShown || companyExists);

  if (!groupExists) {
    await fillForm(
      win.webContents,
      '[data-testid="group-switcher"]',
      '[data-testid="group-name-input"]',
      E2E_GROUP,
      '[data-testid="group-create"]',
    );
  }
  // The canvas must follow the database: the new group's four desks appear.
  const canvasFollowsDb = await waitFor(async () => {
    const caption = await evalIn(win.webContents, GROUP_NAME_JS);
    const desks = await evalIn(win.webContents, DESK_COUNT_JS);
    return caption === E2E_GROUP && desks === 4;
  }, { timeoutMs: 4000 });
  add("画布切到新项目组的 4 个工位（数据库变更直达视图）", canvasFollowsDb);

  const listsShowBoth = await waitFor(async () => {
    await evalIn(win.webContents, `document.querySelector('[data-testid="company-switcher"]')?.click()`);
    await evalIn(win.webContents, `document.querySelector('[data-testid="group-switcher"]')?.click()`);
    const companyText =
      (await evalIn(win.webContents, `document.querySelector('[data-testid="company-panel"]')?.innerText ?? ''`)) +
      (await evalIn(win.webContents, `document.querySelector('[data-testid="company-switcher"]')?.innerText ?? ''`));
    const groupText =
      (await evalIn(win.webContents, `document.querySelector('[data-testid="group-panel"]')?.innerText ?? ''`)) +
      (await evalIn(win.webContents, `document.querySelector('[data-testid="group-switcher"]')?.innerText ?? ''`));
    return companyText.includes(E2E_COMPANY) && groupText.includes(E2E_GROUP);
  }, { timeoutMs: 4000 });
  add("切换器列表显示新建的公司与项目组", listsShowBoth);
  await evalIn(win.webContents, `document.body.click()`);

  const pidBefore = ctx.supervisor.pid;
  win.webContents.reload();
  const desksAfterReload = await waitFor(
    async () => (await evalIn(win.webContents, DESK_COUNT_JS)) === 4,
    { timeoutMs: 5000 },
  );
  // The fresh view only learns "online" when the next heartbeat lands (≤2s).
  const badgeAfterReload = await waitFor(
    async () => (await evalIn(win.webContents, BADGE_ONLINE_JS)) === "true",
    { timeoutMs: 4000 },
  );
  add(
    "重载视图后：工位照常显示、宿主仍在线且未重启（pid 不变）",
    desksAfterReload && badgeAfterReload && ctx.supervisor.pid === pidBefore,
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

  const snapshot = /** @type {any} */ (
    await evalIn(win.webContents, `window.cubicle.invoke('office.get')`)
  );
  add("重启后：公司仍在", (snapshot?.companies ?? []).some((/** @type {{ name: string }} */ c) => c.name === E2E_COMPANY));
  add("重启后：项目组仍在", (snapshot?.groups ?? []).some((/** @type {{ name: string }} */ g) => g.name === E2E_GROUP));
  add("数据目录仍指向应用数据目录", snapshot?.host?.dataDir === ctx.app.getPath("userData"));

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
    outcome = ctx.phase === "verify" ? await phaseVerify(ctx) : await phaseCreate(ctx);
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
