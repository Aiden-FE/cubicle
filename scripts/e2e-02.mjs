/**
 * Ticket 02 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:02
 *
 * Phase "defaults": boots main with no CUBICLE_DATA_DIR and proves the
 * production data-home resolution (%APPDATA%\cubicle) — then quits before
 * touching the filesystem (this agent session's machine policy refuses new
 * AppData writes from Electron; real desktop runs do the writing).
 * Phase "create": boots the app, proves the office (4 DB-backed desks) shows
 * within 5s, the AgentHost badge is online, data lives under userData, then
 * creates a company + project group through the left-rail form, proves the
 * canvas follows the database, and reloads the view (host untouched).
 * Phase "verify": boots the app a second time and proves the created company
 * and group are still there (restart persistence).
 *
 * Raw evidence: tmp/e2e-02/{defaults,create,verify}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-02");
const mainPath = path.join(root, "src", "main", "index.mjs");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/**
 * @param {{ phase?: "create" | "verify", probeFile?: string }} options
 * @returns {Promise<number>} electron exit code
 */
function launch(options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const args = [];
    if (options.phase) {
      env.CUBICLE_E2E_PHASE = options.phase;
      // Keep the app under test (userData + Chromium cache + SQLite) inside
      // the workspace so the run is hermetic and re-runnable.
      env.CUBICLE_DATA_DIR = path.join(outDir, "data");
      args.push("--cubicle-e2e");
    }
    if (options.probeFile) {
      // No CUBICLE_DATA_DIR: exercise the production userData resolution.
      delete env.CUBICLE_DATA_DIR;
      env.CUBICLE_PROBE_USERDATA = options.probeFile;
    }
    // Dev-harness only: in agent/service sessions the Chromium process
    // sandbox cannot come up (crashes with a breakpoint before JS runs).
    // The app code itself still requests sandbox:true webPreferences.
    const extraFlags = process.env.CUBICLE_E2E_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
    const child = spawn(electronBinary, [...extraFlags, mainPath, ...args], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** @param {string} file */
async function readJson(file) {
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
function printChecks(label, result) {
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

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const started = Date.now();

console.log("ticket 02 e2e · phase defaults (production data-dir resolution)");
const defaultsCode = await launch({ probeFile: path.join(outDir, "defaults.json") });
const defaults = await readJson(path.join(outDir, "defaults.json"));
const expectedDefault = path.join(os.homedir(), "AppData", "Roaming", "cubicle");
const defaultsOk = defaultsCode === 0 && defaults?.userData === expectedDefault;
console.log(`  ${defaultsOk ? "ok  " : "FAIL"}  默认数据目录解析 → ${defaults?.userData ?? "(无)"}`);

console.log("ticket 02 e2e · phase create (form-driven, DB→canvas, reload)");
const createCode = await launch({ phase: "create" });
const createOk = createCode === 0 && printChecks("create", await readJson(path.join(outDir, "create.json")));

console.log("ticket 02 e2e · phase verify (fresh process, same data dir)");
const verifyCode = await launch({ phase: "verify" });
const verifyOk = verifyCode === 0 && printChecks("verify", await readJson(path.join(outDir, "verify.json")));

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (defaultsOk && createOk && verifyOk) {
  console.log(`\nPASS · ticket 02 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-02/{defaults,create,verify}.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
