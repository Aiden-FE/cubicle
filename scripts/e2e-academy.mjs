/**
 * 票 a03 acceptance run — 学院浮层, one command:
 *
 *   npm run build:renderer && npm run e2e:academy
 *
 * Phase "panel" (scripts/e2e-academy-runner.mjs) in a 1280×800 window:
 *  左轨第五入口「学院」可用；开合浮层画布仍满窗、房间与工位坐标不变（照 e2e:08 断法）；
 *  列表全部来自临时 NEO_HOME（fixture 只 role 不 library → 空态可见，不硬编码任何资源）；
 *  装：面板输入本机源目录 → vendored `neo add --domain demo`（依赖 ELECTRON_RUN_AS_NODE
 *  起 bin/neo.js，见 vendor/README.md）→ 回显可读 + 行出现（来源=本机）；
 *  下发：勾角色 → `neo role set` + `neo update` 收敛 → 行的「被引用角色」实时跟上，
 *  store 投影缓存同步（role.list 现值可见）。
 *  空 ~/.neo 空态、远端首次确认、neo 缺失/过老降级都在 node --test 层钉死
 *  （test/academy-panel.test.mjs）—— 见票 ## Answer。
 *
 * Raw evidence: tmp/e2e-academy/panel.json.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const vendorCli = path.join(root, "vendor", "neo", "bin", "neo.js");
const outDir = path.join(root, "tmp", "e2e-academy");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");
const neoHome = path.join(outDir, "neo-home");
const srcDir = path.join(outDir, "src");

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
    // 学院 e2e 铁律：NEO_HOME 指临时 fixture，绝不读写用户真实 ~/.neo
    // （fixture 里也只有本 e2e 自己种的东西）。
    env.NEO_HOME = neoHome;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-academy-runner.mjs");
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

/**
 * @param {string[]} args
 */
function neo(args) {
  const r = spawnSync(process.execPath, [vendorCli, ...args], {
    cwd: root,
    env: { ...process.env, NEO_HOME: neoHome },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    console.error(`seed neo ${args.join(" ")} failed (${r.status}):\n${r.stderr ?? ""}`);
    process.exit(1);
  }
  return r.stdout;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(srcDir, "skills", "hello-academy"), { recursive: true });
await mkdir(neoHome, { recursive: true });

// ── fixture seed (fixture 行为，不是应用行为；照 e2e-08 种 git 工作区的先例) ──
// 一个可下发的 Neo 角色（library 留空：空态由面板自己显示，装的动作走 UI）。
neo(["create", "e2e-role-a"]);
await writeFile(
  path.join(srcDir, "skills", "hello-academy", "SKILL.md"),
  "---\nname: hello-academy\ndescription: Academy e2e skill with a secret-free body\n---\n\nhello from the academy fixture\n",
  "utf8",
);

const started = Date.now();

console.log("ticket a03 e2e · phase panel（左轨学院入口 / 画布不变 / 空态 / 装→本机 / 下发→被引用角色实时）");
const code = await launch({ phase: "panel" });
const phaseResult = await readJson(path.join(outDir, "panel.json"));
const phaseOk = code === 0 && printChecks("panel", phaseResult);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (phaseOk) {
  console.log(`\nPASS · ticket a03 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-academy/panel.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
