/**
 * Ticket 11 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:11
 *
 * Three hermetic phases (no network — the codex CLI talks to a LOCAL Responses
 * mock, the pi SDK to a LOCAL chat mock):
 *   · absent : codex 未装灰徽章 + 安装引导.
 *   · engine : real codex + real pi — the admission probe four-verdict gate,
 *              switching one employee pi→codex and re-running the same task,
 *              a policy refusal through codex's own PreToolUse hook, and an
 *              aborted codex run. The orchestrator samples the AgentHost's
 *              codex child processes throughout and asserts codex really
 *              spawned but left NO residue after the run/abort.
 *   · risk   : codex installed but no BYOK key → 待配 key badge, the probe
 *              fails with a visible reason, and 带风险启用 admits it WITH the
 *              risk flag on the card and in the database.
 *
 * Evidence: tmp/e2e-11/{absent,engine,risk,runs,child-samples-<phase>}.json + hostpid.txt.
 */
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer as startPiMockServer } from "./e2e-07-mock-server.mjs";
import { startCodexResponsesMock } from "./e2e-codex-responses-mock.mjs";
import { removeProvider, writeModelLibrary } from "./e2e-models.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-11");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

const realCodex = process.env.CUBICLE_CODEX_PATH || findCodex();
if (!realCodex) {
  console.error("codex CLI not found (set CUBICLE_CODEX_PATH); ticket 11 e2e needs the real codex host");
  process.exit(1);
}

/** @returns {string | null} */
function findCodex() {
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";");
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const base of ["codex", "codex.exe", "codex.cmd"]) {
      const candidate = path.join(dir, base);
      if (existsSync(candidate)) return candidate;
      for (const ext of exts) if (existsSync(`${candidate}${ext}`)) return `${candidate}${ext}`;
    }
  }
  return null;
}

await removeTolerant(outDir);
await mkdir(outDir, { recursive: true });

// BYOK configs for both engines, aimed at the local mocks. The codex adapter
// renders CODEX_HOME/config.toml from engines/codex/models.json.
const piMock = await startPiMockServer({ chunkPauseMs: 120 });
const codexMock = await startCodexResponsesMock();
await mkdir(path.join(dataDir, "engines", "pi"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "pi", "models.json"),
  `${JSON.stringify(
    {
      $schema: "https://pi.dev/schemas/models.schema.json",
      providers: {
        cubicle: {
          name: "Cubicle E2E",
          baseUrl: piMock.baseUrl,
          api: "openai-completions",
          apiKey: "e2e-local-key",
          models: [
            { type: "chat", id: "cubicle-e2e-model", name: "E2E Model", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
          ],
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await mkdir(path.join(dataDir, "engines", "codex"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "codex", "models.json"),
  `${JSON.stringify({ baseUrl: codexMock.baseUrl, apiKey: "e2e-codex-key", model: "cubicle-e2e-model" }, null, 2)}\n`,
  "utf8",
);

writeModelLibrary(dataDir, {
  providers: {
    cubicle: {
      name: "Cubicle E2E",
      baseUrl: piMock.baseUrl,
      api: "openai-completions",
      apiKey: "e2e-local-key",
      models: [{ id: "cubicle-e2e-model", name: "E2E Model", input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
    },
    codex: {
      name: "Cubicle Codex E2E",
      baseUrl: codexMock.baseUrl,
      api: "openai-responses",
      apiKey: "e2e-codex-key",
      models: [{ id: "cubicle-e2e-model", name: "Codex E2E Model", input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
    },
  },
  defaultProvider: "cubicle",
  defaultModel: "cubicle-e2e-model",
});

/**
 * @param {{ phase: "absent" | "engine" | "risk", codexPath: string, sample?: boolean }} options
 */
async function launch(options) {
  // hostpid.txt / childwatch.json are written by the sampled phase only; they
  // are the reclamation evidence for it, so a later phase must not clear them.

  /** @type {Array<{ at: number, codex: number }>} */
  const samples = [];
  /** @type {NodeJS.Timeout | null} */
  let watcher = null;

  const code = await new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-11-runner.mjs");
    env.CUBICLE_E2E_OUT_DIR = outDir;
    env.CUBICLE_DATA_DIR = dataDir;
    env.CUBICLE_CODEX_PATH = options.codexPath;
    const extraFlags = process.env.CUBICLE_E2E_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
    const child = spawn(electronBinary, [...extraFlags, mainPath, "--cubicle-e2e"], { cwd: root, env, stdio: "inherit" });

    if (options.sample) {
      watcher = setInterval(() => {
        void readFile(path.join(outDir, "hostpid.txt"), "utf8")
          .then(async (text) => {
            const pid = Number(text.trim());
            if (!Number.isInteger(pid) || pid <= 0) return;
            const codexCount = await countCodexChildren(pid);
            samples.push({ at: Date.now(), codex: codexCount });
          })
          .catch(() => {});
      }, 250);
    }
    child.on("exit", (c) => {
      // Give the OS a beat to release handles the host's engine children held
      // on workspace dirs; the next phase cleans them up.
      setTimeout(() => resolve(c ?? 1), 250);
    });
  });

  if (watcher) clearInterval(watcher);
  // Per-phase name: a later (unsampled) phase must not overwrite the sampling
  // evidence that proves the CLI host spawned and reclaimed its children.
  await writeFile(
    path.join(outDir, `child-samples-${options.phase}.json`),
    `${JSON.stringify(samples, null, 2)}\n`,
    "utf8",
  );
  return { code, samples };
}

/** Count codex.exe processes whose parent is the AgentHost pid (PowerShell CIM; tasklist is unreliable here). */
/** @param {number} parentPid @returns {Promise<number>} */
function countCodexChildren(parentPid) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `( @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | Where-Object { $_.Name -eq 'codex.exe' }).Count )`,
      ],
      { windowsHide: true },
      (/** @type {Error | null} */ err, /** @type {string} */ stdout) => {
        if (err) return resolve(-1);
        const n = Number(String(stdout).trim());
        resolve(Number.isInteger(n) ? n : -1);
      },
    );
  });
}

/**
 * The honest record of what actually landed in the database after a phase —
 * run statuses and engine admission state, straight from SQLite.
 */
function dumpState() {
  try {
    const db = new DatabaseSync(path.join(dataDir, "cubicle.db"), { readOnly: true });
    const runs = db
      .prepare("select id, employee_id, engine, status, prompt, started_at, ended_at from run order by id")
      .all();
    const engines = db.prepare("select engine, enabled, manual_override, installed, probe_status from engine_state order by engine").all();
    const employees = db.prepare("select id, name from employee order by id").all();
    db.close();
    return { runs, engines, employees };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const started = Date.now();

/**
 * Delete, tolerantly: a just-exited host can still hold a handle on an engine
 * workspace for a moment (EBUSY), and a leftover directory never invalidates
 * the next phase — the fresh database is what makes it clean.
 *
 * @param {string} target
 */
async function removeTolerant(target) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 3) {
        console.log(`  (cleanup skipped ${path.basename(target)}: ${/** @type {any} */ (err)?.code ?? err})`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/**
 * Start the next phase from a clean office. Each phase is a self-contained
 * demo, and a desk (or an admitted engine) left over from the previous phase
 * would blur which employee / engine the evidence talks about.
 *
 * @param {{ dropCodexModels?: boolean, dropCodexHome?: boolean }} [options]
 */
async function freshOffice(options = {}) {
  await removeTolerant(path.join(dataDir, "cubicle.db"));
  await removeTolerant(path.join(dataDir, "cubicle.db-wal"));
  await removeTolerant(path.join(dataDir, "cubicle.db-shm"));
  for (const engineName of ["pi", "codex"]) {
    const engineDir = path.join(dataDir, "engines", engineName);
    for (const entry of await readdir(engineDir).catch(() => [])) {
      const isEmployeeDir = entry.startsWith("employee-");
      const staleHome = ["config.toml", "hooks", "sessions", "tmp"].includes(entry);
      if (isEmployeeDir || (engineName === "codex" && options.dropCodexHome && staleHome)) {
        await removeTolerant(path.join(engineDir, entry));
      }
    }
  }
  if (options.dropCodexModels) {
    await removeTolerant(path.join(dataDir, "engines", "codex", "models.json"));
    removeProvider(dataDir, "codex");
  }
}

// Phase 1 — 未装徽章 + 安装引导.
console.log("ticket 11 e2e · phase absent (codex 未装：灰徽章 + 安装引导)");
const absent = await launch({ phase: "absent", codexPath: path.join(outDir, "definitely-not-codex.exe") });
const absentOk = absent.code === 0 && printChecks("absent", await readJson(path.join(outDir, "absent.json")));

await freshOffice();

// Phase 2 — 探针准入 + 切引擎 + 同一任务换 codex + 卡口拒绝 + 中止进程回收.
console.log("ticket 11 e2e · phase engine (准入探针四验 · 切引擎 · 同一任务换 codex · 卡口拒绝 · 中止进程回收)");
const engine = await launch({ phase: "engine", codexPath: realCodex, sample: true });
const engineOk = engine.code === 0 && printChecks("engine", await readJson(path.join(outDir, "engine.json")));
await writeFile(path.join(outDir, "runs.json"), `${JSON.stringify(dumpState(), null, 2)}\n`, "utf8");

// Phase 3 — 探针失败（没配 key）→ 带风险手动启用 + 风险标识 + 待配 key 徽章.
await freshOffice({ dropCodexModels: true, dropCodexHome: true });
console.log("ticket 11 e2e · phase risk (探针未通过 → 带风险启用 + 风险标识；待配 key 徽章)");
const risk = await launch({ phase: "risk", codexPath: realCodex });
const riskOk = risk.code === 0 && printChecks("risk", await readJson(path.join(outDir, "risk.json")));

// Process reclamation: codex really spawned under the host, and none of it
// remained once the run/abort settled (the runner holds a quiet window).
const watch = await readJson(path.join(outDir, "childwatch.json"));
const valid = engine.samples.filter((s) => s.codex >= 0);
const spawnPeak = Math.max(0, ...valid.map((s) => s.codex));
const during = valid.filter((s) => watch && s.at >= watch.startedAt && s.at <= (watch.idleStartAt ?? s.at));
const idleSamples = valid.filter((s) => watch && s.at >= (watch.idleStartAt ?? Infinity) && s.at <= (watch.idleEndAt ?? Infinity));
const spawnedOk = during.some((s) => s.codex >= 1) || spawnPeak >= 1;
const noResidueOk = idleSamples.length > 0 && idleSamples.every((s) => s.codex === 0);
console.log(
  `  ${spawnedOk ? "ok  " : "FAIL"}  codex 作为宿主子进程真实跑起过（samples=${valid.length} peak=${spawnPeak}）`,
);
console.log(
  `  ${noResidueOk ? "ok  " : "FAIL"}  中止/结束后无残留 codex 子进程（idle samples=${idleSamples.length} max=${Math.max(0, ...idleSamples.map((s) => s.codex))}）`,
);

const ok = absentOk && engineOk && riskOk && spawnedOk && noResidueOk;
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (ok) {
  console.log(`\nPASS · ticket 11 acceptance (${seconds}s total)`);
  await piMock.close();
  await codexMock.close();
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-11/{absent,engine,risk,runs,child-samples-<phase>}.json (${seconds}s total)`);
  await piMock.close();
  await codexMock.close();
  process.exit(1);
}
