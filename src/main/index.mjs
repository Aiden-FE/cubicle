/**
 * Electron main process: windows, preferences, updates — never business logic.
 *
 * It spawns/supervises the AgentHost (utilityProcess), brokers typed envelopes
 * between the renderer and the host, and coalesces host events into ≤16ms
 * frames on their way to the view. Reloading the renderer is safe: the host
 * keeps running and the fresh view resubscribes.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync } from "node:fs";
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron";

import { createHostSupervisor } from "./supervisor.mjs";
import { createEventCoalescer } from "./coalescer.mjs";
import { createEvent, createErrorReply, parseEnvelope } from "../shared/envelope.mjs";

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
mkdirSync(app.getPath("userData"), { recursive: true });

const e2eEnabled = process.argv.includes("--cubicle-e2e");
const e2ePhase = /** @type {"create" | "verify"} */ (process.env.CUBICLE_E2E_PHASE ?? "create");

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
    createEvent("host.status", {
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
      env: { ...process.env, CUBICLE_DATA_DIR: dataDir },
    });
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
    if (envelope.kind === "event" && envelope.topic === "host.status") {
      lastHostInfo = /** @type {Record<string, unknown>} */ (envelope.payload) ?? {};
      publishHostStatus({ state: "online", pid: supervisor.pid });
      return;
    }
    if (envelope.kind === "event") {
      eventCoalescer.push(envelope);
      return;
    }
    if (envelope.kind === "reply") {
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
  mainWindow.loadFile(path.join(rootDir, "dist", "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("cubicle:invoke", (_event, raw) => {
  const envelope = parseEnvelope(raw);
  if (!envelope || envelope.kind !== "invoke") return;
  if (supervisor.state === "offline" || supervisor.state === "stopped") {
    sendToRenderer(
      "cubicle:reply",
      createErrorReply(envelope, { code: "host_offline", message: "AgentHost is not running" }),
    );
    return;
  }
  supervisor.send(envelope);
});

app.whenReady().then(async () => {
  supervisor.start();
  createMainWindow();

  if (e2eEnabled) {
    const { runE2E } = await import("./e2e-02.mjs");
    const exitCode = await runE2E({
      app,
      getMainWindow: () => mainWindow,
      supervisor,
      dataDir: resolveDataDir(),
      bootStartMs,
      phase: e2ePhase,
      outDir: path.join(rootDir, "tmp", "e2e-02"),
    });
    app.exit(exitCode);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  supervisor.stop();
});
