/**
 * Ticket 08 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:08
 *
 * Phase "shell" (scripts/e2e-08-runner.mjs) in a 1280×800 window:
 *  左轨四入口可用（公司切换 / 工单台 / 花名册 / 引擎中心 + 票 11 插槽）；
 *  公司切换器显示各公司活跃数；右把手徽标 + 「进行中 / 待验收 / 档案」三段；
 *  工单台/把手全是浮层 — 画布全程 100% 满窗、房间尺寸不变（1280 布局不破）；
 *  公司 A 慢活跑着 → 切到公司 B（A 的 run 事件继续进 host、taskCounts 跨公司
 *  可见）→ 切回 A：工位还在、事件继续把工位点亮、工单照常跑完进待验收。
 *
 * Raw evidence: tmp/e2e-08/{shell,model-requests}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer08 } from "./e2e-08-mock-server.mjs";
import { seedModelLibrary } from "./e2e-models.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-08");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/**
 * @param {{ phase: string }} options
 */
async function launch(options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-08-runner.mjs");
    env.CUBICLE_E2E_OUT_DIR = outDir;
    env.CUBICLE_DATA_DIR = dataDir;
    const extraFlags = process.env.CUBICLE_E2E_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
    const child = spawn(electronBinary, [...extraFlags, mainPath, "--cubicle-e2e"], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// BYOK engine config pointed at the local mock — same trick as tickets 04-07.
const mock = await startMockModelServer08();
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

await seedModelLibrary(dataDir, { baseUrl: mock.baseUrl, protocol: "openai-completions" });

const started = Date.now();

console.log("ticket 08 e2e · phase shell（左轨四入口 / 公司活跃数 / 右把手三段 / 浮层不挤画布 / 切公司后台照跑）");
const code = await launch({ phase: "shell" });
const phaseResult = await readJson(path.join(outDir, "shell.json"));
const phaseOk = code === 0 && printChecks("shell", phaseResult);

await writeFile(path.join(outDir, "model-requests.json"), `${JSON.stringify(mock.requests, null, 2)}\n`, "utf8");
await mock.close();

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (phaseOk) {
  console.log(`\nPASS · ticket 08 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-08/shell.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
