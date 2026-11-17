/**
 * The one door through which Cubicle talks to the vendored Neo CLI.
 *
 * Neo (vendored at `vendor/neo/bin/neo.js`, see vendor/README.md) owns every
 * assembly rule — Cubicle never recomputes the assembled set itself. The CLI
 * is a child process:
 *
 *  - tests run it with plain `node` (process.execPath of a node test runner);
 *  - the app (AgentHost, an Electron utilityProcess) runs it with
 *    process.execPath = electron.exe plus ELECTRON_RUN_AS_NODE=1 **in the
 *    child env only** — that variable must never leak into an Electron launch.
 *
 * `NEO_HOME` in the child env decides which Neo home is read; tests always
 * point it at a fixture under the temp dir, never at the user's real ~/.neo.
 */
import { spawn } from "node:child_process";

import { appError } from "../../shared/apperror.mjs";

/**
 * @typedef {object} MaterializeSkillEntry
 * @property {string} name
 * @property {string} hash      content hash (Neo's computeSkillFolderHash rule)
 * @property {string} source    winning assembly layer (role name or "default")
 *
 * @typedef {object} MaterializeManifest
 * @property {true} ok
 * @property {string} role
 * @property {string} agent
 * @property {string} outDir
 * @property {MaterializeSkillEntry[]} skills
 * @property {{ file: string | null, servers: number }} mcp
 * @property {{ file: string | null, providers: number, default: string | null }} model
 * @property {string} hash      sha256 over the normalized resource set (timestamp/outDir-free)
 */

/**
 * Run one neo CLI command to completion.
 *
 * @param {object} options
 * @param {string} options.nodeBinary executable (node in tests; electron.exe + ELECTRON_RUN_AS_NODE in the app)
 * @param {string} options.cliEntry path to the vendored bundle (vendor/neo/bin/neo.js)
 * @param {string[]} options.args command args, e.g. ["materialize", "--role", …]
 * @param {Record<string, string | undefined>} [options.env] child env — the caller decides it wholesale (PATH, NEO_HOME, ELECTRON_RUN_AS_NODE for the app child); defaults to the host env
 * @param {number} [options.timeoutMs]
 * @param {string} [options.cwd]
 * @returns {Promise<{ stdout: string }>} resolves with stdout; rejects with an appError carrying the exit code + stderr for a readable failure
 */
export function runNeoCli({ nodeBinary, cliEntry, args, env = process.env, timeoutMs = 30_000, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBinary, [cliEntry, ...args], {
      env: { ...env },
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // already gone
      }
      reject(appError("academy_cli_timeout", `neo ${args.join(" ")} 超过 ${Math.round(timeoutMs / 1000)}s 没有结束，已终止`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(appError("academy_cli_spawn_failed", `启动 vendored neo CLI 失败：${err instanceof Error ? err.message : String(err)}`));
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout });
        return;
      }
      // neo's own error text is the readable part (its exit codes map usage=2 / state=1 / failure=1).
      const reason = stderr.trim() || stdout.trim() || "（无输出）";
      reject(
        appError("academy_cli_failed", `neo ${args.join(" ")} 退出码 ${code ?? "?"}：${reason.slice(0, 600)}`),
      );
    });
  });
}

/**
 * `neo materialize --role <r> --agent <a> --out <dir> --json` — the export of
 * the role×agent launch root (resources part), computed by Neo's own render
 * path (never a second copy of the rules). Never launches a process.
 *
 * NOTE(machine-local): the --out product carries auth-credential copies
 * (convergeRoot native behaviour) — it must live inside the app's private
 * data dir and never in git.
 *
 * @param {{ nodeBinary: string, cliEntry: string, role: string, agent: string, out: string, env?: Record<string, string | undefined>, timeoutMs?: number }} input
 * @returns {Promise<import("./assembly.mjs").MaterializeManifest>}
 */
export async function runMaterialize({ nodeBinary, cliEntry, role, agent, out, env, timeoutMs }) {
  const { stdout } = await runNeoCli({
    nodeBinary,
    cliEntry,
    args: ["materialize", "--role", role, "--agent", agent, "--out", out, "--json"],
    ...(env !== undefined ? { env } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  try {
    const manifest = JSON.parse(stdout.trim());
    if (manifest?.ok !== true) throw new Error("ok !== true");
    return manifest;
  } catch {
    throw appError(
      "academy_cli_bad_output",
      `neo materialize 没有给出可读的 --json 清单：${stdout.slice(0, 300) || "（空输出）"}`,
    );
  }
}
