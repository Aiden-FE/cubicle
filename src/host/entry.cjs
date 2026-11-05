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

  const [{ openStore }, { createService }, { parseEnvelope, createEvent }] = await Promise.all([
    import("./store.mjs"),
    import("./service.mjs"),
    import("../shared/envelope.mjs"),
  ]);

  const store = openStore({ dataDir });
  const hostInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    dataDir: store.dataDir,
    dbPath: store.dbPath,
  };
  const service = createService({ store, hostInfo });

  const port = process.parentPort;
  /** @param {unknown} envelope */
  const send = (envelope) => port.postMessage(envelope);

  port.on("message", (event) => {
    const envelope = parseEnvelope(event.data);
    if (!envelope || envelope.kind !== "invoke") return;
    const { reply, events } = service.handle(envelope);
    send(reply);
    for (const domainEvent of events) send(domainEvent);
  });

  const heartbeat = () =>
    send(createEvent("host.status", { state: "online", ...hostInfo }));
  heartbeat();
  setInterval(heartbeat, 2000);
}

main().catch((err) => {
  console.error("AgentHost failed to start:", err);
  process.exitCode = 1;
});
