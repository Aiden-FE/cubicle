/**
 * pi SDK probe. Runs inside an Electron utilityProcess and deliberately does
 * NOT touch the user's real `~/.pi`: credentials, settings and session history
 * all live under the run directory.
 */
const { mkdir, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");

/**
 * @param {Record<string, unknown>} message
 */
function send(message) {
  process.parentPort?.postMessage(message);
}

/**
 * @param {string} dir
 * @param {string} baseUrl
 */
async function writeModelConfig(dir, baseUrl) {
  const models = {
    $schema: "https://pi.dev/schemas/models.schema.json",
    providers: {
      spike: {
        name: "Cubicle M0 spike",
        baseUrl,
        api: "openai-completions",
        apiKey: "spike-local-key",
        models: [
          {
            type: "chat",
            id: "spike-model",
            name: "Spike Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
    },
  };
  await writeFile(path.join(dir, "models.json"), `${JSON.stringify(models, null, 2)}\n`, "utf8");
}

async function main() {
  const baseUrl = process.env.SPIKE_BASE_URL;
  const fixtureDir = process.env.SPIKE_FIXTURE_DIR;
  const runDir = process.env.SPIKE_RUN_DIR;
  if (!baseUrl || !fixtureDir || !runDir) {
    throw new Error("SPIKE_BASE_URL, SPIKE_FIXTURE_DIR and SPIKE_RUN_DIR are required");
  }

  const agentDir = path.join(runDir, "agent");
  await rm(agentDir, { recursive: true, force: true });
  await mkdir(agentDir, { recursive: true });
  await writeModelConfig(agentDir, baseUrl);

  const pi = await import("@earendil-works/pi-coding-agent");
  const { normalizePiEvent } = await import("../lib/pi-events.mjs");

  const modelRuntime = await pi.ModelRuntime.create({
    modelsPath: path.join(agentDir, "models.json"),
    authPath: path.join(agentDir, "auth.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  const model = modelRuntime.getModel("spike", "spike-model");
  if (!model) {
    const available = modelRuntime
      .getAllModels()
      .map((/** @type {{ provider: string, id: string }} */ item) => `${item.provider}/${item.id}`);
    throw new Error(`spike/spike-model was not loaded; available models: ${available.join(", ") || "(none)"}`);
  }

  const { session } = await pi.createAgentSession({
    cwd: fixtureDir,
    agentDir,
    modelRuntime,
    model,
    sessionManager: pi.SessionManager.inMemory(),
    tools: ["read"],
  });

  /** @type {string[]} */
  const textDeltas = [];
  let toolStarts = 0;
  let toolEnds = 0;
  let agentEnds = 0;

  const unsubscribe = session.subscribe((/** @type {any} */ event) => {
    for (const normalized of normalizePiEvent(event)) {
      if (normalized.type === "text_delta") {
        textDeltas.push(normalized.text);
      } else if (normalized.type === "tool_execution_start") {
        toolStarts += 1;
      } else if (normalized.type === "tool_execution_end") {
        toolEnds += 1;
      } else if (normalized.type === "agent_end") {
        agentEnds += 1;
      }
      send({ type: "spike-event", event: normalized });
    }
  });

  try {
    await session.prompt("Read hello.txt and summarize it.");
    const ok = textDeltas.length > 0 && toolStarts > 0 && toolEnds > 0 && agentEnds > 0;
    send({
      type: "spike-result",
      result: {
        ok,
        node: process.versions.node,
        piVersion: pi.VERSION,
        textDeltas: textDeltas.length,
        text: textDeltas.join(""),
        toolStarts,
        toolEnds,
        agentEnds,
        lastAssistantText: session.getLastAssistantText() ?? null,
      },
    });
  } finally {
    unsubscribe();
    session.dispose();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  send({ type: "spike-event", event: { type: "error", code: "pi_probe_failed", message } });
  send({ type: "spike-result", result: { ok: false, error: message } });
  process.exitCode = 1;
});
