/**
 * Ticket 05 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:05
 *
 * Phase "workorder" (scripts/e2e-05-runner.mjs): the 工单台 flow end to
 * end — one sentence → playbook 加功能 (editable) → 派单 records the start
 * HEAD → the scripted model works with REAL tools inside the AgentHost
 * (bash/write; tests via node --test; the employee commits by itself) →
 * the four artifacts show up → a non-git workspace is refused with an
 * honest message.
 *
 * Orchestrator-side proofs (this file, plain Node — where external git is
 * allowed and observable):
 *  - HEAD advanced by exactly ONE new commit, authored by the employee's
 *    engine identity (the app never commits: 提交由员工自己产生);
 *  - the app's own git audit contains only read-only commands, and its
 *    diff commands point AT the recorded start HEAD (产出 diff 是相对起点的).
 *
 * Raw evidence: tmp/e2e-05/{workorder,git-proof}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer05 } from "./e2e-05-mock-server.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-05");
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
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-05-runner.mjs");
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

/** Read-only verbs the app's git door may ever use. */
const READ_ONLY = ["rev-parse", "diff", "status", "log", "show", "ls-files"];
/** Anything that would mutate the repository. */
const WRITE_VERBS = ["add", "commit", "push", "pull", "reset", "checkout", "merge", "rebase", "init", "config", "rm", "mv", "apply", "tag", "stash", "clean"];

/**
 * @param {string} workspaceDir
 * @param {string[]} args
 */
function git(workspaceDir, args) {
  const { execFileSync } = require("node:child_process");
  return execFileSync("git", ["-C", workspaceDir, ...args], { encoding: "utf8" }).trim();
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// BYOK engine config pointed at the local mock — same trick as ticket 04.
const mock = await startMockModelServer05();
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

console.log("ticket 05 e2e · phase workorder (工单：一句话→playbook→四件套→git 只读)");
const code = await launch({ phase: "workorder" });
const phaseResult = await readJson(path.join(outDir, "workorder.json"));
const phaseOk = code === 0 && printChecks("workorder", phaseResult);

// — orchestrator proofs (plain Node): who REALLY made the commit —
const proof = /** @type {{ name: string, ok: boolean, detail?: string }[]} */ ([]);
const evidence = /** @type {any} */ (phaseResult?.evidence ?? {});
try {
  const workspaceDir = String(evidence.workspaceDir ?? "");
  const headBefore = String(evidence.headBefore ?? "");
  if (workspaceDir && headBefore && existsSync(workspaceDir)) {
    const author = git(workspaceDir, ["log", "-1", "--format=%an|%ae"]);
    proof.push({
      name: "提交由员工（引擎）自己产生：新 HEAD 的作者是引擎身份 pi-employee",
      ok: author === "pi-employee|pi-employee@cubicle.test",
      detail: author,
    });
    const newCommits = git(workspaceDir, ["rev-list", "--count", `${headBefore}..HEAD`]);
    proof.push({
      name: "起点之后恰好一条新提交（应用全程没写 git）",
      ok: newCommits === "1",
      detail: `${headBefore.slice(0, 7)}..HEAD = ${newCommits} commit(s)`,
    });
    const greet = git(workspaceDir, ["show", "HEAD:greet.txt"]);
    proof.push({ name: "员工的改动已在工作区历史里（greet.txt 含欢迎语）", ok: greet.includes("welcome from cubicle"), detail: greet.replace(/\n/g, " ⏎ ") });

    const audit = /** @type {string[]} */ (evidence.gitAudit ?? []);
    const readOnlyOk =
      audit.length > 0 &&
      audit.every((line) => READ_ONLY.some((verb) => new RegExp(`\\s(${verb})(\\s|$)`).test(line))) &&
      audit.every((line) => !WRITE_VERBS.some((verb) => new RegExp(`\\s(${verb})(\\s|$)`).test(line)));
    const diffAgainstBase = audit.some((line) => line.includes(" diff ") && line.includes(headBefore));
    proof.push({
      name: "应用的 git 审计：全部只读命令，零写操作",
      ok: readOnlyOk,
      detail: `${audit.length} commands: ${audit.map((c) => c.replace(/^git -C \S+ /, "")).join(" | ").slice(0, 120)}`,
    });
    proof.push({ name: "产出 diff 确实是相对起点 HEAD 算的", ok: diffAgainstBase, detail: audit.find((line) => line.includes(" diff ")) ?? "(无 diff 命令)" });
  } else {
    proof.push({ name: "orchestrator proofs: evidence missing workspaceDir/headBefore", ok: false, detail: JSON.stringify(evidence).slice(0, 160) });
  }
} catch (err) {
  proof.push({ name: "orchestrator proofs crashed", ok: false, detail: String(err) });
}

await writeFile(path.join(outDir, "git-proof.json"), `${JSON.stringify({ checks: proof, evidence }, null, 2)}\n`, "utf8");
for (const check of proof) {
  console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}

await mock.close();

const proofsOk = proof.length > 0 && proof.every((check) => check.ok);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (phaseOk && proofsOk) {
  console.log(`\nPASS · ticket 05 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-05/{workorder,git-proof}.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
