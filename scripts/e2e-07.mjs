/**
 * Ticket 07 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:07
 *
 * Boots the app against a deterministic mock model endpoint whose scripted
 * replies drive REAL tool executions in the employee's private workspace
 * (read / write / bash-echo / node test_ok.mjs / node test_fail.mjs / a
 * rm -rf the host policy blocks). The工位 animation is asserted from the
 * live DOM while each run is in flight, the idle clock (9s 摸鱼 / 45s 咖啡 /
 * 回工位) is watched in real time, and 名牌+气泡 toggling is clicked through
 * the real UI. Evidence: tmp/e2e-07/desk.json + tmp/e2e-07/*.png.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer } from "./e2e-07-mock-server.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-07");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// BYOK engine config, pointed at the local mock — same trick as ticket 04.
// chunkPauseMs pads the streamed replies so the工位 screen state (activity /
// 红绿 tone / 气泡) stays observable for a few hundred ms per tool call.
const mock = await startMockModelServer({ chunkPauseMs: 130 });
await mkdir(path.join(dataDir, "engines", "pi"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "pi", "models.json"),
  `${JSON.stringify(
    {
      $schema: "https://pi.dev/schemas/models.schema.json",
      providers: {
        cubicle: {
          name: "Cubicle E2E",
          baseUrl: mock.baseUrl,
          api: "openai-completions",
          apiKey: "e2e-local-key",
          models: [
            {
              type: "chat",
              id: "cubicle-e2e-model",
              name: "E2E Model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const started = Date.now();

console.log("ticket 07 e2e · phase desk (工位动画：四类工具 · 测试红绿 · 策略拒绝 · 摸鱼/咖啡 · 名牌气泡开关)");

/**
 * Cold-start note (AGENTS M2): the first phase's desk render can take >5s on
 * this machine; bootAndShowOffice allows 15s for the desks.
 */
const code = await new Promise((resolve) => {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.CUBICLE_E2E_PHASE = "desk";
  env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-07-runner.mjs");
  env.CUBICLE_E2E_OUT_DIR = outDir;
  // Keep the app under test inside the workspace (hermetic + policy-proof).
  env.CUBICLE_DATA_DIR = dataDir;
  // Dev-harness only: this machine's policy keeps the Chromium sandbox down.
  // (Screenshots are best-effort: this service session's GPU compositor can
  // hand capturePage a ~2s-stale frame, and --disable-gpu kills capture
  // entirely — DOM data + the session JSONL are the acceptance evidence.)
  const extraFlags = process.env.CUBICLE_E2E_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
  const child = spawn(electronBinary, [...extraFlags, mainPath, "--cubicle-e2e"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code) => resolve(code ?? 1));
});

const result = await readJson(path.join(outDir, "desk.json"));
await writeFile(path.join(outDir, "model-requests.json"), `${JSON.stringify(mock.requests, null, 2)}\n`, "utf8");
const ok = code === 0 && printChecks("desk", result);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (ok) {
  console.log(`\nPASS · ticket 07 acceptance (${seconds}s total) — 截图见 tmp/e2e-07/*.png`);
  await mock.close();
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-07/desk.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  await mock.close();
  process.exit(1);
}
