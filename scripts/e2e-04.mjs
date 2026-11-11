/**
 * Ticket 04 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:04
 *
 * A deterministic local mock model endpoint (scripts/e2e-04-mock-server.mjs,
 * the M0-proven trick) plays the model side; the app under test is pointed at
 * it through a BYOK models.json written into its own data dir — never the
 * user's home.
 *
 * Phase "talk": boots, hires, talks twice (same session), aborts a slow run,
 * checks home-directory fingerprints and child-process residue (runner).
 * Phase "resume": fresh process on the same data dir; a new sentence keeps
 * writing the SAME session file.
 * Orchestrator-level: the mock endpoint sees bigger prompts in phase 2 than
 * phase 1 — the resumed request carried the earlier transcript with it.
 *
 * Raw evidence: tmp/e2e-04/{talk,resume}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer } from "./e2e-04-mock-server.mjs";
import { seedModelLibrary } from "./e2e-models.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-04");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/**
 * Children of one pid, via PowerShell CIM (tasklist.exe is unusable on this
 * machine: it exits 1 with no output even when the filter matches). Wrapping
 * the CIM result in an array makes the empty case a real 0 instead of null.
 *
 * @param {number} parentPid
 * @returns {Promise<number>} -1 when the query itself failed
 */
function childProcessCount(parentPid) {
  return new Promise((resolve) => {
    const { execFile } = require("node:child_process");
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `( @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}").Count )`,
      ],
      { windowsHide: true },
      (/** @type {Error | null} */ err, /** @type {string} */ stdout) => {
        if (err) return resolve(-1);
        const count = Number(stdout.trim());
        resolve(Number.isInteger(count) ? count : -1);
      },
    );
  });
}

/**
 * Samples the AgentHost's child-process count every 300ms while a phase
 * runs, as soon as the runner publishes the host pid. The acceptance promise
 * (结束后无残留子进程) is proven strictly: NEVER a child, not just at the end.
 *
 * @returns {{ finish: () => { sawPid: number | null, max: number, samples: number[] } }}
 */
function watchHostChildren() {
  let done = false;
  let sawPid = /** @type {number | null} */ (null);
  let max = -Infinity;
  /** @type {number[]} */
  const samples = [];
  const timer = setInterval(() => {
    if (done) return;
    void readFile(path.join(outDir, "hostpid.txt"), "utf8")
      .then(async (text) => {
        const pid = Number(text.trim());
        if (!Number.isInteger(pid) || pid <= 0) return;
        sawPid = pid;
        const count = await childProcessCount(pid);
        if (count >= 0) {
          samples.push(count);
          max = Math.max(max, count);
        }
      })
      .catch(() => {
        // pid not published yet
      });
  }, 300);
  return {
    finish() {
      done = true;
      clearInterval(timer);
      return { sawPid, max, samples };
    },
  };
}

/**
 * @param {{ phase: "talk" | "resume" }} options
 * @returns {Promise<{ code: number, children: { sawPid: number | null, max: number, samples: number[] } }>}
 */
async function launch(options) {
  await rm(path.join(outDir, "hostpid.txt"), { force: true });
  const watcher = watchHostChildren();
  const code = await new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-04-runner.mjs");
    env.CUBICLE_E2E_OUT_DIR = outDir;
    // Keep the app under test (userData + Chromium cache + SQLite + engine
    // dirs) inside the workspace so the run is hermetic and re-runnable.
    env.CUBICLE_DATA_DIR = dataDir;
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
  return { code, children: watcher.finish() };
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// BYOK engine config, pointed at the local mock — exactly what the engine
// center would later write into the app's private directory.
const mock = await startMockModelServer();
await mkdir(path.join(dataDir, "engines", "pi"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "pi", "models.json"),
  `${JSON.stringify(
    {
      $schema: "https://pi.dev/schemas/models.schema.json",
      providers: {
        cubicle: {
          name: "Cubicle E2E",
          baseUrl: mock.baseUrl,
          api: "openai-completions",
          apiKey: "e2e-local-key",
          models: [
            {
              type: "chat",
              id: "cubicle-e2e-model",
              name: "E2E Model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await seedModelLibrary(dataDir, { baseUrl: mock.baseUrl, protocol: "openai-completions" });

const started = Date.now();

console.log("ticket 04 e2e · phase talk (说一句话，引擎开跑 · 事件面板 · 中止)");
const talk = await launch({ phase: "talk" });
const talkOk = talk.code === 0 && printChecks("talk", await readJson(path.join(outDir, "talk.json")));
const talkRequests = mock.requests.slice();

// 中止后无残留子进程 — proven strictly: the host never had a single child
// process across the whole phase (samples taken every 300ms).
const childrenOk = talk.children.sawPid !== null && talk.children.max === 0;
console.log(
  `  ${childrenOk ? "ok  " : "FAIL"}  AgentHost 全程零子进程（中止结束后无残留）— pid=${talk.children.sawPid} samples=${talk.children.samples.length} max=${talk.children.max}`,
);

console.log("ticket 04 e2e · phase resume (重启后续同一会话)");
const resume = await launch({ phase: "resume" });
const resumeOk = resume.code === 0 && printChecks("resume", await readJson(path.join(outDir, "resume.json")));
const resumeRequests = mock.requests.slice(talkRequests.length);

// Orchestrator-level continuity proof: the model endpoint itself saw the
// context grow — resume-phase prompts carry the earlier transcript.
const talkMax = Math.max(...talkRequests.map((request) => request.messageCount));
const resumeFirst = resumeRequests[0]?.messageCount ?? 0;
const continuityOk = resumeRequests.length > 0 && resumeFirst > talkMax;
console.log(
  `  ${continuityOk ? "ok  " : "FAIL"}  模型端可见上下文跨重启延续（talk 最大 ${talkMax} 条消息 → resume 首个 ${resumeFirst} 条）`,
);
const slowOk = talkRequests.some((request) => request.slow);
console.log(`  ${slowOk ? "ok  " : "FAIL"}  talk 阶段确实发生过一次被中止的慢响应（slow=${talkRequests.filter((r) => r.slow).length}）`);

await writeFile(
  path.join(outDir, "model-requests.json"),
  `${JSON.stringify({ talk: talkRequests, resume: resumeRequests }, null, 2)}\n`,
  "utf8",
);
await mock.close();

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (talkOk && resumeOk && continuityOk && slowOk && childrenOk) {
  console.log(`\nPASS · ticket 04 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-04/{talk,resume,model-requests}.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
