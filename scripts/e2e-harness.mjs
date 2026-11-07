/**
 * Shared acceptance-harness helpers — the skeleton e2e runners and
 * orchestrators kept duplicating across tickets 02/03. Both runners are
 * trunk artifacts, so the shape gets extracted, not copy-pasted a third time.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** @param {string} line */
export function out(line) {
  process.stdout.write(line + "\n");
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll an async predicate until it is true or the budget runs out.
 *
 * @param {() => Promise<boolean>} predicate
 * @param {{ timeoutMs: number, intervalMs?: number }} options
 * @returns {Promise<boolean>}
 */
export async function waitFor(predicate, { timeoutMs, intervalMs = 100 }) {
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
export const evalIn = (contents, code) => contents.executeJavaScript(code, true);

/**
 * @param {import("electron").WebContents} contents
 * @param {string} selector
 */
export const click = (contents, selector) =>
  evalIn(contents, `document.querySelector(${JSON.stringify(selector)})?.click() ?? null`);

/**
 * Type into a controlled React input or textarea.
 *
 * @param {import("electron").WebContents} contents
 * @param {string} selector
 * @param {string} value
 */
export async function typeInto(contents, selector, value) {
  await evalIn(
    contents,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const proto = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
}

/**
 * Drive a controlled React <select> to a value.
 *
 * @param {import("electron").WebContents} contents
 * @param {string} selector
 * @param {string} value
 */
export async function setSelect(contents, selector, value) {
  await evalIn(
    contents,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
}

/** @param {string} file */
export async function readJson(file) {
  try {
    return /** @type {Record<string, any> | null} */ (JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * @param {string} label
 * @param {{ checks?: { name: string, ok: boolean, detail?: string }[] } | null} result
 * @returns {boolean}
 */
export function printChecks(label, result) {
  if (!result) {
    console.log(`${label}: NO RESULT FILE`);
    return false;
  }
  let allOk = true;
  for (const check of result.checks ?? []) {
    allOk &&= Boolean(check.ok);
    console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  return allOk;
}

/**
 * Engine-owned config folders under the user's home. Tickets must not touch
 * any of them (acceptance: 本机 ~/.pi 无新增文件). The home root itself is
 * fingerprinted too, so an add/remove at the top level shows up.
 */
export const HOME_ENGINE_DIRS = [".pi", ".codex", ".claude", ".qoder", ".agents"];

/**
 * Snapshot the user's home: root entry count + mtime, and per engine dir the
 * file count + newest mtime (bounded walk). Engine runs must leave all of it
 * equal.
 *
 * @returns {Promise<Record<string, { exists: boolean, files: number, newestMtimeMs: number }>>}
 */
export async function fingerprintHome() {
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
export function homeDirUntouched(before, after) {
  return before.exists === after.exists && before.files === after.files && before.newestMtimeMs === after.newestMtimeMs;
}

const DESK_COUNT_JS = `document.querySelectorAll('[data-testid="desk"]').length`;
const BADGE_ONLINE_JS = `document.querySelector('[data-testid="host-status"]')?.dataset.online`;
const HIRE_STEP_JS = `document.querySelector('[data-testid="hire-step"]')?.dataset.step`;

/**
 * Boot-level invariants every ticket's runner starts from: the host is
 * online, the office shows its desks, and the view says so.
 *
 * @param {{ supervisor: { state: string, pid: number | null }, getMainWindow: () => any, bootStartMs: number }} ctx
 * @param {(name: string, ok: unknown, detail?: string) => void} add
 * @returns {Promise<{ win: any | null, checks: { name: string, ok: boolean, detail?: string }[] }>}
 */
export async function bootAndShowOffice(ctx, add) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
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
    { timeoutMs: 15_000 },
  );
  add("办公室显示 4 个工位（来自数据库）", desksShown, `${Date.now() - ctx.bootStartMs}ms after boot`);

  const onlineBadge = await waitFor(async () => (await evalIn(win.webContents, BADGE_ONLINE_JS)) === "true", {
    timeoutMs: 4000,
  });
  add("界面显示 AgentHost 在线", onlineBadge);

  return { win, checks };
}

/**
 * Drive the hire wizard through the real UI code path (DOM clicks and input
 * events against the live React tree — not bridge shortcuts).
 *
 * @param {import("electron").WebContents} contents
 * @param {{ roleKey: string, employeeName: string, backFrom2: boolean, backFrom3: boolean, manifestNeedles?: string[] }} options
 * @returns {Promise<{ opened: boolean, roleCount: number, manifestOk: boolean, wentBack2: boolean, wentBack3: boolean, confirmed: boolean }>}
 */
export async function hireThroughWizard(contents, { roleKey, employeeName, backFrom2, backFrom3, manifestNeedles = [] }) {
  const outcome = {
    opened: false,
    roleCount: 0,
    manifestOk: manifestNeedles.length === 0,
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

  await click(contents, `[data-testid="role-option"][data-role-key="${roleKey}"]`);
  await click(contents, '[data-testid="hire-next"]');
  const onStep2 = await waitFor(async () => (await evalIn(contents, HIRE_STEP_JS)) === "2", { timeoutMs: 2000 });
  if (!onStep2) return outcome;

  if (manifestNeedles.length > 0) {
    const manifestText = String(
      await evalIn(contents, `document.querySelector('[data-testid="capability-list"]')?.innerText ?? ''`),
    );
    outcome.manifestOk = manifestNeedles.every((needle) => manifestText.includes(needle));
  }

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
