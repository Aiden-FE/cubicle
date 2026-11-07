/**
 * AgentHost entry — runs inside an Electron utilityProcess.
 *
 * A CJS entry by convention (utilityProcess loads it like Node's main module),
 * immediately dynamic-importing the ESM layers. This process is the single
 * SQLite writer and, later, the engine runtime; the main process only
 * supervises it and brokers its traffic.
 */
async function main() {
  const dataDir = process.env.CUBICLE_DATA_DIR;
  if (!dataDir) {
    throw new Error("CUBICLE_DATA_DIR is required");
  }

  const [
    { openStore },
    { createService },
    { createRunManager },
    { createPiAdapter },
    { createCodexAdapter },
    { createProbeRunner },
    { existsSync },
    path,
    { parseEnvelope, createEvent, TOPICS },
  ] = await Promise.all([
    import("./store.mjs"),
    import("./service.mjs"),
    import("./engine/run-manager.mjs"),
    import("./engine/pi/adapter.mjs"),
    import("./engine/codex/adapter.mjs"),
    import("./engine/probe.mjs"),
    import("node:fs"),
    import("node:path"),
    import("../shared/envelope.mjs"),
  ]);

  const store = openStore({ dataDir });
  const hostInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    dataDir: store.dataDir,
    dbPath: store.dbPath,
  };

  const port = process.parentPort;
  /** @param {unknown} envelope */
  const send = (envelope) => port.postMessage(envelope);

  const piAdapter = createPiAdapter({ dataDir: store.dataDir });
  const codexAdapter = createCodexAdapter({
    dataDir: store.dataDir,
    codexBinary: process.env.CUBICLE_CODEX_PATH || "codex",
  });
  // Abrupt host exit (supervisor stop → kill) must still reclaim codex, so the
  // CLI host leaves no child process under this host pid.
  process.on("exit", () => codexAdapter.killChildrenSync());

  const runManager = createRunManager({
    store,
    getAdapter: (engine) => (engine === "pi" ? piAdapter : engine === "codex" ? codexAdapter : null),
    // Engine events ride the run.event topic; the main process coalesces and
    // the view subscribes per topic. (Payloads stay envelope-shaped.)
    emit: (payload) => send(createEvent(TOPICS.runEvent, payload)),
  });

  // The admission probe (ticket 11) drives the SAME run-manager seam a real
  // conversation uses, against a hidden probe employee, and listens on the
  // internal subscribe() rather than the UI topic. probe:true bypasses the
  // admission gate — the probe IS the admission test.
  const probeRunner = createProbeRunner({
    store,
    startRun: ({ employeeId, text }) => ({ runId: runManager.start({ employeeId, text, probe: true }).run.id }),
    subscribeRunEvents: (listener) => runManager.subscribe(listener),
  });

  /** An engine is "configured" (badge 已登录 vs 待配 key) by its BYOK file. */
  const engineFacts = (/** @type {string} */ engine) => ({
    configured: existsSync(path.join(store.dataDir, "engines", engine, "models.json")),
  });

  const service = createService({
    store,
    hostInfo,
    runManager,
    engineProbe: probeRunner,
    engineFacts,
    notifyDomain: (payload) => send(createEvent(TOPICS.domainChanged, payload)),
  });

  port.on("message", (event) => {
    const envelope = parseEnvelope(event.data);
    if (!envelope || envelope.kind !== "invoke") return;
    if (envelope.method === "host.shutdown") {
      // graceful exit requested by the supervisor: reclaim engine children,
      // ack, then quit. (Ticket 04 left the CLI-host reclamation duty here.)
      void codexAdapter
        .shutdown()
        .catch(() => {})
        .finally(() => {
          send(createReplySafe(envelope, { ok: true }));
          setTimeout(() => process.exit(0), 50);
        });
      return;
    }
    const { reply, events } = service.handle(envelope);
    send(reply);
    for (const domainEvent of events) send(domainEvent);
  });

  /** @param {{ id: string, v: number, ts: number }} invoke @param {unknown} payload */
  function createReplySafe(invoke, payload) {
    return { v: invoke.v, kind: "reply", id: invoke.id, ok: true, payload, ts: Date.now() };
  }

  // Best-effort engine detection at startup so badges are honest without the
  // engine center being opened: `codex --version` proves the binary is present.
  void detectCodex();
  async function detectCodex() {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const run = promisify(execFile);
      const { stdout } = await run(process.env.CUBICLE_CODEX_PATH || "codex", ["--version"], { windowsHide: true, timeout: 8000 });
      store.setEngineInstalled({ engine: "codex", installed: true, version: String(stdout).trim() });
    } catch {
      store.setEngineInstalled({ engine: "codex", installed: false, version: null });
    }
    send(createEvent(TOPICS.domainChanged, { reason: "engine.detect", engine: "codex" }));
  }

  const heartbeat = () => send(createEvent(TOPICS.hostStatus, { state: "online", ...hostInfo }));
  heartbeat();
  setInterval(heartbeat, 2000);

  // Pay pi's module-import cost while the office settles in, so the first
  // sentence an employee hears doesn't also wait for the engine's cold start.
  piAdapter.warm();
}

main().catch(async (err) => {
  // A GUI-subsystem process may have no console, so stderr alone can vanish:
  // the failure is also appended next to the data the host could not open
  // (<dataDir>/agenthost-error.log). Exit loudly so the supervisor restarts —
  // a silent half-start would hang the UI forever.
  const line = `AgentHost failed to start: ${err && err.stack ? err.stack : err}\n`;
  process.stderr.write(line);
  try {
    const dataDir = process.env.CUBICLE_DATA_DIR;
    if (dataDir) {
      const [{ appendFileSync }, path] = await Promise.all([import("node:fs"), import("node:path")]);
      appendFileSync(path.join(dataDir, "agenthost-error.log"), line, "utf8");
    }
  } catch {
    // a host that cannot even write its log still exits below
  }
  process.exit(1);
});
