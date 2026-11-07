/**
 * Ticket 10 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:10        (需真 codex：CUBICLE_CODEX_PATH)
 *
 * Two Electron launches share one data dir (the restart story), and the kill
 * is REAL: the orchestrator taskkill /F's the Electron MAIN pid (no /T — a
 * force kill runs nobody's exit hooks, exactly the ticket's premise).
 *
 *  1) phase "crash": 4 张慢活真在飞（3× pi 永不自收尾 + 1× codex 睡眠循环）。
 *     orchestrator 等 crash-ready.json → CIM 采样确认现场（utility 子进程、
 *     codex.exe 挂在 AgentHost 下、children.json 有行）→ taskkill /F 强杀 main。
 *  2) 强杀后现场（CIM 亲眼看）：AgentHost utilityProcess 成孤儿还活着、
 *     codex.exe 孤儿仍在飞、账本仍写着 pid —— 崩溃现场有孤儿，这就是要被扫的。
 *  3) orchestrator 把 T3 的恢复指针清掉（模拟会话文件丢失：库里 session_file
 *     置 NULL + 尽力删文件）——「不支持恢复就只给重跑」的第二半。
 *  4) phase "recover": 启动即扫账（孤儿宿主 + 孤儿 codex 全清，CIM 复采归零）；
 *     开库自愈 + 不自动续跑 → 中断列表 4 张 → 把手浮层三选 → T1 续跑（工具事件
 *     恢复）、T2/T3 重跑、T4 放弃进失败归档历史保留。
 *  5) orchestrator 亲眼看库 + 账本文件：自愈痕迹、三选结果、children.json 清零。
 *
 * Raw evidence: tmp/e2e-10/{crash-ready,recover,crash-samples,recover-samples,db-proof}.json.
 */
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer, lastUserText } from "./e2e-mock-model-server.mjs";
import { startCodexResponsesMock } from "./e2e-codex-responses-mock.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-10");
const mainPath = path.join(root, "src", "main", "index.mjs");
const dataDir = path.join(outDir, "data");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

const realCodex = process.env.CUBICLE_CODEX_PATH || findCodex() || "";
if (!realCodex) {
  console.error("codex CLI not found (set CUBICLE_CODEX_PATH); ticket 10 e2e needs the real codex host for the orphan sweep");
  process.exit(1);
}

/** @returns {string | null} */
function findCodex() {
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";");
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const base of ["codex", "codex.exe", "codex.cmd"]) {
      const candidate = path.join(dir, base);
      if (existsSync(candidate)) return candidate;
      for (const ext of exts) if (existsSync(`${candidate}${ext}`)) return `${candidate}${ext}`;
    }
  }
  return null;
}

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 某 pid 名下全部活孩子（不带名字过滤）：崩溃现场的孤儿以实际树形为准（tasklist 本机不可靠，CIM 是 11 票钉过的探针）。 */
/** @param {number} parentPid @returns {Promise<{ pid: number, name: string }[]>} */
function cimChildren(parentPid) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | ForEach-Object { '{0}|{1}' -f $_.Name, $_.ProcessId }`,
      ],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        /** @type {{ pid: number, name: string }[]} */
        const kids = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const sep = line.indexOf("|");
          if (sep === -1) continue;
          const name = line.slice(0, sep).trim();
          const pid = Number(line.slice(sep + 1).trim());
          if (name.length > 0 && Number.isInteger(pid) && pid > 0) kids.push({ pid, name });
        }
        resolve(kids);
      },
    );
  });
}

/** @param {number} pid @returns {Promise<boolean>} */
async function processAlive(pid) {
  const n = await new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `( @(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").Count )`],
      { windowsHide: true },
      (err, stdout) => resolve(err ? -1 : Number(String(stdout).trim())),
    );
  });
  return n >= 1;
}

/** @param {{ phase: string }} options @returns {{ child: import("node:child_process").ChildProcess, exited: Promise<number> }} */
function launch(options) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.CUBICLE_E2E_PHASE = options.phase;
  env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-10-runner.mjs");
  env.CUBICLE_E2E_OUT_DIR = outDir;
  env.CUBICLE_DATA_DIR = dataDir;
  env.CUBICLE_CODEX_PATH = realCodex;
  const extraFlags = process.env.CUBICLE_E2E_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
  const child = spawn(electronBinary, [...extraFlags, mainPath, "--cubicle-e2e"], { cwd: root, env, stdio: "inherit" });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
  return { child, exited };
}

/** @param {string} file @param {number} timeoutMs */
async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * @param {string} target
 */
async function removeTolerant(target) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch {
      await sleep(250);
    }
  }
}

await removeTolerant(outDir);
await mkdir(outDir, { recursive: true });

// BYOK：两引擎都指向本地 mock（模型侧是 mock，引擎与进程是真的 — 11 票先例）。
// pi mock 的慢活节拍改成 30 秒 powershell：宿主被强杀后这个工具进程是
// **真实、持久的孤儿**（父进程死、自己不盯管道），让重启扫账有真东西可杀。
const piMock = await startMockModelServer({
  completionPrefix: "chatcmpl-e2e-10",
  chunkPauseMs: 10,
  planReply: (/** @type {any[]} */ messages) => {
    const user = lastUserText(messages);
    if (!user.includes("慢")) {
      return { frames: [{ content: "收到。", pauseMs: 10 }, { finish: "stop" }] };
    }
    const lastIndex = messages.map((message) => message?.role).lastIndexOf("user");
    const step = messages.slice(lastIndex + 1).filter((message) => message?.role === "tool").length;
    return {
      frames: [
        { content: `慢工节拍 ${step + 1}……`, pauseMs: 200 },
        {
          toolCall: {
            id: `call_10_beat_${step + 1}`,
            name: "powershell",
            args: '{"command":"Start-Sleep -Seconds 30; echo ticket-10-beat"}',
          },
        },
        { finish: "tool_calls" },
      ],
      slow: true,
    };
  },
});
const codexMock = await startCodexResponsesMock({
  planner: (/** @type {any} */ body) => {
    const text = JSON.stringify(body?.input ?? "");
    if (text.includes("慢一点")) {
      return {
        items: [
          {
            type: "function_call",
            name: "exec_command",
            callId: `call_slow_${Date.now()}`,
            arguments: JSON.stringify({ cmd: 'powershell -NoProfile -Command "Start-Sleep -Seconds 30; Get-Content hello.txt"' }),
          },
        ],
      };
    }
    return { items: [{ type: "message", chunks: ["收到（codex）。"] }] };
  },
});
await mkdir(path.join(dataDir, "engines", "pi"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "pi", "models.json"),
  `${JSON.stringify(
    {
      $schema: "https://pi.dev/schemas/models.schema.json",
      providers: {
        cubicle: {
          name: "Cubicle E2E",
          baseUrl: piMock.baseUrl,
          api: "openai-completions",
          apiKey: "e2e-local-key",
          models: [
            { type: "chat", id: "cubicle-e2e-model", name: "E2E Model", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
          ],
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await mkdir(path.join(dataDir, "engines", "codex"), { recursive: true });
await writeFile(
  path.join(dataDir, "engines", "codex", "models.json"),
  `${JSON.stringify({ baseUrl: codexMock.baseUrl, apiKey: "e2e-codex-key", model: "cubicle-e2e-model" }, null, 2)}\n`,
  "utf8",
);

const started = Date.now();
const allProof = /** @type {{ name: string, ok: boolean, detail?: string }[]} */ ([]);
/** @param {string} name @param {unknown} ok @param {string} [detail] */
const proof = (name, ok, detail) => {
  allProof.push({ name, ok: Boolean(ok), detail: detail ?? "" });
};

// ── 启动 1：现场在飞 → 真·强杀 ─────────────────────────────────────────────
console.log("ticket 10 e2e · phase crash（4 张慢活在飞 → taskkill /F 只杀 main，不带 /T）");
const crash = launch({ phase: "crash" });
const readyOk = await waitForFile(path.join(outDir, "crash-ready.json"), 90_000);
if (!readyOk) {
  console.error("crash-ready.json never appeared — killing and failing");
  spawn("taskkill", ["/pid", String(crash.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await piMock.close();
  await codexMock.close();
  process.exit(1);
}
const ready = await readJson(path.join(outDir, "crash-ready.json"));
const crashChecksOk = printChecks("crash", ready);
const hostPid = Number(ready?.pids?.host ?? 0);
const mainPid = Number(ready?.pids?.main ?? crash.child.pid);
const tasks = /** @type {{ taskId: number, employeeId: number }[]} */ (ready?.tasks ?? []);
proof("crash 现场 runner 全查通过", ready?.allOk === true && crashChecksOk);
proof("拿到两代进程号（main + AgentHost utility）", hostPid > 0 && mainPid > 0, `main=${mainPid} host=${hostPid}`);

// 现场先证一次：账本里那个 codex pid 活着；宿主名下还挂着 pi 工具的
// powershell（30 秒睡眠）—— 强杀宿主后这些就是无主进程。
const ledgerPath = path.join(dataDir, "engines", "codex", "children.json");
/** @type {any[]} */
let ledgerBefore = [];
try {
  ledgerBefore = JSON.parse(await readFile(ledgerPath, "utf8"));
} catch {
  ledgerBefore = [];
}
const codexPid = Number(ledgerBefore[0]?.pid ?? 0);
const codexAliveBefore = codexPid > 0 && (await processAlive(codexPid));
const hostKidsBefore = await cimChildren(hostPid);
const codexKidsBefore = codexPid > 0 ? await cimChildren(codexPid) : [];
proof("强杀前：账本里的 codex pid 活着；宿主名下有真子进程树（工具 shell/git 等）", codexAliveBefore && hostKidsBefore.length >= 1, `codexPid=${codexPid} alive=${codexAliveBefore} host kids=${JSON.stringify(hostKidsBefore)} codex kids=${JSON.stringify(codexKidsBefore)}`);

// 真·强杀：taskkill /F AgentHost（utilityProcess，不带 /T）——它的
// process.on("exit")/killChildrenSync 不会跑：codex/工具进程当场成孤儿、
// exit 钩子没人 forget。这就是账本要收的崩溃现场。
spawn("taskkill", ["/pid", String(hostPid), "/F"], { windowsHide: true, stdio: "ignore" });
// 账本立刻采一次（supervisor ~1s 后会重启宿主，新宿主开机扫账可能比 main 死还早
// 把条目吃掉 —— 那是「不用重启 app 也自愈」的更强证据，允许两种结局都成立）。
let ledgerJustAfterKill = /** @type {any[]} */ ([]);
try {
  ledgerJustAfterKill = JSON.parse(await readFile(ledgerPath, "utf8"));
} catch {
  ledgerJustAfterKill = [];
}
await sleep(1200);

const hostAliveAfterKill = await processAlive(hostPid);
const orphanKids = await cimChildren(hostPid); // 死宿主名下任何活孩子都是孤儿
const codexOrphanKids = codexPid > 0 ? await cimChildren(codexPid) : [];
const codexAliveAfter = codexPid > 0 && (await processAlive(codexPid));
let ledger = ledgerJustAfterKill;
try {
  ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
} catch {
  ledger = [];
}
const orphanTotal = orphanKids.length + (codexAliveAfter ? 1 : 0) + codexOrphanKids.length;
proof(
  "强杀 AgentHost 后现场有孤儿：死宿主 pid 名下仍有活进程（工具 shell/git 等，父死子不知）",
  orphanTotal >= 1,
  `host kids=${JSON.stringify(orphanKids)}; codex alive=${codexAliveAfter} codex kids=${JSON.stringify(codexOrphanKids)}; host alive=${hostAliveAfterKill}`,
);
proof(
  "强杀后现场没人 forget（exit 钩子没跑）：账本要么还写着孤儿代 pid，要么已被新一代宿主的开机扫账吃掉（log 实证）",
  (Array.isArray(ledgerJustAfterKill) && ledgerJustAfterKill.length >= 1) || (Array.isArray(ledger) && ledger.length === 0),
  `ledger right after kill=${JSON.stringify(ledgerJustAfterKill.map((e) => e?.pid))}; later=${JSON.stringify(ledger.map((e) => e?.pid))}`,
);

// 宿主死了，supervisor 会自己把 AgentHost 拉起来（宿主重启路径）——
// 中断三选的故事等应用重启再演；这里先把 main 也强杀掉。
await sleep(1200);
spawn("taskkill", ["/pid", String(mainPid), "/F"], { windowsHide: true, stdio: "ignore" });
const crashExit = await crash.exited;
console.log(`  (Electron main 被 taskkill：exit=${crashExit})`);
await sleep(1500);
// 本机实况（写进证据）：taskkill /F main 会经由 Chromium 的 job object 级联清掉
// utility 进程 —— 「应用整体被杀」由 job 兜底；账本兜的是不级联的崩溃（宿主
// 单独被杀、电源丢失、宿主先死应用后死）。上面已证孤儿存在，下面重启扫账证归零。
const orphanKidsStill = await cimChildren(hostPid);
await writeFile(
  path.join(outDir, "crash-samples.json"),
  `${JSON.stringify({ mainPid, hostPid, codexPid, codexAliveBefore, hostKidsBefore, codexKidsBefore, hostAliveAfterKill, orphanKids, codexOrphanKids, codexAliveAfter, ledger, orphanKidsAfterMainKill: orphanKidsStill }, null, 2)}\n`,
  "utf8",
);

// T3 的恢复指针「丢」了：库置 NULL + 尽力删文件（模拟会话文件缺失）。
// tasks 里第三项 = T3（runner 按创建顺序写）。
const t3EmployeeId = Number(tasks[2]?.employeeId ?? 0);
if (t3EmployeeId > 0) {
  try {
    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec("PRAGMA busy_timeout = 8000;");
    raw.prepare("UPDATE employee_session SET session_file = NULL WHERE employee_id = ?").run(t3EmployeeId);
    raw.close();
    proof("把 T3（指针丢失剧本）的恢复指针从库里清掉", true, `employee=${t3EmployeeId}`);
  } catch (err) {
    proof("把 T3 的恢复指针从库里清掉", false, String(err));
  }
  await removeTolerant(path.join(dataDir, "engines", "pi", `employee-${t3EmployeeId}`, "sessions")).catch(() => {});
}

// ── 启动 2：开机扫账（孤儿必须归零）+ 三选 ─────────────────────────────────
console.log("ticket 10 e2e · phase recover（开机扫账 → 中断列表三选 → 放弃归档）");
const recover = launch({ phase: "recover" });

// 扫账证明：新宿主起来后，死宿主/死 codex pid 名下的孤儿被实杀、账本清空。
let sweptOk = false;
let sweptDetail = "";
const sweepDeadline = Date.now() + 30_000;
while (Date.now() < sweepDeadline) {
  const hostKidsNow = await cimChildren(hostPid);
  const codexKidsNow = codexPid > 0 ? await cimChildren(codexPid) : [];
  const codexStillAlive = codexPid > 0 && (await processAlive(codexPid));
  let ledgerNow = /** @type {any[]} */ ([]);
  try {
    ledgerNow = JSON.parse(await readFile(ledgerPath, "utf8"));
  } catch {
    ledgerNow = [];
  }
  if (hostKidsNow.length === 0 && codexKidsNow.length === 0 && !codexStillAlive && Array.isArray(ledgerNow) && ledgerNow.length === 0) {
    sweptOk = true;
    sweptDetail = `host pid=${hostPid} kids=0, codex pid=${codexPid} gone & kids=0, ledger=[]`;
    break;
  }
  await sleep(1000);
}
// 清扫日志实证：agenthost.log 里应有「swept orphan … pid=…」——
// 不是捡尸等自然老死，是对着账本 pid（本体或名下孩子）实杀。
let sweepLogLine = "";
try {
  const hostLog = await readFile(path.join(dataDir, "agenthost.log"), "utf8");
  const lines = hostLog.split(/\r?\n/).filter((line) => line.includes("swept orphan"));
  sweepLogLine = lines.join(" | ").slice(0, 400);
} catch {
  sweepLogLine = "";
}
proof("重启后不留孤儿进程：死宿主 pid 与孩子、codex pid 与孩子全部消失、children.json 清零", sweptOk, sweptDetail);
proof("清扫是对着账本实杀（agenthost.log 记录 swept orphan … pid=…）", sweepLogLine.includes("swept orphan "), sweepLogLine || "(no swept-orphan line)");
await writeFile(
  path.join(outDir, "recover-samples.json"),
  `${JSON.stringify({ sweptOk, sweptDetail, sweepLogLine, oldHostPid: hostPid, codexPid }, null, 2)}\n`,
  "utf8",
);

const recoverCode = await recover.exited;
const recoverResult = await readJson(path.join(outDir, "recover.json"));
const recoverOk = recoverCode === 0 && printChecks("recover", recoverResult);

// ── orchestrator 亲眼看库：自愈与三选都是磁盘事实 ─────────────────────────
try {
  const db = new DatabaseSync(path.join(dataDir, "cubicle.db"));
  /**
   * @param {string} sql
   * @param {...any} args
   */
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  if (tasks.length !== 4) {
    proof("crash 现场交出了 4 张任务的映射（db 证明的钥匙）", false, JSON.stringify(tasks));
  }
  const [t1, t2, t3t, t4] = /** @type {{ taskId: number, employeeId: number }[]} */ (tasks);
  const t1Row = one("SELECT id, status FROM task WHERE id = ?", t1.taskId);
  proof("T1（续跑）停在「进行中」：自愈后由 resume 通道回 running", String(t1Row?.status) === "running", `task#${t1Row?.id}=${t1Row?.status}`);
  const t1Sessions = db.prepare("SELECT status FROM task_session WHERE task_id = ? ORDER BY id").all(t1.taskId).map((r) => String(/** @type {any} */ (r).status));
  proof("T1 两轮历史：interrupted → 续跑的一轮", t1Sessions.length === 2 && t1Sessions[0] === "interrupted" && (t1Sessions[1] === "running" || t1Sessions[1] === "completed"), JSON.stringify(t1Sessions));
  const t2Row = one("SELECT status FROM task WHERE id = ?", t2.taskId);
  const t2Sessions = db.prepare("SELECT status FROM task_session WHERE task_id = ? ORDER BY id").all(t2.taskId).map((r) => String(/** @type {any} */ (r).status));
  proof("T2（重跑）新会话在「进行中」任务上追加", String(t2Row?.status) === "running" && t2Sessions.length === 2 && t2Sessions[0] === "interrupted", JSON.stringify(t2Sessions));
  const t4Row = one("SELECT status FROM task WHERE id = ?", t4.taskId);
  const t4Sessions = db.prepare("SELECT id, status FROM task_session WHERE task_id = ? ORDER BY id").all(t4.taskId);
  proof("T4（放弃）进失败归档：task=failed", String(t4Row?.status) === "failed", `task#${t4Row?.id}=${t4Row?.status}`);
  proof("T4 历史保留：崩溃那轮 interrupted 会话一行不少", t4Sessions.length >= 1 && String(t4Sessions[0]?.status) === "interrupted", JSON.stringify(t4Sessions.map((s) => (/** @type {any} */ (s)).status)));
  const healedRuns = db.prepare("SELECT COUNT(*) AS n FROM run WHERE status = 'interrupted'").get();
  proof("开库自愈钉死：崩溃遗留的 4 条 run 全落 interrupted（不静默续跑的前提）", Number(/** @type {any} */ (healedRuns)?.n) >= 4, `interrupted runs=${healedRuns?.n}`);
  db.close();
} catch (err) {
  proof("db proof crashed", false, String(err));
}

try {
  const ledgerFinal = JSON.parse(await readFile(ledgerPath, "utf8"));
  proof("清扫后账本文件是空数组（只描述一次崩溃现场）", Array.isArray(ledgerFinal) && ledgerFinal.length === 0, JSON.stringify(ledgerFinal));
} catch (err) {
  proof("清扫后账本文件可读", false, String(err));
}

await writeFile(path.join(outDir, "db-proof.json"), `${JSON.stringify({ checks: allProof }, null, 2)}\n`, "utf8");
for (const check of allProof) {
  console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}

await piMock.close();
await codexMock.close();

const proofsOk = allProof.length > 0 && allProof.every((check) => check.ok);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (recoverOk && proofsOk) {
  console.log(`\nPASS · ticket 10 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-10/{crash-ready,recover,crash-samples,recover-samples,db-proof}.json (${seconds}s total)`);
  process.exit(1);
}
