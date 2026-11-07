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
    { createGitReader },
    { createTaskRunHook },
    { createDutyRuntime },
    { taskPrompt },
    { engineLedgerFile, sweepPidLedger },
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
    import("./git/reader.mjs"),
    import("./task/artifacts.mjs"),
    import("./duty/runtime.mjs"),
    import("./task/playbook.mjs"),
    import("./engine/child-ledger.mjs"),
    import("node:fs"),
    import("node:path"),
    import("../shared/envelope.mjs"),
  ]);

  const store = openStore({ dataDir });
  // 票 10 「宿主启动时清扫」: main's launch sweep covers the app restart; this
  // covers the SUPERVISOR restart path (host crashed → new host boots in the
  // same app session) — orphan engine children of the dead host get swept here,
  // not only at next app start. Fire-and-forget: an empty ledger costs one
  // file read; a full sweep never blocks the office coming up.
  void sweepPidLedger({
    file: engineLedgerFile(store.dataDir, "codex"),
    log: (message) => process.stderr.write(`host boot sweep: ${message}\n`),
  }).catch(() => {});
  const hostInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    dataDir: store.dataDir,
    dbPath: store.dbPath,
  };

  // The app's git door: read-only commands only, everything audited.
  const git = createGitReader();
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
    // Work-order runs collect their 四件套 (ticket 05).
    onTaskRunFinished: createTaskRunHook({ store, git }),
  });

  // 票 09: 上下班调度 — 到点自动上班（激活有未完成任务的员工自动续跑）、
  // 下班 90 秒宽限（可配）后落盘 paused；override 走 service 的立即通道。
  const duty = createDutyRuntime({
    store,
    runManager,
    taskPromptFor: (/** @type {any} */ task) => taskPrompt(task),
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

  // 票 10: 引擎能力声明 — the adapters own the promise ("can this engine
  // continue its own conversation?"). No adapter / no flag ⇒ NOT resumable:
  // the UI only offers 重跑, which is the conservative door the ticket asks for.
  const engineCapabilities = (/** @type {string} */ engine) => ({
    resumes: adapterFor(engine)?.resumes === true,
  });
  /** @param {string} engine */
  function adapterFor(engine) {
    return engine === "pi" ? piAdapter : engine === "codex" ? codexAdapter : null;
  }

  const service = createService({
    store,
    hostInfo,
    runManager,
    git,
    duty,
    engineProbe: probeRunner,
    engineFacts,
    engineCapabilities,
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
    // 同步方法立刻回；异步方法（host.pauseAll / host.awaitQuiet — 退出流程
    // 的两扇门）等引擎收尾 promise 落定再回，回包顺序不敏感（按 id 关联）。
    service.handleEnvelope(envelope).then(({ reply, events }) => {
      send(reply);
      for (const domainEvent of events) send(domainEvent);
    });
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

  // 上下班滴答循环（unref：不钉住宿主进程）
  duty.start();

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
