/**
 * Electron main process: windows, preferences, updates — never business logic.
 *
 * It spawns/supervises the AgentHost (utilityProcess), brokers typed envelopes
 * between the renderer and the host, and coalesces host events into ≤16ms
 * frames on their way to the view. Reloading the renderer is safe: the host
 * keeps running and the fresh view resubscribes.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { app, BrowserWindow, Menu, ipcMain, utilityProcess, dialog } from "electron";

import { createHostSupervisor } from "./supervisor.mjs";
import { createEventCoalescer } from "./coalescer.mjs";
import { createExitCoordinator } from "./exit-coordinator.mjs";
import { createSingleInstanceGuard, focusMainWindow } from "./single-instance.mjs";
import { readPackageVersion, resolveAboutVersion } from "./app-version.mjs";
import { recordHostPid, sweepCrashResidue } from "./crash-residue.mjs";
import { createInvoke, createEvent, createErrorReply, parseEnvelope, TOPICS } from "../shared/envelope.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..", "..");
const bootStartMs = Date.now();

// The entry lives in src/main; without an explicit userData Electron would
// call the app "Electron" and use %APPDATA%\Electron. Default data home is
// %APPDATA%\cubicle. CUBICLE_DATA_DIR also redirects userData (Chromium cache
// included) so test runs stay inside the workspace.
// (Do NOT use app.setName() at module scope: it hard-crashes this Electron.)
if (process.env.CUBICLE_DATA_DIR) {
  app.setPath("userData", process.env.CUBICLE_DATA_DIR);
} else {
  app.setPath("userData", path.join(app.getPath("appData"), "cubicle"));
}

if (process.env.CUBICLE_PROBE_USERDATA) {
  // Evidence for the acceptance run: exercise this exact resolution, then
  // quit before touching the filesystem.
  appendFileSyncProbe(process.env.CUBICLE_PROBE_USERDATA, {
    userData: app.getPath("userData"),
    appData: app.getPath("appData"),
  });
  app.exit(0);
}

// 票 13 验收 2：单实例锁。拿不到锁 = 已经有一个 Cubicle 在跑：把既有窗口
// 带到前台的活儿归那个进程，这个副本立即退出（不开第二个窗口、不建数据
// 目录）。锁以 userData 为键，所以上面的路径解析必须先跑（锁文件住在
// userData，M1 安全策略拒工作区外写入）。票 10 补一层理由：一个数据目录
// 同时只该有一个 Cubicle——否则两个实例抢同一 SQLite WAL，更糟的是崩溃
// 清扫会把第一实例的活宿主当孤儿杀掉；锁让「账本里有活 pid = 应用死过」
// 这个推断成立。
const instanceGuard = createSingleInstanceGuard({
  requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
});
if (instanceGuard.role === "secondary") {
  app.exit(0);
}
app.on("second-instance", () => {
  focusMainWindow(mainWindow);
  if (e2eOutDirForEvidence) {
    appendFileSyncProbe(path.join(e2eOutDirForEvidence, "second-instance.json"), {
      at: Date.now(),
      windows: BrowserWindow.getAllWindows().length,
    });
  }
});

/**
 * @param {string} file
 * @param {Record<string, unknown>} payload
 */
function appendFileSyncProbe(file, payload) {
  mkdirSync(path.dirname(file), { recursive: true });
  // One JSON value per line: append-safe evidence stream.
  appendFileSync(file, JSON.stringify(payload) + "\n");
}

mkdirSync(app.getPath("userData"), { recursive: true });

const e2eEnabled = process.argv.includes("--cubicle-e2e");
const e2ePhase = /** @type {"create" | "verify"} */ (process.env.CUBICLE_E2E_PHASE ?? "create");
/** Where the acceptance runner writes evidence; also where the
 *  second-instance hand-off drops its proof (ticket 13). */
const e2eOutDirForEvidence = e2eEnabled ? (process.env.CUBICLE_E2E_OUT_DIR ?? null) : null;

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** Last host heartbeat payload (pid, startedAt, dataDir, dbPath). */
let lastHostInfo = /** @type {Record<string, unknown>} */ ({});

/**
 * @param {string} channel
 * @param {unknown} payload
 */
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const eventCoalescer = createEventCoalescer({
  send: (batch) => sendToRenderer("cubicle:events", batch),
});

/**
 * Merge the supervisor's own state with the latest heartbeat into one
 * host.status envelope for the view.
 *
 * @param {{ state: string, pid: number | null }} status
 */
function publishHostStatus(status) {
  eventCoalescer.push(
    createEvent(TOPICS.hostStatus, {
      ...lastHostInfo,
      state: status.state,
      pid: status.pid ?? lastHostInfo.pid ?? null,
    }),
  );
}

const supervisor = createHostSupervisor({
  fork: (entryPath, options) => {
    const dataDir = resolveDataDir();
    const child = utilityProcess.fork(entryPath, [], {
      ...options,
      stdio: "pipe",
      env: { ...process.env, CUBICLE_DATA_DIR: dataDir },
    });
    // 票 10: record who we just spawned — if THIS app is force-killed, the
    // orphaned host is still holding the SQLite WAL; the next launch's
    // sweepCrashResidue reads this line and kills it before spawning a new one.
    recordHostPid({ dataDir, pid: child.pid });
    // Host stderr → <dataDir>/agenthost.log, so a silent crash leaves evidence.
    child.stderr?.on("data", (chunk) => {
      try {
        mkdirSync(dataDir, { recursive: true });
        appendFileSync(path.join(dataDir, "agenthost.log"), String(chunk));
      } catch {
        // logging must never take the app down
      }
    });
    return child;
  },
  onMessage: (raw) => {
    const envelope = parseEnvelope(raw);
    if (!envelope) return;
    if (envelope.kind === "event" && envelope.topic === TOPICS.hostStatus) {
      lastHostInfo = /** @type {Record<string, unknown>} */ (envelope.payload) ?? {};
      publishHostStatus({ state: "online", pid: supervisor.pid });
      return;
    }
    if (envelope.kind === "event") {
      eventCoalescer.push(envelope);
      return;
    }
    if (envelope.kind === "reply") {
      const pending = hostInvocations.get(envelope.id);
      if (pending) {
        clearTimeout(pending.timer);
        hostInvocations.delete(envelope.id);
        if (envelope.ok) pending.resolve(envelope.payload);
        else pending.reject(new Error(`${envelope.error?.code ?? "host_error"}: ${envelope.error?.message ?? ""}`));
        return;
      }
      sendToRenderer("cubicle:reply", envelope);
    }
  },
});
supervisor.subscribe(publishHostStatus);

/**
 * Where the app keeps its data: the OS application-data directory by default,
 * never the user's home. CUBICLE_DATA_DIR redirects both userData and the
 * AgentHost store (used by tests).
 */
function resolveDataDir() {
  return app.getPath("userData");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Cubicle",
    backgroundColor: "#f6f1e7",
    webPreferences: {
      preload: path.join(rootDir, "src", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // No File/Edit/View chrome — this is a product window. Ctrl+R still reloads
  // the view (the host keeps running), which the ticket's acceptance relies on.
  Menu.setApplicationMenu(null);
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.control && !input.alt && input.code === "KeyR") {
      event.preventDefault();
      mainWindow?.webContents.reload();
    }
  });
  mainWindow.loadFile(path.join(rootDir, "dist", "renderer", "index.html"));
  // 票 09: 关窗先过三选（直接退 / 等完成 / 取消）。「直接退」在销毁窗口前
  // 等 AgentHost 把下班落盘（paused）写进库；「取消」窗口照开。
  mainWindow.on("close", (event) => {
    if (exitCoordinator.exiting) return;
    event.preventDefault();
    void exitCoordinator.requestClose();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("cubicle:invoke", (_event, raw) => {
  const envelope = parseEnvelope(raw);
  if (!envelope || envelope.kind !== "invoke") return;
  if (supervisor.state === "offline" || supervisor.state === "stopped" || !supervisor.send(envelope)) {
    sendToRenderer(
      "cubicle:reply",
      createErrorReply(envelope, { code: "host_offline", message: "后台服务未运行，正在自动重启" }),
    );
  }
});

// 票 13 验收 5：关于页的版本号。app.getVersion() 是权威（打包后 = exe 的
// metadata），主进程顺手对表 asar/仓库里的 package.json —— 漂移要诚实上报
// （这是 main 的业务：窗口与偏好，不经过 AgentHost 信封总线）。
ipcMain.handle("cubicle:app-info", () => {
  const pkgFile = path.join(rootDir, "package.json");
  const packageVersion = existsSync(pkgFile) ? readPackageVersion(readFileSync(pkgFile, "utf8")) : null;
  const about = resolveAboutVersion({ appVersion: app.getVersion(), packageVersion });
  return {
    productName: "Cubicle",
    ...about,
    packageVersion,
    electron: process.versions.electron ?? null,
    packaged: app.isPackaged,
    dataDir: resolveDataDir(),
  };
});

// — 退出三选 (ticket 09) — 主进程自己也要敲 AgentHost 的门（下班落盘 /
//   等完成），按回包 id 关联；渲染进程的 reply 转发不受影响。

/** @type {Map<string, { resolve: (payload: unknown) => void, reject: (err: Error) => void, timer: NodeJS.Timeout }>} */
const hostInvocations = new Map();
let hostInvokeSeq = 0;

/**
 * @param {string} method
 * @param {Record<string, unknown>} [payload]
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>}
 */
function invokeHost(method, payload = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    hostInvokeSeq += 1;
    const id = `m${hostInvokeSeq}-${Date.now().toString(36)}`;
    const envelope = createInvoke(id, method, payload);
    const timer = setTimeout(() => {
      hostInvocations.delete(id);
      reject(new Error(`host_timeout (${method})`));
    }, timeoutMs);
    hostInvocations.set(id, {
      resolve,
      reject,
      timer,
    });
    if (!supervisor.send(envelope)) {
      clearTimeout(timer);
      hostInvocations.delete(id);
      reject(new Error("host_offline"));
    }
  });
}

/**
 * 退出决策：三选对话 + 「直接退先下班落盘」的顺序（exit-coordinator seam，
 * 单测钉死）。e2e 用 CUBICLE_E2E_EXIT_CHOICE 模拟人手点击：先把实际展示的
 * 三选记录到证据文件，再按指定序号选择 — 对话框本身是真的，只是手指是脚本。
 *
 * @param {{ buttons: string[], detail: string }} spec
 */
async function askExitChoice(spec) {
  const scripted = e2eEnabled && process.env.CUBICLE_E2E_EXIT_CHOICE !== undefined;
  if (scripted) {
    try {
      const outDir = process.env.CUBICLE_E2E_OUT_DIR ?? path.join(rootDir, "tmp", "e2e");
      appendFileSyncProbe(path.join(outDir, "exit-dialog.json"), {
        buttons: spec.buttons,
        detail: spec.detail,
        choice: Number(process.env.CUBICLE_E2E_EXIT_CHOICE),
      });
    } catch {
      // 证据写不进去也不该卡退出
    }
    return Number(process.env.CUBICLE_E2E_EXIT_CHOICE);
  }
  /** @type {import("electron").MessageBoxOptions} */
  const options = {
    type: "question",
    buttons: spec.buttons,
    defaultId: 1,
    cancelId: 2,
    message: "要退出 Cubicle 吗？",
    detail: spec.detail,
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response;
}

const exitCoordinator = createExitCoordinator({
  showMessageBox: askExitChoice,
  pauseAll: () => invokeHost("host.pauseAll", {}, 15_000),
  awaitQuiet: () => invokeHost("host.awaitQuiet", {}, 30 * 60 * 1000),
  allowQuit: () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    // e2e：runner 自己决定何时以什么码下线（app.exit），窗口销毁本身已证明
    // 「pauseAll 落库在前」；真实退出才走 app.quit。
    if (!e2eEnabled) app.quit();
  },
  onNote: (note) => {
    try {
      appendFileSync(path.join(resolveDataDir(), "agenthost.log"), `exit flow: ${note}\n`);
    } catch {
      // 备注尽力而为
    }
  },
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return; // second instance: the holder owns the data dir — do NOT sweep, do NOT spawn
  // 票 10: sweep crash residue BEFORE the first host spawns — an orphaned
  // AgentHost from a force-killed launch is a second SQLite writer, and its
  // engine children are the orphan processes the ticket forbids. (The single-
  // instance lock above guarantees any live host in the ledgers IS residue.)
  try {
    const swept = await sweepCrashResidue({
      dataDir: resolveDataDir(),
      log: (message) => {
        try {
          appendFileSync(path.join(resolveDataDir(), "agenthost.log"), `crash sweep: ${message}\n`);
        } catch {
          // evidence is best-effort
        }
      },
    });
    if (swept.host.checked > 0 || Object.values(swept.engines).some((outcome) => outcome.checked > 0)) {
      console.log(`crash residue swept: host=${JSON.stringify(swept.host)} engines=${JSON.stringify(swept.engines)}`);
    }
  } catch {
    // residue sweep must never block boot; the ledgers stay for next launch
  }
  supervisor.start();
  createMainWindow();

  if (e2eEnabled) {
    // The acceptance runner lives under scripts/ (main stays business-free);
    // the orchestrator picks which ticket's runner to drive.
    const runnerRelative = process.env.CUBICLE_E2E_RUNNER ?? path.join("scripts", "e2e-02-runner.mjs");
    const { runE2E } = await import(pathToFileURL(path.join(rootDir, runnerRelative)).href);
    const exitCode = await runE2E({
      app,
      getMainWindow: () => mainWindow,
      supervisor,
      dataDir: resolveDataDir(),
      bootStartMs,
      phase: e2ePhase,
      outDir: process.env.CUBICLE_E2E_OUT_DIR ?? path.join(rootDir, "tmp", "e2e-02"),
    });
    app.exit(exitCode);
  }
});

app.on("window-all-closed", () => {
  if (e2eEnabled) return; // e2e：退出时机与退出码由 runner 的结果统一决定（app.exit），
  // 这里抢先 quit 会和「落盘证据刚写完」赛跑。
  app.quit();
});

app.on("before-quit", () => {
  supervisor.stop();
});
