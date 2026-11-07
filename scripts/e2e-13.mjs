/**
 * Ticket 13 acceptance run — one command:
 *
 *   npm run build:renderer && npm run package && npm run e2e:13
 *
 * 「干净机器」在本机的近似 = 干净目录（本机安全策略只允许 electron.exe 写
 * 仓库工作区；见 AGENTS.md）：把打包产物（dist/package/win-untracked →
 * 实际目录名 win-unpacked）复制进 tmp/pkg-clean/app = 安装，
 * CUBICLE_DATA_DIR=tmp/pkg-clean/data，卸载 = 删安装目录。
 *
 * Phases (evidence under tmp/e2e-13/):
 *   install  — 复制到干净目录 + 包大小（install.json）
 *   boot     — 经随包的 Start-Cubicle.ps1 启动（现场证明打包形态的
 *              --no-sandbox 降级生效）；办公室显示；数据目录清单创建；
 *              关于页版本三方一致（launcher-boot/boot.json）
 *   second   — 单实例锁：第二个 cubicle.exe 退出码 0 且快速退出；主实例
 *              收到 second-instance 交接，窗口数恒为 1（second/second-instance.json）
 *   ledger   — 真 codex.exe 在飞时走生产退出路径（supervisor.stop →
 *              host.shutdown → CLI 账本清扫）；按 host pid 采样证明跑起过、
 *              退出后 0 残留（ledger/child-samples-ledger.json）
 *   sweep    — 每个阶段退出后按名字 + 路径（tmp/pkg-clean）断言无孤儿；
 *              卸载（删安装目录）后再断言一次（sweeps/uninstall.json）
 */
import { spawn, execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer as startPiMockServer } from "./e2e-07-mock-server.mjs";
import { startCodexResponsesMock } from "./e2e-codex-responses-mock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "tmp", "e2e-13");
const pkgSrc = path.join(root, "dist", "package", "win-unpacked");
const cleanRoot = path.join(root, "tmp", "pkg-clean");
const installDir = path.join(cleanRoot, "app");
const dataDir = path.join(cleanRoot, "data");
const cubicleExe = path.join(installDir, "cubicle.exe");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}
if (!existsSync(path.join(pkgSrc, "cubicle.exe"))) {
  console.error("package not built — run: npm run package");
  process.exit(1);
}

const expectedVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const realCodex = process.env.CUBICLE_CODEX_PATH || findCodex();

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

/**
 * @param {string} target
 */
async function removeTolerant(target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

/**
 * PowerShell CIM 计数（tasklist 本机不可靠 — AGENTS.md）。
 * @param {string} command 返回单个数字的 PS 表达式
 * @returns {Promise<number>}
 */
function psCount(command) {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(-1);
      const n = Number(String(stdout).trim());
      resolve(Number.isInteger(n) ? n : -1);
    });
  });
}

/** 名字过滤（打包形态的主/子进程都叫 cubicle.exe；dev 叫 electron.exe）+ 安装路径过滤。 */
function countPackagedProcesses() {
  const escaped = cleanRoot.replace(/'/g, "''");
  return psCount(
    `( @(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cubicle.exe' -or $_.Name -eq 'electron.exe') -and $_.ExecutablePath -like '${escaped}\\*' }).Count )`,
  );
}

/** codex 残留：命令行里引用了本次干净目录（CODEX_HOME/workspace 都在 dataDir 下）。 */
function countCodexResidue() {
  const escaped = cleanRoot.replace(/'/g, "''");
  return psCount(
    `( @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -like '*${escaped}*' }).Count )`,
  );
}

/** @param {number} parentPid @returns {Promise<number>} */
function countCodexChildren(parentPid) {
  return psCount(`( @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | Where-Object { $_.Name -eq 'codex.exe' }).Count )`);
}

/**
 * 启动安装包。viaLauncher=true 走随包的 Start-Cubicle.ps1（打包启动路径的
 * 降级逻辑现场生效）；否则直接起 cubicle.exe（dev 同款 --no-sandbox，快）。
 *
 * @param {{ viaLauncher?: boolean, phase?: string, appArgs?: string[], env?: Record<string, string> }} options
 * @returns {Promise<{ code: number, child: ReturnType<typeof spawn> }>}
 */
function launchPackaged(options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, CUBICLE_DATA_DIR: dataDir, CUBICLE_E2E_OUT_DIR: outDir };
    delete env.ELECTRON_RUN_AS_NODE; // M0 老坑：留着会把 exe 退化成纯 node
    for (const [k, v] of Object.entries(options.env ?? {})) env[k] = v;

    /** @type {string} */
    let command;
    /** @type {string[]} */
    let args;
    if (options.viaLauncher) {
      // -Command（不是 -File）：--cubicle-e2e 这种以 - 开头的 token 在
      // -File 模式会被 PowerShell 当成参数名；-Command 里用 @() 数组稳妥。
      command = "powershell.exe";
      const q = (/** @type {string} */ s) => `'${s.replace(/'/g, "''")}'`;
      const appArgs = (options.appArgs ?? []).map(q).join(", ");
      args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& ${q(path.join(installDir, "Start-Cubicle.ps1"))} -InstallDir ${q(installDir)} -AppArgs @(${appArgs})`,
      ];
    } else {
      command = cubicleExe;
      args = ["--no-sandbox", ...(options.appArgs ?? [])];
    }
    // spawn 的返回值重载在 command/args 为变量时折成 never（@types/node 怪癖）：
    // 用一个显式签名的别名起进程，类型走直线。
    const spawnApp = /** @type {(command: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} */ (spawn);
    const child = spawnApp(command, args, { cwd: installDir, env, stdio: "inherit" });
    child.on("exit", (/** @type {number | null} */ code) => resolve({ code: code ?? 1, child }));
  });
}

/** 启动第二实例（不带 --cubicle-e2e）；返回退出码与耗时。 */
function launchSecondInstance() {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, CUBICLE_DATA_DIR: dataDir };
    delete env.ELECTRON_RUN_AS_NODE;
    const started = Date.now();
    const child = spawn(cubicleExe, ["--no-sandbox"], { cwd: installDir, env, stdio: "inherit" });
    child.on("exit", (/** @type {number | null} */ code) => resolve({ code: code ?? 1, ms: Date.now() - started }));
  });
}

await removeTolerant(cleanRoot);
await removeTolerant(outDir);
await mkdir(outDir, { recursive: true });

const started = Date.now();
/** @type {{ name: string, ok: boolean, detail?: string }[]} */
const orchestratorChecks = [];
/** @param {string} name @param {unknown} ok @param {string} [detail] */
const add = (name, ok, detail) => orchestratorChecks.push({ name, ok: Boolean(ok), detail: detail ?? "" });

// ── install：干净目录 = 本机近似的「干净机器」 ────────────────────────────
console.log("ticket 13 e2e · install（复制 win-unpacked 到干净目录 tmp/pkg-clean/app）");
const copy = await new Promise((resolve) => {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `Copy-Item -Recurse -Force ${JSON.stringify(pkgSrc)} ${JSON.stringify(installDir)}`],
    { stdio: "inherit" },
  );
  child.on("exit", (/** @type {number | null} */ code) => resolve(code ?? 1));
});
if (copy !== 0) {
  console.error("install copy failed");
  process.exit(1);
}
/** @param {string} dir @returns {Promise<number>} */
async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}
const installedBytes = await dirSize(installDir);
await writeFile(
  path.join(outDir, "install.json"),
  `${JSON.stringify({ from: pkgSrc, to: installDir, bytes: installedBytes, dataDir }, null, 2)}\n`,
  "utf8",
);
add("安装 = 干净目录里的完整包（tmp/pkg-clean/app）", existsSync(cubicleExe) && installedBytes > 50_000_000, `${(installedBytes / 1024 / 1024).toFixed(1)} MB`);

// ── boot：经随包 launcher 启动，办公室显示 + 数据目录 + 关于页 ─────────────
console.log("ticket 13 e2e · boot（Start-Cubicle.ps1 → 办公室 / 数据目录清单 / 关于页版本）");
const boot = await launchPackaged({
  viaLauncher: true,
  appArgs: ["--cubicle-e2e"],
  env: { CUBICLE_E2E_PHASE: "boot", CUBICLE_E2E_RUNNER: "scripts/e2e-13-runner.mjs", CUBICLE_EXPECTED_VERSION: expectedVersion, CUBICLE_LAUNCHER_EVIDENCE: path.join(outDir, "launcher-boot.json"), CUBICLE_CODEX_PATH: realCodex ?? "" },
});
const launcher = await readJson(path.join(outDir, "launcher-boot.json"));
const bootOk = boot.code === 0 && printChecks("boot", await readJson(path.join(outDir, "boot.json")));
add(
  "打包启动路径的 --no-sandbox 降级现场生效（随包 launcher 镜像 start.mjs）",
  launcher?.sandboxCrash === true && boot.code === 0,
  JSON.stringify(launcher ?? { missing: "launcher-boot.json" }),
);

// 验收 4（第一层）：退出后按名字 + 路径过滤，0 孤儿。
const sweepBoot = await countPackagedProcesses();
add("boot 退出后无 cubicle.exe/electron.exe 残留（按安装路径过滤）", sweepBoot === 0, `count=${sweepBoot}`);

// ── second：单实例锁 ──────────────────────────────────────────────────────
console.log("ticket 13 e2e · second（单实例锁：重复启动不出现第二个窗口）");
await removeTolerant(path.join(outDir, "second-instance.json"));
const primaryPromise = launchPackaged({
  appArgs: ["--cubicle-e2e"],
  env: { CUBICLE_E2E_PHASE: "second", CUBICLE_E2E_RUNNER: "scripts/e2e-13-runner.mjs", CUBICLE_CODEX_PATH: realCodex ?? "" },
});
// 等主实例真正起好（pids-second.json = boot 检查过关后落的第一份证据）
const primaryReady = await waitForFile(path.join(outDir, "pids-second.json"), 30_000);
add("第二实例启动前主实例已就绪", primaryReady);
const second = primaryReady
  ? await launchSecondInstance()
  : { code: -1, ms: -1 };
add("重复启动的副本：退出码 0 且快速退出（自己让位）", second.code === 0 && second.ms < 15_000, `code=${second.code} ms=${second.ms}`);
const primary = await primaryPromise;
const secondPhaseOk = primary.code === 0 && printChecks("second", await readJson(path.join(outDir, "second.json")));
const sweepSecond = await countPackagedProcesses();
add("second 阶段退出后无残留进程", sweepSecond === 0, `count=${sweepSecond}`);

// ── ledger：codex 在飞时走生产退出路径（账本清扫在打包形态生效）───────────
console.log("ticket 13 e2e · ledger（真 codex 在飞 → supervisor.stop → 账本清扫）");
if (!realCodex) {
  console.error("codex CLI not found (set CUBICLE_CODEX_PATH) — 打包验收需要真 CLI 宿主证明账本清扫");
  process.exit(1);
}
// 干净库起步（前两个阶段已证明 db 生命周期；这里只要一张干净的工位表）。
await removeTolerant(path.join(dataDir, "cubicle.db"));
await removeTolerant(path.join(dataDir, "cubicle.db-wal"));
await removeTolerant(path.join(dataDir, "cubicle.db-shm"));
const piMock = await startPiMockServer({ chunkPauseMs: 120 });
const codexMock = await startCodexResponsesMock();
await mkdir(path.join(dataDir, "engines", "pi"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "pi", "models.json"),
  `${JSON.stringify({
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
  }, null, 2)}\n`,
  "utf8",
);
await mkdir(path.join(dataDir, "engines", "codex"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "codex", "models.json"),
  `${JSON.stringify({ baseUrl: codexMock.baseUrl, apiKey: "e2e-codex-key", model: "cubicle-e2e-model" }, null, 2)}\n`,
  "utf8",
);

/** @type {Array<{ at: number, codex: number }>} */
const samples = [];
let watcher = null;
const ledgerLaunch = launchPackaged({
  appArgs: ["--cubicle-e2e"],
  env: { CUBICLE_E2E_PHASE: "ledger", CUBICLE_E2E_RUNNER: "scripts/e2e-13-runner.mjs", CUBICLE_CODEX_PATH: realCodex },
});
const ledgerPidsReady = await waitForFile(path.join(outDir, "pids-ledger.json"), 30_000);
if (ledgerPidsReady) {
  const ledgerPids = await readJson(path.join(outDir, "pids-ledger.json"));
  const hostPid = Number(ledgerPids?.hostPid);
  if (Number.isInteger(hostPid) && hostPid > 0) {
    watcher = setInterval(() => {
      void countCodexChildren(hostPid).then((n) => samples.push({ at: Date.now(), codex: n }));
    }, 250);
  }
}
const ledger = await ledgerLaunch;
if (watcher) clearInterval(watcher);
await writeFile(path.join(outDir, "child-samples-ledger.json"), `${JSON.stringify(samples, null, 2)}\n`, "utf8");
const ledgerOk = ledger.code === 0 && printChecks("ledger", await readJson(path.join(outDir, "ledger.json")));
const peak = Math.max(0, ...samples.filter((s) => s.codex >= 0).map((s) => s.codex));
add("打包形态下真 codex.exe 作为 AgentHost 子进程跑起过", peak >= 1, `samples=${samples.length} peak=${peak}`);
const residueAfterExit = await countCodexResidue();
add("生产退出路径把 codex 账本扫干净（退出后 0 残留）", residueAfterExit === 0, `codex residue=${residueAfterExit}`);
const sweepLedger = await countPackagedProcesses();
add("ledger 退出后无 cubicle.exe 残留", sweepLedger === 0, `count=${sweepLedger}`);
await piMock.close();
await codexMock.close();

// ── uninstall：删安装目录，再断言一次 ────────────────────────────────────
console.log("ticket 13 e2e · uninstall（删安装目录 = 本机近似的卸载）");
const removed = await removeTolerant(installDir);
add("卸载：安装目录可整目录删除", removed, `removed ${installDir}`);
const sweepUninstall = await countPackagedProcesses();
const residueUninstall = await countCodexResidue();
add("卸载后 0 孤儿进程（名字 + 路径过滤）", sweepUninstall === 0 && residueUninstall === 0, `packaged=${sweepUninstall} codex=${residueUninstall}`);
add("卸载只删程序，数据目录保留（升级/重装不丢办公室 — 语义如实记录）", existsSync(dataDir), dataDir);
await writeFile(
  path.join(outDir, "uninstall.json"),
  `${JSON.stringify({ installDir, sweeps: { uninstall: sweepUninstall, codexResidue: residueUninstall }, dataDirKept: existsSync(dataDir) }, null, 2)}\n`,
  "utf8",
);

const allOk =
  orchestratorChecks.every((c) => c.ok) && bootOk && secondPhaseOk && ledgerOk;
printChecks("orchestrator", { checks: orchestratorChecks });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (allOk) {
  console.log(`\nPASS · ticket 13 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-13/*.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}

/**
 * @param {string} file
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
