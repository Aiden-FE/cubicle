/**
 * Shared acceptance-harness helpers — the skeleton e2e runners and
 * orchestrators kept duplicating across tickets 02/03. Both runners are
 * trunk artifacts, so the shape gets extracted, not copy-pasted a third time.
 */
import { readFile } from "node:fs/promises";

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
 * Type into a controlled React input.
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
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
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
