/**
 * Launch Cubicle. `npm start` after `npm run build:renderer`.
 *
 * Spawns the Electron binary directly with ELECTRON_RUN_AS_NODE removed —
 * without that, some shells degrade electron.exe into plain Node (M0 lesson).
 *
 * This machine's security stack refuses to start Electron's Chromium process
 * sandbox (exit 0x80000003 breakpoint before any JS runs; see AGENTS.md
 * 「M1 骨架环境坑」). A dev launch that dies with that signature is retried
 * once with --no-sandbox, loudly. CUBICLE_ELECTRON_ARGS passes extra flags
 * explicitly (then no auto-retry happens). The decision itself lives in
 * scripts/sandbox-degrade.mjs — the packaged launcher mirrors it (ticket 13).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decideLaunchOutcome } from "./sandbox-degrade.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// On this machine the security policy lets electron.exe write only inside the
// repo workspace, so a plain launch would strand the AgentHost outside it.
// Default the data dir into the repo (git-ignored); set CUBICLE_DATA_DIR to
// a real path (e.g. %APPDATA%\cubicle) to override.
if (!env.CUBICLE_DATA_DIR) {
  env.CUBICLE_DATA_DIR = path.join(root, "tmp", "dev-data");
  console.log(`data dir: ${env.CUBICLE_DATA_DIR} (set CUBICLE_DATA_DIR to override)`);
}

const extraArgs = (process.env.CUBICLE_ELECTRON_ARGS ?? "").split(" ").filter(Boolean);
const mainArgs = [path.join(root, "src", "main", "index.mjs")];

/**
 * @param {string[]} args
 * @returns {Promise<number>} exit code (never rejects)
 */
function launch(args) {
  return new Promise((resolve) => {
    const child = spawn(electronBinary, [...args, ...mainArgs], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`failed to start ${electronBinary}: ${err.message}`);
      resolve(-1);
    });
    child.on("exit", (code, signal) => resolve(signal ? -1 : (code ?? -1)));
  });
}

// Breakpoint before JS runs: the Chromium process sandbox cannot come up
// under this machine's policy. Decision seam: sandbox-degrade.mjs (unit-tested;
// the packaged Start-Cubicle.ps1 mirrors the same rule — e2e-13 proves it).
let code = await launch(extraArgs);

if (decideLaunchOutcome({ code, attempt: 0, extraArgs }) === "retry-no-sandbox") {
  console.warn(
    [
      "",
      `electron exited with ${code} (0x${(code >>> 0).toString(16)}) before the app started:`,
      "this machine's policy blocks the Chromium process sandbox.",
      "retrying once with --no-sandbox (dev launch; the app itself still runs",
      "its renderer with contextIsolation + sandbox:true webPreferences)...",
      "",
    ].join("\n"),
  );
  code = await launch(["--no-sandbox"]);
}

if (code !== 0) {
  console.error(`cubicle exited with code ${code}`);
  console.error("hints: CUBICLE_ELECTRON_ARGS adds flags; CUBICLE_DATA_DIR redirects the data dir");
}
process.exit(code === 0 ? 0 : 1);
