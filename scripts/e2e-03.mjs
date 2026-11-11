/**
 * Ticket 03 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:03
 *
 * Phase "hire": boots the app, hires two employees of the SAME preset role
 * onto two different desks through the three-step wizard (forward + back),
 * proves the capability manifest shows persona/skills/tools/engine/cost, the
 * desks flip from empty to occupied, nothing under the home-directory engine
 * config folders changes, and a renderer reload keeps the office intact.
 * Phase "verify": boots a fresh process against the same data dir and proves
 * both employees — with byte-identical role snapshots — survived the restart.
 *
 * Raw evidence: tmp/e2e-03/{hire,verify}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { seedModelLibrary } from "./e2e-models.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-03");
const mainPath = path.join(root, "src", "main", "index.mjs");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/**
 * @param {{ phase: "hire" | "verify" }} options
 * @returns {Promise<number>} electron exit code
 */
function launch(options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-03-runner.mjs");
    env.CUBICLE_E2E_OUT_DIR = outDir;
    // Keep the app under test (userData + Chromium cache + SQLite) inside
    // the workspace so the run is hermetic and re-runnable.
    env.CUBICLE_DATA_DIR = path.join(outDir, "data");
    // Dev-harness only: in agent/service sessions the Chromium process
    // sandbox cannot come up (crashes with a breakpoint before JS runs).
    const extraFlags = process.env.CUBICLE_E2E_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
    const child = spawn(electronBinary, [...extraFlags, mainPath, "--cubicle-e2e"], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
seedModelLibrary(path.join(outDir, "data"), {
  baseUrl: "http://127.0.0.1:9/v1",
  protocol: "openai-completions",
});

const started = Date.now();

console.log("ticket 03 e2e · phase hire (wizard, same role twice, home-dir isolation)");
const hireCode = await launch({ phase: "hire" });
const hireOk = hireCode === 0 && printChecks("hire", await readJson(path.join(outDir, "hire.json")));

console.log("ticket 03 e2e · phase verify (fresh process, same data dir)");
const verifyCode = await launch({ phase: "verify" });
const verifyOk = verifyCode === 0 && printChecks("verify", await readJson(path.join(outDir, "verify.json")));

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (hireOk && verifyOk) {
  console.log(`\nPASS · ticket 03 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-03/{hire,verify}.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
