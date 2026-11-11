/**
 * Ticket 06 acceptance run — one command:
 *
 *   npm run build:renderer && npm run e2e:06
 *
 * Phase "review" (scripts/e2e-06-runner.mjs): the full 验收 loop end to end
 * in the live UI — 派单 → 跑完自动待验收 → 打回（带意见）→ 同一任务迭代 2 →
 * 通过 → 完成 + 四件套 + token 显示；对照工单演示非法转移被拒（待办→完成 /
 * 待办→打回 / 完成→打回）；慢活工单演示「取消」终止并标记失败；五个状态
 * （待办/进行中/待验收/完成/失败）全部在界面上出现过。
 *
 * Orchestrator-side proofs (this file, plain Node — where external git is
 * allowed and observable):
 *  - the employee made EXACTLY TWO commits on the task (one per iteration),
 *    both authored by the engine identity — the app still never wrote git;
 *  - 打回 really changed the work (HEAD carries the lowercase welcome);
 *  - every iteration's diff was computed against the ONE recorded start HEAD.
 *
 * Raw evidence: tmp/e2e-06/{review,git-proof}.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, printChecks } from "./e2e-harness.mjs";
import { startMockModelServer06 } from "./e2e-06-mock-server.mjs";
import { seedModelLibrary } from "./e2e-models.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));
const outDir = path.join(root, "tmp", "e2e-06");
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
    env.CUBICLE_E2E_RUNNER = path.join("scripts", "e2e-06-runner.mjs");
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

// BYOK engine config pointed at the local mock — same trick as tickets 04/05.
const mock = await startMockModelServer06();
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

console.log("ticket 06 e2e · phase review（自动待验收→打回迭代→通过→完成+四件套+token；非法转移被拒；取消→失败）");
const code = await launch({ phase: "review" });
const phaseResult = await readJson(path.join(outDir, "review.json"));
const phaseOk = code === 0 && printChecks("review", phaseResult);

// — orchestrator proofs (plain Node): the iterations really happened in git —
const proof = /** @type {{ name: string, ok: boolean, detail?: string }[]} */ ([]);
const evidence = /** @type {any} */ (phaseResult?.evidence ?? {});
try {
  const workspaceDir = String(evidence.workspaceDir ?? "");
  const headBefore = String(evidence.headBefore ?? "");
  if (workspaceDir && headBefore && existsSync(workspaceDir)) {
    const newCommits = git(workspaceDir, ["rev-list", "--count", `${headBefore}..HEAD`]);
    proof.push({
      name: "打回 = 同一任务上的第二轮提交：起点之后恰好 2 条新提交",
      ok: newCommits === "2",
      detail: `${headBefore.slice(0, 7)}..HEAD = ${newCommits} commit(s)`,
    });
    const authors = git(workspaceDir, ["log", `${headBefore}..HEAD`, "--format=%an|%ae"]);
    const uniqueAuthors = [...new Set(authors.split(/\r?\n/))];
    proof.push({
      name: "两条提交都由员工（引擎身份）自己产生，应用全程没写 git",
      ok: uniqueAuthors.length === 1 && uniqueAuthors[0] === "pi-employee|pi-employee@cubicle.test",
      detail: authors.replace(/\r?\n/g, " | "),
    });
    const headFile = git(workspaceDir, ["show", "HEAD:greet.txt"]);
    proof.push({
      name: "打回真的改到了东西：HEAD 上的欢迎语是全小写",
      ok: headFile.includes("welcome from cubicle") && !headFile.includes("Welcome from Cubicle"),
      detail: headFile.replace(/\n/g, " ⏎ "),
    });

    const audit = /** @type {string[]} */ (evidence.gitAudit ?? []);
    const readOnlyOk =
      audit.length > 0 &&
      audit.every((line) => READ_ONLY.some((verb) => new RegExp(`\\s(${verb})(\\s|$)`).test(line))) &&
      audit.every((line) => !WRITE_VERBS.some((verb) => new RegExp(`\\s(${verb})(\\s|$)`).test(line)));
    const diffsAgainstBase = audit.filter((line) => line.includes(" diff ") && line.includes(headBefore)).length;
    proof.push({
      name: "应用的 git 审计：全部只读命令，零写操作",
      ok: readOnlyOk,
      detail: `${audit.length} commands: ${audit.map((c) => c.replace(/^git -C \S+ /, "")).join(" | ").slice(0, 120)}`,
    });
    proof.push({
      name: "两轮迭代的 diff 都相对同一个任务起点 HEAD 计算",
      ok: diffsAgainstBase >= 4,
      detail: `${diffsAgainstBase} diff commands against ${headBefore.slice(0, 7)}`,
    });
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
  console.log(`\nPASS · ticket 06 acceptance (${seconds}s total)`);
  process.exit(0);
} else {
  console.log(`\nFAIL · read tmp/e2e-06/{review,git-proof}.json (Electron console output does not reach this pipe) (${seconds}s total)`);
  process.exit(1);
}
