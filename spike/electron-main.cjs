/**
 * Electron entry point for the M0 spike.
 *
 * Two modes:
 *   SPIKE_MODE=node-version  print the embedded Node version and quit
 *   SPIKE_MODE=pi-utility    host the mock model server and run the pi SDK
 *                            probe inside a utilityProcess
 *
 * The main process never imports pi; the SDK stays in the utility process,
 * matching the AgentHost split in the architecture.
 */
const path = require("node:path");
const { app, utilityProcess } = require("electron");

const mode = process.env.SPIKE_MODE ?? "node-version";

/**
 * @param {Record<string, unknown>} payload
 */
function emitJson(payload) {
  process.stdout.write(`SPIKE_JSON ${JSON.stringify(payload)}\n`);
}

function printNodeVersion() {
  emitJson({
    check: "electron-node",
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  });
  app.quit();
}

async function runPiProbe() {
  const runDir = process.env.SPIKE_RUN_DIR;
  const fixtureDir = process.env.SPIKE_FIXTURE_DIR;
  if (!runDir || !fixtureDir) {
    emitJson({ check: "pi-utility", ok: false, error: "SPIKE_RUN_DIR and SPIKE_FIXTURE_DIR are required" });
    app.exit(1);
    return;
  }

  const { startMockOpenAiServer } = await import("./lib/mock-openai-server.mjs");
  const mock = await startMockOpenAiServer();

  const child = utilityProcess.fork(path.join(__dirname, "utility", "pi-probe.cjs"), [], {
    serviceName: "cubicle-m0-pi-probe",
    env: {
      ...process.env,
      SPIKE_BASE_URL: mock.baseUrl,
      SPIKE_FIXTURE_DIR: fixtureDir,
      SPIKE_RUN_DIR: runDir,
    },
  });

  let settled = false;
  /** @type {NodeJS.Timeout | undefined} */
  let timeout;

  /**
   * @param {Record<string, any>} message
   */
  function handleMessage(message) {
    if (message?.type === "spike-event") {
      process.stdout.write(`SPIKE_EVENT ${JSON.stringify(message.event)}\n`);
      return;
    }
    if (message?.type === "spike-result") {
      settled = true;
      if (timeout) clearTimeout(timeout);
      // Give stdout a turn to flush before shutting Electron down.
      process.stdout.write(
        `SPIKE_JSON ${JSON.stringify({ check: "pi-utility", ok: Boolean(message.result?.ok), result: message.result, requests: mock.requests })}\n`,
        async () => {
          await mock.close().catch(() => {});
          app.exit(message.result?.ok ? 0 : 1);
        },
      );
    }
  }

  child.on("message", handleMessage);
  child.on("exit", (code) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    emitJson({ check: "pi-utility", ok: false, error: `utility process exited before a result (code ${code})` });
    mock.close().catch(() => {});
    app.exit(1);
  });

  timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    emitJson({ check: "pi-utility", ok: false, error: "utility process timed out after 90s" });
    child.kill();
    mock.close().catch(() => {});
    app.exit(1);
  }, 90_000);
}

app.whenReady().then(async () => {
  try {
    if (mode === "node-version") {
      printNodeVersion();
      return;
    }
    if (mode === "pi-utility") {
      await runPiProbe();
      return;
    }
    emitJson({ check: mode, ok: false, error: `unknown SPIKE_MODE ${mode}` });
    app.exit(1);
  } catch (error) {
    emitJson({ check: mode, ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    app.exit(1);
  }
});
