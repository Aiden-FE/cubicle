/**
 * Ticket 14 acceptance run — settings + model library + DSH Desktop.
 *
 *   npm run build:renderer && npm run e2e:14
 *
 * Phase "settings": empty library (a deliberately invalid legacy pi
 * models.json is ignored), add a Responses provider + model through the
 * Settings UI, test the connection, risk-enable the installed DSH desktop,
 * hire an employee with dsh/model/reasoning and run one real ACP turn.
 * Phase "resume": fresh process on the same data dir — one more sentence must
 * resume the same ACP session id and complete.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { printChecks, readJson } from "./e2e-harness.mjs";
import { startCodexResponsesMock } from "./e2e-codex-responses-mock.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-14");
const dataDir = path.join(outDir, "data");
const mainPath = path.join(root, "src", "main", "index.mjs");

const rendererIndex = path.join(root, "dist", "renderer", "index.html");
if (!existsSync(rendererIndex)) {
  console.error("renderer not built — run: npm run build:renderer");
  process.exit(1);
}

/** @param {{ phase: "settings" | "resume" }} options */
async function launch(options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.CUBICLE_E2E_PHASE = options.phase;
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-14-runner.mjs");
    env.CUBICLE_E2E_OUT_DIR = outDir;
    env.CUBICLE_DATA_DIR = dataDir;
    env.CUBICLE_E2E_DSH_BASE_URL = mock.baseUrl;
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
// A legacy per-engine file that must be ignored, not imported. It is invalid
// JSON on purpose: if the app read it, any pi path would fail loudly.
await mkdir(path.join(dataDir, "engines", "pi"), { recursive: true });
await writeFile(path.join(dataDir, "engines", "pi", "models.json"), "{not-json", "utf8");

const mock = await startCodexResponsesMock();

console.log("ticket 14 e2e · phase settings（设置入口/模型库表单/测试连接/招聘选模型/真实 dsh ACP）");
const firstCode = await launch({ phase: "settings" });
const first = await readJson(path.join(outDir, "e2e-14-settings.json"));
const firstOk = firstCode === 0 && printChecks("settings", first);

/** @type {any[]} */
const proof = [];
let sessionBefore = "";
let runsBefore = 0;
try {
  const db = new DatabaseSync(path.join(dataDir, "cubicle.db"), { readOnly: true });
  const session = /** @type {any} */ (db.prepare("SELECT * FROM employee_session WHERE engine = 'dsh' ORDER BY id LIMIT 1").get());
  const runs = /** @type {any[]} */ (db.prepare("SELECT id, engine, status FROM run ORDER BY id").all());
  const employee = /** @type {any} */ (db.prepare("SELECT id, name, role_snapshot FROM employee ORDER BY id LIMIT 1").get());
  // 票 a01 后 role_snapshot v2：engine/provider/model/reasoningEffort 是顶层钉选。
  const snapshot = employee ? JSON.parse(employee.role_snapshot) : null;
  sessionBefore = String(session?.session_file ?? "");
  runsBefore = runs.length;
  proof.push({
    name: "dsh 员工的会话实体指针是 acp:<uuid>",
    ok: sessionBefore.startsWith("acp:"),
    detail: sessionBefore,
  });
  proof.push({
    name: "dsh 第一轮真实运行落库 completed",
    ok: runs.some((run) => run.engine === "dsh" && run.status === "completed"),
    detail: JSON.stringify(runs),
  });
  proof.push({
    name: "员工快照冻结了 engine/provider/model/reasoningEffort",
    ok:
      snapshot?.engine === "dsh" &&
      snapshot?.provider === "e2e-dsh-gateway" &&
      snapshot?.model === "cubicle-dsh-model" &&
      snapshot?.reasoningEffort === "high",
    detail: JSON.stringify(snapshot),
  });
  // 票 a02：共享 engines/dsh/home 已废 —— profile 落在员工自己的 DSH_HOME 下。
  const empId = Number(session?.employee_id ?? employee?.id ?? 0);
  const patch = await readFile(path.join(dataDir, "engines", "dsh", `employee-${empId}`, "agent", "profiles", "acp", "cordis.patch.yml"), "utf8");
  proof.push({
    name: "DSH profile 在 Cubicle 数据目录内，用 apiKeyEnv 而不是明文 key",
    ok: patch.includes("apiKeyEnv") && !patch.includes("e2e-dsh-key") && patch.includes("cubicle-dsh-model"),
    detail: patch.slice(0, 160),
  });
  db.close();
} catch (err) {
  proof.push({ name: "DB/proof read", ok: false, detail: err instanceof MessagePort ? String(err) : String(err) });
}

if (firstOk) {
  console.log("ticket 14 e2e · phase resume（重启后同一 ACP 会话续跑）");
  const secondCode = await launch({ phase: "resume" });
  const second = await readJson(path.join(outDir, "e2e-14-resume.json"));
  const secondOk = secondCode === 0 && printChecks("resume", second);

  try {
    const db = new DatabaseSync(path.join(dataDir, "cubicle.db"), { readOnly: true });
    const session = /** @type {any} */ (db.prepare("SELECT * FROM employee_session WHERE engine = 'dsh' ORDER BY id LIMIT 1").get());
    const runs = /** @type {any[]} */ (db.prepare("SELECT id, engine, status FROM run ORDER BY id").all());
    proof.push({
      name: "重启后仍是同一个 dsh ACP 会话（session_file 未变）",
      ok: String(session?.session_file ?? "") === sessionBefore,
      detail: `${sessionBefore} → ${String(session?.session_file ?? "")}`,
    });
    proof.push({
      name: "重启后新增一轮 dsh completed（runs +1）",
      ok: runs.length === runsBefore + 1 && runs.at(-1)?.engine === "dsh" && runs.at(-1)?.status === "completed",
      detail: `${runsBefore} → ${runs.length}`,
    });
    db.close();
  } catch (err) {
    proof.push({ name: "resume proof read", ok: false, detail: String(err) });
  }

  await writeFile(path.join(outDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  for (const entry of proof) console.log(`  ${entry.ok ? "ok  " : "FAIL"}  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
  const allProof = proof.every((entry) => entry.ok);
  await mock.close();
  if (firstOk && secondOk && allProof) {
    console.log("\nPASS · ticket 14 acceptance");
    process.exit(0);
  }
  console.log("\nFAIL · read tmp/e2e-14/*.json");
  process.exit(1);
}

await writeFile(path.join(outDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
await mock.close();
console.log("\nFAIL · settings phase failed; read tmp/e2e-14/e2e-14-settings.json");
process.exit(1);
