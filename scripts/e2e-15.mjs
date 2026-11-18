/**
 * 票 a04 acceptance run — 「e2e:15 正反断言」, one command:
 *
 *   npm run build:renderer && npm run e2e:15
 *
 * 真实路径全流程：
 *   装（fixture 落盘一个带暗号 ACADEMY-7 的领域技能 + vendored CLI 建两个角色）
 *   → 下发（vendored `role set --domains` 标脏 → `update` 收敛清脏，宿主合同见 vendor/README）
 *   → 招聘（Electron 内走招聘向导：主员工=e2e-15-main，对照员工=e2e-15-ctrl）
 *   → 派活（对话浮层发消息；引擎 open 前装配器对 main 跑 materialize --no-auth --agent-models，
 *     对 ctrl 装配出空集合）
 *   → 断言（mock 模型 server 记录收到的**原始请求体**：main 的请求含 ACADEMY-7、ctrl 的不含；
 *     文件层：main 的 skills/academy-marker 是指向学院内容目录的链接（非副本）；
 *     MCP：main 的 academy-mcp.json 只存 env:VAR 引用、mcp.json 是 open 时注入的解析值；
 *     ctrl 三件皆无；员工根内无 auth.json / neo 模型件）。
 * 隔离：NEO_HOME 指 tmp/e2e-15/neo —— 真实 ~/.neo 前后指纹必须不变。
 *
 * Raw evidence: tmp/e2e-15/{flow,summary}.json.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer } from "./e2e-mock-model-server.mjs";
import { seedModelLibrary } from "./e2e-models.mjs";
import { removeTreeJunctionSafe } from "../src/host/academy/link-safe-remove.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const vendorCli = path.join(root, "vendor", "neo", "bin", "neo.js");
const outDir = path.join(root, "tmp", "e2e-15");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");
const neoHome = path.join(outDir, "neo");

const ROLE_MAIN = "e2e-15-main";
const ROLE_CTRL = "e2e-15-ctrl";
const DOMAIN = "demo";
const SKILL = "academy-marker";
const MARKER = "ACADEMY-7";
const SECRET_VALUE = "ACAD-SECRET-7"; // 密钥值：只许出现在引擎原生渲染件里（open 注入），不许在 canonical 文件
const SECRET_VAR = "ACADEMY_E2E_SECRET";
const EMP_MAIN = "小院";
const EMP_CTRL = "对照";
const MSG_MAIN = "主线任务：讲讲你手头有哪些技能可以用。";
const MSG_MAIN2 = "第二张工单：再说说你的技能。";
const MSG_CTRL = "对照任务：随便聊聊今天的天气。";

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!rendererIndex || !existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/**
 * Run the vendored CLI against the FIXTURE neo home (never the real ~/.neo).
 * @param {string[]} args
 * @param {string} stage 装/下发 failure attribution
 */
function neo(args, stage) {
  const r = spawnSync(process.execPath, [vendorCli, ...args], {
    cwd: root,
    env: { ...process.env, NEO_HOME: neoHome },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    console.error(`${stage} 阶段失败: neo ${args.join(" ")} 退出码 ${r.status}:\n${r.stderr ?? ""}`);
    process.exit(1);
  }
  return r.stdout;
}

/**
 * Fingerprint the REAL ~/.neo (read-only isolation assert): root entries,
 * recursive file count / bytes / newest mtime. Content equality = these equal.
 */
async function realNeoFingerprint() {
  const home = path.join(os.homedir(), ".neo");
  if (!existsSync(home)) return { exists: false };
  /** @param {string} dir @param {number} depth */
  const walk = async (dir, depth) => {
    let files = 0;
    let bytes = 0;
    let newest = 0;
    /** @param {string} d @param {number} dd */
    const go = async (d, dd) => {
      for (const entry of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory() && dd < 6) {
          await go(p, dd + 1);
          continue;
        }
        const info = await stat(p);
        files += 1;
        bytes += info.size;
        newest = Math.max(newest, info.mtimeMs);
      }
    };
    await go(dir, 0);
    const top = (await readdir(home)).sort();
    return { exists: true, files, bytes, newest, top };
  };
  return walk(home, 0);
}

/**
 * 本机坑（a04 实录）：electron/vendored-CLI 创建的 junction 对 node 的
 * stat/readlink/rmdir 呈现为普通目录，递归 rm 会钻进目标里删数据。
 * 整棵 tmp/e2e-15 用装配器同款 junction-safe 门解掉（引擎根里全是这类链接）。
 */
await removeTreeJunctionSafe(outDir).catch(async (err) => {
  console.error(`junction-safe 清理失败（${String(err)}），退回硬删前先解引擎根链接`);
  const enginesDir = path.join(dataDir, "engines");
  for (const engineEntry of await readdir(enginesDir, { withFileTypes: true }).catch(() => [])) {
    if (!engineEntry.isDirectory()) continue;
    for (const emp of await readdir(path.join(enginesDir, engineEntry.name), { withFileTypes: true }).catch(() => [])) {
      if (!emp.isDirectory()) continue;
      await removeTreeJunctionSafe(path.join(enginesDir, engineEntry.name, emp.name, "agent")).catch(() => {});
    }
  }
  await rm(outDir, { recursive: true, force: true });
});
await mkdir(path.join(neoHome, "library", DOMAIN, SKILL), { recursive: true });

// ── 装（fixture 落盘 + vendored CLI）───────────────────────────
// 技能正文与描述都带暗号：描述会进 pi 的 <available_skills>，正文验证文件层。
await writeFile(
  path.join(neoHome, "library", DOMAIN, SKILL, "SKILL.md"),
  `---\nname: ${SKILL}\ndescription: 学院下发链路暗号 ${MARKER} 的技能\n---\n\n正文里也有 ${MARKER}。\n`,
  "utf8",
);
neo(["create", ROLE_MAIN], "装");
neo(["create", ROLE_CTRL], "装");

// ── 下发（role set 标脏 → update 收敛；vendor/README 宿主合同）──
neo(["role", "set", ROLE_MAIN, "--domains", DOMAIN, "--json"], "下发");
neo(["update", "--role", ROLE_MAIN], "下发");

// main 角色的 MCP：stdio + env:VAR 引用（密钥只走引用；导出面对 stdio 引用不查变量存在性）。
await writeFile(
  path.join(neoHome, "roles", ROLE_MAIN, "mcp.yaml"),
  ["version: 1", "servers:", "  a04:", "    transport: stdio", "    command: node", '    args: ["-e", "0"]', "    env:", `      ${SECRET_VAR}: env:${SECRET_VAR}`, ""].join("\n"),
  "utf8",
);

// mock 模型端（请求体全文留档）+ 模型库（决策 14 后的应用级库）
const mock = await startMockModelServer({
  planReply: () => ({ frames: [{ content: "收到，处理完毕。", pauseMs: 10 }, { finish: "stop" }] }),
  completionPrefix: "chatcmpl-e2e-15",
});
await seedModelLibrary(dataDir, { baseUrl: mock.baseUrl, protocol: "openai-completions" });

const neoBefore = await realNeoFingerprint();

/**
 * @param {{ phase: string }} options
 */
async function launch(options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // 隔离铁律：应用读的是 fixture NEO_HOME；真实 ~/.neo 只读不写。
    env.NEO_HOME = neoHome;
    // 密钥：AgentHost env 里有 → 引擎 open 时注入到引擎原生渲染件。
    env[SECRET_VAR] = SECRET_VALUE;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-15-runner.mjs");
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

const started = Date.now();
console.log("ticket a04 e2e · phase flow（装→下发→招聘→派活→正反上下文断言）");
const code = await launch({ phase: "flow" });
const flow = await readJson(path.join(outDir, "flow.json"));

// ── 上下文正反断言：打在 mock server 收到的原始请求体上 ────────
const mainReqs = mock.requests.filter((r) => r.raw.includes(MSG_MAIN) || r.raw.includes(MSG_MAIN2));
const ctrlReqs = mock.requests.filter((r) => r.raw.includes(MSG_CTRL));
/** @type {{ name: string, ok: boolean, detail?: string }[]} */
const contextChecks = [];
contextChecks.push({
  name: "上下文: 两个员工的 run 都真的到了模型端（main≥2 含第二张工单，ctrl≥1）",
  ok: mainReqs.length >= 2 && ctrlReqs.length >= 1,
  detail: `main=${mainReqs.length} ctrl=${ctrlReqs.length}`,
});
contextChecks.push({
  name: `上下文(正): 主员工的请求上下文含 ${MARKER}（断言在 mock 收到的原始请求上，不靠模型复述）`,
  ok: mainReqs.length > 0 && mainReqs.every((r) => r.raw.includes(MARKER)),
  detail: mainReqs.length > 0 ? `req0 bytes=${mainReqs[0].raw.length} marker=${mainReqs[0].raw.includes(MARKER)}` : "no request",
});
contextChecks.push({
  name: `上下文(反): 对照角色的员工请求上下文不含 ${MARKER}`,
  ok: ctrlReqs.length > 0 && ctrlReqs.every((r) => !r.raw.includes(MARKER)),
  detail: ctrlReqs.length > 0 ? `req0 marker=${ctrlReqs[0].raw.includes(MARKER)}` : "no request",
});
// 密钥卫生：原始请求里也不该被 neo 导出面塞进 mcp 密钥（materialize --no-auth + 导出剥离）
contextChecks.push({
  name: `上下文(卫): 模型请求里不泄漏 ${SECRET_VAR} 的值`,
  ok: mock.requests.every((r) => !r.raw.includes(SECRET_VALUE)),
});

// ── 隔离断言：真实 ~/.neo 前后指纹不变 ─────────────────────────
const neoAfter = await realNeoFingerprint();
const neoSame = JSON.stringify(neoBefore) === JSON.stringify(neoAfter);
contextChecks.push({
  name: "隔离: 真实 ~/.neo 的 mtime/内容前后不变（fixture NEO_HOME=tmp/e2e-15/neo）",
  ok: neoSame,
  detail: `before=${JSON.stringify(neoBefore)} after=${JSON.stringify(neoAfter)}`,
});

await writeFile(
  path.join(outDir, "summary.json"),
  `${JSON.stringify(
    {
      phase: "flow",
      appExitCode: code,
      contextChecks,
      mockRequests: mock.requests.map((r) => ({ messageCount: r.messageCount, userPreview: r.userPreview, bytes: r.raw.length })),
      realNeoBefore: neoBefore,
      realNeoAfter: neoAfter,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await mock.close();

const flowOk = code === 0 && printChecks("flow", flow);
const ctxOk = printChecks("context+isolation", { checks: contextChecks });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (flowOk && ctxOk) {
  console.log(`\nPASS · ticket a04 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-15/flow.json + tmp/e2e-15/summary.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
