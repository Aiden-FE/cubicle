/**
 * Ticket 09 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:09
 *
 * Two Electron launches share one data dir (same create/verify dance as
 * ticket 02 — here it IS the restart story):
 *
 *  1) phase "duty" (exit choice 0 = 直接退):
 *     时间表可配到秒 + 宽限可配（验收 1）、宽限内工具照常、宽限到期 run 落
 *     paused 挂暂停徽标（验收 3）、暂停后 0 新工具调用（验收 5）、手动
 *     override 立即生效且不改时间表（验收 2）、窗口关闭出现三选（脚本点
 *     「直接退」），pauseAll 下班落盘完成后窗口才销毁（验收 4）。
 *  2) orchestrator 亲眼看库（plain Node + node:sqlite）：直接退之后
 *     run=paused / task_session=paused / task=running / 时间表行都在 ——
 *     「直接退会先执行下班落盘」不是口头保证，是磁盘事实。
 *  3) phase "resume" (exit choice 2 = 取消):
 *     重启后暂停徽标与两轮 paused 会话还在（验收 3 后半）、立即上班续跑
 *     工具恢复、三选里选「取消」窗口照开（验收 4 另一半）。
 *
 * Raw evidence: tmp/e2e-09/{duty,resume,exit-dialog,db-proof}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer09 } from "./e2e-09-mock-server.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-09");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/**
 * @param {{ phase: string, exitChoice: number }} options
 */
async function launch(options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-09-runner.mjs");
    env.CUBICLE_E2E_OUT_DIR = outDir;
    env.CUBICLE_DATA_DIR = dataDir;
    // The three-choice dialog is REAL (native, with its three buttons); the
    // human finger is scripted: main records the buttons it actually showed
    // to exit-dialog.json, then clicks the requested one.
    env.CUBICLE_E2E_EXIT_CHOICE = String(options.exitChoice);
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

// BYOK engine config pointed at the local mock — same trick as tickets 04-08.
const mock = await startMockModelServer09();
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

console.log("ticket 09 e2e · phase duty（可配班表到秒 / 90s 可配宽限 / paused 落盘与徽标 / override 不改表 / 退出三选=直接退）");
const dutyCode = await launch({ phase: "duty", exitChoice: 0 });
const dutyResult = await readJson(path.join(outDir, "duty.json"));
const dutyOk = dutyCode === 0 && printChecks("duty", dutyResult);

// — orchestrator proofs (plain Node): 「直接退」的下班落盘是磁盘事实 —
const proof = /** @type {{ name: string, ok: boolean, detail?: string }[]} */ ([]);
const evidence = /** @type {any} */ (dutyResult?.evidence ?? {});
try {
  const db = new DatabaseSync(path.join(dataDir, "cubicle.db"));
  /**
   * @param {string} sql
   * @param {...any} args
   * @returns {Record<string, unknown> | undefined}
   */
  const one = (sql, ...args) => db.prepare(sql).get(...args);

  const lastRun = one("SELECT id, status FROM run ORDER BY id DESC LIMIT 1");
  proof.push({
    name: "直接退之后：最后一条 run 在库里就是 paused（pauseAll 先落库，进程后死）",
    ok: String(lastRun?.status) === "paused",
    detail: `run#${lastRun?.id}=${lastRun?.status}`,
  });
  const lastSession = one("SELECT id, status FROM task_session ORDER BY id DESC LIMIT 1");
  proof.push({
    name: "最后一条 task_session = paused（暂停落在会话层）",
    ok: String(lastSession?.status) === "paused",
    detail: `task_session#${lastSession?.id}=${lastSession?.status}`,
  });
  const task = one("SELECT id, status FROM task ORDER BY id DESC LIMIT 1");
  proof.push({
    name: "五状态没有第六态：任务仍是 running（暂停只是徽标）",
    ok: String(task?.status) === "running",
    detail: `task#${task?.id}=${task?.status}`,
  });
  const scheduleRow = one("SELECT work_start, work_end, grace_seconds FROM company_schedule ORDER BY company_id LIMIT 1");
  proof.push({
    name: "时间表配置行落库（可改的时刻 + 可配宽限）",
    ok:
      String(scheduleRow?.work_start) === "00:00" &&
      String(scheduleRow?.work_end) === String(evidence.workEnd ?? "") &&
      Number(scheduleRow?.grace_seconds) === 5,
    detail: JSON.stringify(scheduleRow),
  });
  const pausedCount = one("SELECT COUNT(*) AS n FROM task_session WHERE status = 'paused'");
  proof.push({
    name: "两轮都落了 paused（宽限到期一轮 + 退出直接退一轮）→ 重启后可续跑",
    ok: Number(pausedCount?.n) >= 2,
    detail: `paused sessions=${pausedCount?.n}`,
  });
  db.close();
} catch (err) {
  proof.push({ name: "db proof crashed", ok: false, detail: String(err) });
}

// The three-choice dialog was REAL: main wrote the exact buttons it showed.
try {
  const lines = (await readFile(path.join(outDir, "exit-dialog.json"), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  proof.push({
    name: "退出对话框确实出现且是三选：直接退 / 等完成 / 取消（每次关闭都记录在案）",
    ok:
      lines.length >= 1 &&
      lines.every((/** @type {any} */ line) => JSON.stringify(line.buttons) === JSON.stringify(["直接退", "等完成", "取消"])),
    detail: lines.map((/** @type {any} */ line, /** @type {number} */ i) => `#${i} choice=${line.choice}`).join(" "),
  });
} catch (err) {
  proof.push({ name: "exit dialog evidence missing", ok: false, detail: String(err) });
}

await writeFile(path.join(outDir, "db-proof.json"), `${JSON.stringify({ checks: proof }, null, 2)}\n`, "utf8");
for (const check of proof) {
  console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}

console.log("\nticket 09 e2e · phase resume（重启后暂停还在 / 立即上班续跑 / 三选取消=窗口照开）");
const resumeCode = await launch({ phase: "resume", exitChoice: 2 });
const resumeResult = await readJson(path.join(outDir, "resume.json"));
const resumeOk = resumeCode === 0 && printChecks("resume", resumeResult);

// The cancel path must ALSO be in the dialog evidence.
try {
  const lines = (await readFile(path.join(outDir, "exit-dialog.json"), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  const cancelSeen = lines.some((/** @type {any} */ line) => line.choice === 2);
  console.log(`  ${cancelSeen ? "ok  " : "FAIL"}  第二次关闭选了「取消」（choice=2 有记录）`);
  if (!cancelSeen) process.exitCode = 1;
} catch {
  console.log("  FAIL  exit dialog evidence unreadable for the cancel phase");
  process.exitCode = 1;
}

await writeFile(path.join(outDir, "model-requests.json"), `${JSON.stringify(mock.requests, null, 2)}\n`, "utf8");
await mock.close();

const proofsOk = proof.length > 0 && proof.every((check) => check.ok);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (dutyOk && resumeOk && proofsOk) {
  console.log(`\nPASS · ticket 09 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-09/{duty,resume,db-proof,exit-dialog}.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
