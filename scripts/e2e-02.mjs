/**
 * Ticket 02 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:02
 *
 * Phase "create": boots the app, proves the office (4 DB-backed desks) shows
 * within 5s, the AgentHost badge is online, data lives under the app-data
 * directory, then creates a company + project group and reloads the view.
 * Phase "verify": boots the app a second time and proves the created company
 * and group are still there (restart persistence).
 *
 * Raw evidence: tmp/e2e-02/create.json + tmp/e2e-02/verify.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-02");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/**
 * @param {string} phase
 * @returns {Promise<number>} electron exit code
 */
function runPhase(phase) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = {
      ...process.env,
      CUBICLE_E2E_PHASE: phase,
      // Keep the whole app (userData + Chromium cache + SQLite) inside the
      // workspace so the run is hermetic and re-runnable.
      CUBICLE_DATA_DIR: path.join(outDir, "data"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    // Dev-harness only: in agent/service sessions the Chromium process
    // sandbox cannot come up (crashes with a breakpoint before JS runs).
    // The app code itself still requests sandbox:true webPreferences.
    const extraFlags = process.env.CUBICLE_E2E_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
    const child = spawn(
      electronBinary,
      [...extraFlags, path.join(root, "src", "main", "index.mjs"), "--cubicle-e2e"],
      { cwd: root, env, stdio: "inherit" },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** @param {string} file */
async function readResult(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} label
 * @param {{ checks?: { name: string, ok: boolean, detail?: string }[], bootElapsedMs?: number } | null} result
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
  if (result.bootElapsedMs !== undefined) {
    console.log(`  boot→office: ${result.bootElapsedMs}ms`);
  }
  return allOk;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const started = Date.now();
console.log("ticket 02 e2e · phase create");
const createCode = await runPhase("create");
const createOk = createCode === 0 && printChecks("create", await readResult(path.join(outDir, "create.json")));

console.log("ticket 02 e2e · phase verify (fresh process, same data dir)");
const verifyCode = await runPhase("verify");
const verifyOk = verifyCode === 0 && printChecks("verify", await readResult(path.join(outDir, "verify.json")));

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (createOk && verifyOk) {
  console.log(`\nPASS · ticket 02 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · see tmp/e2e-02/*.json and the output above (${seconds}s total)`);
  process.exit(1);
}
