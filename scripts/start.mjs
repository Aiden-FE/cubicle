/**
 * Launch Cubicle. `npm start` after `npm run build:renderer`.
 *
 * Spawns the Electron binary directly with ELECTRON_RUN_AS_NODE removed —
 * without that, some shells degrade electron.exe into plain Node (M0 lesson).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// CUBICLE_ELECTRON_ARGS passes extra Chromium flags (e.g. "--no-sandbox") for
// sessions where the Chromium process sandbox cannot start.
const extraArgs = (process.env.CUBICLE_ELECTRON_ARGS ?? "").split(" ").filter(Boolean);

const child = spawn(electronBinary, [...extraArgs, path.join(root, "src", "main", "index.mjs")], {
  cwd: root,
  env,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
