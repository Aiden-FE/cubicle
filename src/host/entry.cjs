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

  const [{ openStore }, { createService }, { createRunManager }, { createPiAdapter }, { createGitReader }, { createTaskRunHook }, { createDutyRuntime }, { taskPrompt }, { parseEnvelope, createEvent, TOPICS }] =
    await Promise.all([
      import("./store.mjs"),
      import("./service.mjs"),
      import("./engine/run-manager.mjs"),
      import("./engine/pi/adapter.mjs"),
      import("./git/reader.mjs"),
      import("./task/artifacts.mjs"),
      import("./duty/runtime.mjs"),
      import("./task/playbook.mjs"),
      import("../shared/envelope.mjs"),
    ]);

  const store = openStore({ dataDir });
  const hostInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    dataDir: store.dataDir,
    dbPath: store.dbPath,
  };

  const piAdapter = createPiAdapter({ dataDir: store.dataDir });
  // The app's git door: read-only commands only, everything audited.
  const git = createGitReader();

  const port = process.parentPort;
  /** @param {unknown} envelope */
  const send = (envelope) => port.postMessage(envelope);

  const runManager = createRunManager({
    store,
    getAdapter: (engine) => (engine === "pi" ? piAdapter : null),
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
  const service = createService({ store, hostInfo, runManager, git, duty });

  port.on("message", (event) => {
    const envelope = parseEnvelope(event.data);
    if (!envelope || envelope.kind !== "invoke") return;
    // 同步方法立刻回；异步方法（host.pauseAll / host.awaitQuiet — 退出流程
    // 的两扇门）等引擎收尾 promise 落定再回，回包顺序不敏感（按 id 关联）。
    service.handleEnvelope(envelope).then(({ reply, events }) => {
      send(reply);
      for (const domainEvent of events) send(domainEvent);
    });
  });

  const heartbeat = () =>
    send(createEvent(TOPICS.hostStatus, { state: "online", ...hostInfo }));
  heartbeat();
  setInterval(heartbeat, 2000);

  // 上下班滴答循环（unref：不钉住宿主进程）
  duty.start();

  // Pay pi's module-import cost while the office settles in, so the first
  // sentence an employee hears doesn't also wait for the engine's cold start.
  piAdapter.warm();
}

main().catch((err) => {
  // A GUI-subsystem process may have no console: stderr handles are enough,
  // and main tees them into <dataDir>/agenthost.log. Exit loudly so the
  // supervisor can restart — a silent half-start would hang the UI forever.
  process.stderr.write(
    `AgentHost failed to start: ${err && err.stack ? err.stack : err}\n`,
  );
  process.exit(1);
});
