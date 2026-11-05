/**
 * M0 spike orchestrator. One command runs all three fatal-assumption checks:
 *
 *   npm run spike
 *
 * Checks:
 *   1. Electron's embedded Node is >= 22.19.0 (pi's hard requirement)
 *   2. pi's SDK starts a session in a utilityProcess and streams text + tools
 *   3. `codex exec --json` output normalizes into the same event stream
 *
 * Exit code 0 means all checks passed. Raw logs stay under `tmp/spike/`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { createCodexNormalizer } from "./lib/codex.mjs";
import { isNodeVersionSupported } from "./lib/versions.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// Under plain Node the electron package resolves to the binary path; its
// type declarations describe the runtime API instead.
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const mainPath = path.join(root, "spike", "electron-main.cjs");
const runRoot = path.join(root, "tmp", "spike");

const argv = process.argv.slice(2);
const selectionArg = argv.find((arg) => arg.startsWith("--only="));
const selection = selectionArg ? selectionArg.slice("--only=".length) : "all";
const skipCodex = argv.includes("--skip-codex");

/** @typedef {{ status: "pass" | "fail" | "skip", title: string, detail: string[] }} CheckResult */
/** @typedef {import("./lib/events.mjs").NormalizedEvent} NormalizedEvent */

/** @type {CheckResult[]} */
const results = [];

/**
 * @param {CheckResult["status"]} status
 * @param {string} title
 * @param {string[]} detail
 */
function report(status, title, detail) {
  results.push({ status, title, detail });
  console.log(`${status.toUpperCase().padEnd(4)}  ${title}`);
  for (const line of detail) console.log(`      ${line}`);
}

/**
 * @param {string} title
 * @param {string[]} detail
 */
function pass(title, detail) {
  report("pass", title, detail);
}

/**
 * @param {string} title
 * @param {string[]} detail
 */
function fail(title, detail) {
  report("fail", title, detail);
}

/**
 * @param {string} title
 * @param {string[]} detail
 */
function skip(title, detail) {
  report("skip", title, detail);
}

/**
 * @param {NodeJS.ProcessEnv} extra
 * @returns {NodeJS.ProcessEnv}
 */
function electronEnv(extra) {
  const env = { ...process.env, ...extra };
  // Electron's npm launcher sets this in some environments; it makes
  // electron.exe behave as plain Node and `require("electron")` return a path.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} options
 */
async function runProcess(command, args, options = {}) {
  const { cwd = root, env = process.env, timeoutMs = 120_000 } = options;
  return await new Promise((resolve) => {
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({
        code: null,
        timedOut: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        timedOut,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: `${Buffer.concat(err).toString("utf8")}${error.message}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        timedOut,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });

    child.stdin.end();
  });
}

/**
 * @param {number | undefined} pid
 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/**
 * @param {string} stdout
 * @param {string} prefix
 */
function prefixedJson(stdout, prefix) {
  /** @type {any[]} */
  const records = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue;
    try {
      records.push(JSON.parse(line.slice(prefix.length)));
    } catch {
      // diagnostic line; reported through the raw log
    }
  }
  return records;
}

/**
 * Creates the shared one-file workspace used by the pi and codex probes.
 *
 * @param {string} runDir
 * @returns {Promise<string>} fixture directory
 */
async function resetFixture(runDir) {
  const fixtureDir = path.join(runDir, "fixture");
  await rm(runDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(path.join(fixtureDir, "hello.txt"), "hello from m0 fixture\n", "utf8");
  return fixtureDir;
}

/**
 * @param {NormalizedEvent[]} events
 */
function summarize(events) {
  return {
    text: events.filter((event) => event.type === "text_delta"),
    toolStarts: events.filter((event) => event.type === "tool_execution_start"),
    toolEnds: events.filter((event) => event.type === "tool_execution_end"),
    turnEnds: events.filter((event) => event.type === "turn_end"),
    agentEnds: events.filter((event) => event.type === "agent_end"),
  };
}

/**
 * Persists a child's streams so a failed probe can be inspected afterwards.
 *
 * @param {string} dir
 * @param {{ stdout: string, stderr: string }} run
 * @returns {Promise<string>} repo-relative path of the stdout log
 */
async function writeRawLogs(dir, run) {
  await mkdir(dir, { recursive: true });
  const stdoutPath = path.join(dir, "stdout.log");
  await writeFile(stdoutPath, run.stdout, "utf8");
  await writeFile(path.join(dir, "stderr.log"), run.stderr, "utf8");
  return path.relative(root, stdoutPath);
}

async function checkElectronNode() {
  const title = "Electron embedded Node >= 22.19.0";
  if (!existsSync(electronBinary)) {
    fail(title, [`Electron binary not found at ${electronBinary}`, "run: npm install"]);
    return;
  }

  const run = await runProcess(electronBinary, [mainPath], {
    env: electronEnv({ SPIKE_MODE: "node-version" }),
    timeoutMs: 60_000,
  });
  const logPath = await writeRawLogs(path.join(runRoot, "node"), run);
  const payloads = prefixedJson(run.stdout, "SPIKE_JSON ");
  const payload = payloads.find((item) => item?.check === "electron-node");

  if (!payload) {
    fail(title, [
      `Electron exited with ${run.code}${run.timedOut ? " (timed out)" : ""}`,
      `log: ${logPath}`,
      ...tail(run.stderr, 12),
      ...tail(run.stdout, 12),
    ]);
    return;
  }

  const supported = isNodeVersionSupported(payload.node);
  const detail = [
    `Electron ${payload.electron} · Node ${payload.node} · Chrome ${payload.chrome}`,
    `${payload.platform}/${payload.arch} · V8 ${payload.v8}`,
    supported ? `Node ${payload.node} satisfies pi's >= 22.19.0 requirement` : `Node ${payload.node} is BELOW 22.19.0`,
    `log: ${logPath}`,
  ];
  if (supported) pass(title, detail);
  else fail(title, detail);
}

async function checkPiUtility() {
  const title = "pi SDK streams text + tool events inside utilityProcess";
  const runDir = path.join(runRoot, "pi");
  const fixtureDir = await resetFixture(runDir);

  const run = await runProcess(electronBinary, [mainPath], {
    env: electronEnv({
      SPIKE_MODE: "pi-utility",
      SPIKE_RUN_DIR: runDir,
      SPIKE_FIXTURE_DIR: fixtureDir,
    }),
    timeoutMs: 120_000,
  });
  const logPath = await writeRawLogs(runDir, run);

  const payloads = prefixedJson(run.stdout, "SPIKE_JSON ");
  const payload = payloads.find((item) => item?.check === "pi-utility" && item.ok !== undefined);
  const { text, toolStarts, toolEnds, agentEnds } = summarize(prefixedJson(run.stdout, "SPIKE_EVENT "));

  if (!payload || !payload.ok) {
    fail(title, [
      `utility probe exited with ${run.code}${run.timedOut ? " (timed out)" : ""}`,
      `log: ${logPath}`,
      ...(payload?.result?.error ? String(payload.result.error).split(/\r?\n/).slice(0, 8) : []),
      ...tail(run.stderr, 12),
    ]);
    return;
  }

  const toolSucceeded = toolEnds.some((event) => !event.isError);
  const ok = text.length > 0 && toolStarts.length > 0 && toolSucceeded && agentEnds.length === 1;
  const detail = [
    `Node ${payload.result?.node ?? "(unknown)"} · pi ${payload.result?.piVersion ?? "?"}`,
    `events: ${text.length} text · ${toolStarts.length} tool start · ${toolEnds.length} tool end · ${agentEnds.length} agent end`,
    `text: ${JSON.stringify(payload.result.text)}`,
    `tool: ${toolStarts[0]?.toolName ?? "?"}(${JSON.stringify(toolStarts[0]?.args ?? {})})`,
    `model requests: ${payload.requests?.length ?? 0} (deterministic local mock, no credentials)`,
    `log: ${logPath}`,
  ];
  if (ok) pass(title, detail);
  else fail(title, [...detail, `expected a successful tool call, text deltas and exactly one agent_end`]);
}

async function checkCodex() {
  const title = "codex exec JSONL normalizes to text + tool + end";
  if (skipCodex) {
    skip(title, ["--skip-codex was passed; M0 is not complete without this check"]);
    return;
  }

  const codex = process.env.SPIKE_CODEX_PATH || resolveExecutable("codex");
  if (!codex) {
    fail(title, ["codex was not found on PATH", "install/login to codex, or rerun with --skip-codex"]);
    return;
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(codex)) {
    fail(title, [
      `codex resolved to a Windows shim: ${codex}`,
      "point SPIKE_CODEX_PATH at the native codex.exe (or add that directory to PATH)",
    ]);
    return;
  }

  const env = { ...process.env };
  let credentialSource = "codex login / own config (no LITELLM_API_KEY injected)";
  if (env.LITELLM_API_KEY) {
    credentialSource = "environment (LITELLM_API_KEY)";
  } else {
    const key = await readDshCredential("LITELLM_API_KEY");
    if (key) {
      env.LITELLM_API_KEY = key;
      credentialSource = "DSH credential store (~/.dsh/.credentials.yaml)";
    }
  }

  const version = await runProcess(codex, ["--version"], { timeoutMs: 20_000 });
  const runDir = path.join(runRoot, "codex");
  const fixtureDir = await resetFixture(runDir);

  const prompt =
    "Use the shell tool exactly once to run `echo m0-codex`. After the tool finishes, reply with the single word DONE.";
  const run = await runProcess(
    codex,
    ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", fixtureDir, prompt],
    { cwd: fixtureDir, env, timeoutMs: 180_000 },
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stdoutPath = path.join(runDir, `codex-${stamp}.stdout.jsonl`);
  const stderrPath = path.join(runDir, `codex-${stamp}.stderr.log`);
  /** @param {string} text @returns {string} */
  const redact = (text) => (env.LITELLM_API_KEY ? text.split(env.LITELLM_API_KEY).join("[redacted]") : text);
  await writeFile(stdoutPath, run.stdout, "utf8");
  await writeFile(stderrPath, redact(run.stderr), "utf8");

  const normalizer = createCodexNormalizer();
  for (const line of run.stdout.split(/\r?\n/)) normalizer.push(line);
  const { text, toolStarts, toolEnds, turnEnds, agentEnds } = summarize(normalizer.end());

  const toolSucceeded = toolEnds.some((event) => !event.isError);
  const detail = [
    `codex ${version.stdout.trim() || "(version unknown)"} · auth: ${credentialSource}`,
    `events: ${text.length} text · ${toolStarts.length} tool start · ${toolEnds.length} tool end · ${turnEnds.length} turn end`,
    `text: ${JSON.stringify(text.map((event) => event.text).join(""))}`,
    `tool: ${toolStarts[0]?.toolName ?? "?"}(${JSON.stringify(toolStarts[0]?.args ?? {})})`,
    `tool result: ${JSON.stringify(toolEnds[0]?.result ?? null).slice(0, 240)}`,
    `agent end: ${agentEnds.at(-1)?.status ?? "missing"} · ignored non-JSON lines: ${normalizer.ignoredLines}`,
    `log: ${path.relative(root, stdoutPath)}`,
  ];

  const ok =
    text.length > 0 &&
    toolStarts.length > 0 &&
    toolSucceeded &&
    turnEnds.some((event) => event.status === "ok") &&
    agentEnds.at(-1)?.status === "ok";

  if (ok) {
    pass(title, detail);
    return;
  }

  const diagnostic = run.stderr.trim() ? tail(run.stderr, 12) : [];
  const hint =
    !env.LITELLM_API_KEY && /LITELLM_API_KEY|Missing environment variable/i.test(run.stderr)
      ? ["export LITELLM_API_KEY (or log in with `codex login`), then rerun"]
      : [];
  fail(title, [
    ...detail,
    `codex exited with ${run.code}${run.timedOut ? " (timed out)" : ""}`,
    ...(toolEnds.length > 0 && !toolSucceeded ? ["the tool call was observed but its execution failed"] : []),
    ...hint,
    ...diagnostic.map(redact),
  ]);
}

/**
 * @param {string} name
 * @returns {string | undefined}
 */
function resolveExecutable(name) {
  const extensions =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").map((ext) => ext.toLowerCase())]
      : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      for (const candidateName of [`${name}${ext}`, `${name}${ext.toUpperCase()}`]) {
        const candidate = path.join(dir, candidateName);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Reads a credential from the local DeepSeek Harness vault. Only used by the
 * M0 probe on this developer machine; the shipped app must not depend on it.
 *
 * @param {string} name
 * @returns {Promise<string | undefined>}
 */
async function readDshCredential(name) {
  const file = path.join(homedir(), ".dsh", ".credentials.yaml");
  if (!existsSync(file)) return undefined;
  try {
    const doc = parseYaml(await readFile(file, "utf8"));
    const value = doc?.refs?.[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} text
 * @param {number} count
 */
function tail(text, count) {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-count);
}

/** @type {Record<string, () => Promise<void>>} */
const CHECKS = {
  node: checkElectronNode,
  pi: checkPiUtility,
  codex: checkCodex,
};

if (selection !== "all" && !(selection in CHECKS)) {
  console.error(`unknown --only value: ${selection} (expected ${Object.keys(CHECKS).join(" | ")} | all)`);
  process.exit(2);
}

async function main() {
  await mkdir(runRoot, { recursive: true });
  console.log(`Cubicle M0 spike · ${new Date().toISOString()}`);
  console.log(`repo: ${root}\n`);

  const started = Date.now();
  const selected = selection === "all" ? Object.values(CHECKS) : [CHECKS[selection]];
  for (const check of selected) await check();

  const failed = results.filter((result) => result.status !== "pass");
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed in ${elapsed}s` +
      (failed.length > 0 ? ` — ${failed.map((result) => result.status.toUpperCase()).join(", ")}` : ""),
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
