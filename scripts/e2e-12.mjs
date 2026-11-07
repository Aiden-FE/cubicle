/**
 * Ticket 12 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:12
 *
 * Phase "cost" (scripts/e2e-12-runner.mjs): one continuous office story in
 * the live UI —
 *  A. 坏模型路径 → run 失败 → 人话原因 + 一键重试 → 新会话、历史与产出保留；
 *  B. 小预算(500) 工单：80% 黄点 → 100% host 自动暂停（复用 09 的 paused 落盘）
 *     → 一键「+50%」(→750 落库) 当场续跑收尾；
 *  C. 不报 usage 的 mock → 任务显示「未计量」而非 0；
 *  D. 三层 token：任务侧边栏（80%/100% 标记）+ 员工名牌 + 公司面板。
 *
 * Orchestrator-side proofs (this file, plain Node, DB read AFTER the host
 * exited — the single writer's rows, exactly as disk has them):
 *  - 失败的人话原因落在 run 行：一行、含错误码、无堆栈帧；
 *  - 重试追加新会话（两轮会话、四件套 ×2），旧一轮状态原样；
 *  - 预算到顶：run=paused、task_session=paused、task 仍 running、budget=750、
 *    续跑轮 completed（+50% 落库可再审）；
 *  - 未计量工单的所有 run usage 都是 NULL（不是 0）。
 *
 * Raw evidence: tmp/e2e-12/{cost,db-proof}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer12, modelsJson } from "./e2e-12-mock-server.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-12");
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
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-12-runner.mjs");
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

// BYOK engine config pointed at the local mock — healthy at boot; the runner
// swaps the provider key mid-story to fake the 坏模型路径 (ticket 12 验收 1).
const mock = await startMockModelServer12();
await mkdir(path.join(dataDir, "engines", "pi"), { recursive: true });
await writeFile(path.join(dataDir, "engines", "pi", "models.json"), modelsJson(mock.baseUrl, true), "utf8");

const started = Date.now();

console.log("ticket 12 e2e · phase cost（人话失败+重试保历史；80% 黄点→100% 自动暂停→+50% 续跑；未计量；三层 token）");
const code = await launch({ phase: "cost" });
const phaseResult = await readJson(path.join(outDir, "cost.json"));
const phaseOk = code === 0 && printChecks("cost", phaseResult);

// — orchestrator proofs (plain Node): the rows on disk say the same story —
const proof = /** @type {{ name: string, ok: boolean, detail?: string }[]} */ ([]);
const evidence = /** @type {any} */ (phaseResult?.evidence ?? {});
try {
  const db = new DatabaseSync(path.join(dataDir, "cubicle.db"), { readOnly: true });
  const failTaskId = Number(evidence.failTaskId ?? 0);
  const burnTaskId = Number(evidence.burnTaskId ?? 0);
  const unmeasuredTaskId = Number(evidence.unmeasuredTaskId ?? 0);

  const failRuns = db.prepare("SELECT status, fail_reason, usage FROM run WHERE task_id = ? ORDER BY id").all(failTaskId);
  const firstFail = /** @type {any} */ (failRuns[0] ?? {});
  proof.push({
    name: "失败轮 run=failed 且 fail_reason 是人话（含错误码、单行、无堆栈帧）",
    ok:
      failRuns.length === 2 &&
      firstFail.status === "failed" &&
      String(firstFail.fail_reason ?? "").includes("engine_model_missing") &&
      !String(firstFail.fail_reason ?? "").includes("\n    at "),
    detail: String(firstFail.fail_reason ?? "").slice(0, 110),
  });
  const failSessions = db.prepare("SELECT status FROM task_session WHERE task_id = ? ORDER BY id").all(failTaskId);
  const failArtifacts = db.prepare("SELECT COUNT(*) AS n FROM artifact WHERE task_id = ?").get(failTaskId);
  proof.push({
    name: "重试 = 追加新会话：第 1 轮 failed 原样 + 第 2 轮 completed，产出累加不覆盖",
    ok:
      failSessions.length === 2 &&
      /** @type {any} */ (failSessions[0]).status === "failed" &&
      /** @type {any} */ (failSessions[1]).status === "completed" &&
      Number(/** @type {any} */ (failArtifacts).n) >= 8,
    detail: `sessions=${failSessions.map((s) => /** @type {any} */ (s).status).join(",")} artifacts=${/** @type {any} */ (failArtifacts).n}`,
  });

  const burnTask = /** @type {any} */ (db.prepare("SELECT status, token_budget FROM task WHERE id = ?").get(burnTaskId));
  const burnRuns = db.prepare("SELECT status, usage FROM run WHERE task_id = ? ORDER BY id").all(burnTaskId);
  const burnSessions = db.prepare("SELECT status FROM task_session WHERE task_id = ? ORDER BY id").all(burnTaskId);
  proof.push({
    name: "预算到顶：run paused（09 落盘层）+ 续跑轮 completed；task 仍 running 无第六态",
    ok:
      /** @type {any} */ (burnRuns[0])?.status === "paused" &&
      /** @type {any} */ (burnRuns[1])?.status === "completed" &&
      /** @type {any} */ (burnSessions[0])?.status === "paused" &&
      (burnTask?.status === "running" || burnTask?.status === "review"),
    detail: `runs=${burnRuns.map((r) => /** @type {any} */ (r).status).join(",")} task=${burnTask?.status}`,
  });
  proof.push({
    name: "+50% 落库可再审：task.token_budget = 750；到顶轮的 usage 已落库（账单不说谎）",
    ok: burnTask?.token_budget === 750 && /** @type {any} */ (burnRuns[0])?.usage !== null,
    detail: `budget=${burnTask?.token_budget} usage=${String(/** @type {any} */ (burnRuns[0])?.usage).slice(0, 80)}`,
  });

  const unmeasuredRuns = db.prepare("SELECT usage FROM run WHERE task_id = ?").all(unmeasuredTaskId);
  proof.push({
    name: "未计量工单：所有 run 的 usage 都是 NULL（不是 0）——显示层才有资格写「未计量」",
    ok: unmeasuredRuns.length > 0 && unmeasuredRuns.every((r) => /** @type {any} */ (r).usage === null),
    detail: unmeasuredRuns.map((r) => String(/** @type {any} */ (r).usage)).join(","),
  });

  db.close();
} catch (err) {
  proof.push({ name: "orchestrator DB proofs crashed", ok: false, detail: String(err) });
}

await writeFile(path.join(outDir, "db-proof.json"), `${JSON.stringify({ checks: proof, evidence }, null, 2)}\n`, "utf8");
for (const check of proof) {
  console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}

await mock.close();

const proofsOk = proof.length > 0 && proof.every((check) => check.ok);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (phaseOk && proofsOk) {
  console.log(`\nPASS · ticket 12 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-12/{cost,db-proof}.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
