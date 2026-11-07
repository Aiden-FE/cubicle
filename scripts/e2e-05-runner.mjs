/**
 * Ticket 05 acceptance runner — "工单与产出", driven from the Electron main
 * process but parked under scripts/ (main stays business-free).
 *
 * Phase "workorder":
 *   boot → hire a programmer + a PM → seed the programmer's workspace as a
 *   git repo with one initial commit (fixture, plain file/git ops) →
 *   open the 工单台 drawer → one sentence auto-picks the 加功能 playbook →
 *   edit goal + acceptance criteria by hand → 派单 (task.create records the
 *   start HEAD, task.dispatch runs the playbook prompt) → the scripted
 *   model drives REAL tools inside the AgentHost (bash/write) — tests run
 *   with `node --test`, and the employee commits by ITSELF via bash —
 *   → open the task: four artifacts (diff 摘要相对起点 / 变更清单 / 命令输出
 *   含测试输出 / 收尾报告) → negative path: dispatching to a non-git
 *   workspace is refused in the UI with 不是 git 仓库 → publish the app's
 *   git audit log for the orchestrator.
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
  waitFor,
  evalIn,
  click,
  typeInto,
  setSelect,
  bootAndShowOffice,
  ensureAllDaySchedule,
  hireThroughWizard,
  seedGitWorkspace,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const EMPLOYEE_NAME = "E2E 程序员甲";
const PM_NAME = "E2E 产品经理乙";
const SENTENCE = "给 greet.txt 加一行欢迎语，并保证测试通过";
const EDITED_GOAL = "给 greet.txt 加一行英文欢迎语，测试必须全绿";
const EXTRA_CRITERION = "欢迎语必须全小写";

const BENCH_OPEN_JS = `document.querySelector('[data-testid="task-bench"]') !== null`;
const PLAYBOOK_JS = `document.querySelector('[data-testid="task-playbook"]')?.textContent ?? ''`;
/** @param {number} index */
const TASK_ROW_STATUS_JS = (index) =>
  `document.querySelectorAll('[data-testid="task-row"]')[${index}]?.dataset.status ?? ''`;
const TASK_ERROR_JS = `document.querySelector('[data-testid="task-error"]')?.textContent ?? ''`;
/** @param {string} kind */
const ARTIFACT_JS = (kind) => `document.querySelector('[data-testid="artifact-${kind}"] pre')?.textContent ?? ''`;

/**
 * Type into the LAST acceptance-criteria input (the one just added).
 *
 * @param {import("electron").WebContents} contents
 * @param {string} value
 */
async function typeIntoLastAcceptance(contents, value) {
  await evalIn(
    contents,
    `(() => {
      const inputs = document.querySelectorAll('[data-testid="task-acceptance"]');
      const input = inputs[inputs.length - 1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseWorkorder(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;
  await ensureAllDaySchedule(win.webContents); // 票 09: 默认班表 09:00–18:00 下班中有 off_duty 闸；e2e 全天班表

  const first = await hireThroughWizard(contents, { roleKey: "programmer", employeeName: EMPLOYEE_NAME, backFrom2: false, backFrom3: false });
  add("招聘程序员（工单 owner）", first.confirmed);
  const second = await hireThroughWizard(contents, { roleKey: "pm", employeeName: PM_NAME, backFrom2: false, backFrom3: false });
  add("招聘产品经理（用于不可用工作区对照）", second.confirmed);
  await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 2, {
    timeoutMs: 4000,
  });

  const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const occupants = (snapshot?.desks ?? [])
    .map((/** @type {any} */ d) => d.occupant)
    .filter((/** @type {any} */ o) => o !== null);
  const programmer = occupants.find((/** @type {any} */ o) => o.name === EMPLOYEE_NAME);
  const pm = occupants.find((/** @type {any} */ o) => o.name === PM_NAME);
  const programmerId = Number(programmer?.id ?? 0);
  const pmId = Number(pm?.id ?? 0);
  add("拿到两名员工 id", programmerId > 0 && pmId > 0, `programmer=${programmerId} pm=${pmId}`);

  // Fixture: the programmer's workspace becomes a git repo (PM's stays plain).
  const dirs = enginePaths(ctx.dataDir, "pi", programmerId);
  const { headBefore } = seedGitWorkspace(dirs.workspaceDir, execFileSync);
  add("程序员工作区被种成 git 仓库（fixture，非应用行为）", /^[0-9a-f]{40}$/.test(headBefore), `head=${headBefore.slice(0, 7)}`);

  // — open the 工单台 (left rail drawer; the office stays the canvas) —
  await click(contents, '[data-testid="task-rail"]');
  const benchOpen = await waitFor(async () => (await evalIn(contents, BENCH_OPEN_JS)) === true, { timeoutMs: 3000 });
  add("左轨工单台浮层打开", benchOpen);
  if (!benchOpen) return { checks };

  // — one sentence auto-picks the playbook —
  await typeInto(contents, '[data-testid="task-sentence"]', SENTENCE);
  const chipShown = await waitFor(async () => String(await evalIn(contents, PLAYBOOK_JS)).includes("加功能"), { timeoutMs: 3000 });
  add("一句话自动套用 playbook（加功能）", chipShown, `chip=${await evalIn(contents, PLAYBOOK_JS)}`);
  const prefilledGoal = String(await evalIn(contents, `document.querySelector('[data-testid="task-goal"]')?.value ?? ''`));
  const prefilledAcceptance = String(await evalIn(contents, `document.querySelector('[data-testid="task-acceptance"]')?.value ?? ''`));
  add("草案预填目标与验收标准", prefilledGoal === SENTENCE && prefilledAcceptance.length > 0, `acceptance0="${prefilledAcceptance}"`);

  // — the boss edits the contract by hand —
  await typeInto(contents, '[data-testid="task-goal"]', EDITED_GOAL);
  await click(contents, '[data-testid="task-acceptance-add"]');
  await typeIntoLastAcceptance(contents, EXTRA_CRITERION);
  const acceptanceRows = Number(await evalIn(contents, `document.querySelectorAll('[data-testid="task-acceptance"]').length`));
  add("目标与验收标准可手改", acceptanceRows >= 3, `rows=${acceptanceRows}`);

  // — dispatch to the programmer —
  await setSelect(contents, '[data-testid="task-employee"]', String(programmerId));
  const dispatchAt = Date.now();
  await click(contents, '[data-testid="task-dispatch"]');
  const runningShown = await waitFor(async () => (await evalIn(contents, TASK_ROW_STATUS_JS(0))) === "running", { timeoutMs: 5000 });
  add("派单后工单进入 running（起点 HEAD 由应用只读记录）", runningShown);
  if (!runningShown) {
    return { checks, evidence: { headBefore, taskError: await evalIn(contents, TASK_ERROR_JS) } };
  }

  // 票 06 把「已交产出」升级为「待验收」：跑完自动停在 review，四件套此刻已落盘。
  const finishedShown = await waitFor(async () => (await evalIn(contents, TASK_ROW_STATUS_JS(0))) === "review", {
    timeoutMs: 90_000,
    intervalMs: 300,
  });
  add("员工在 90s 内跑完工单，停在「待验收」（四件套落盘）", finishedShown, `${Date.now() - dispatchAt}ms`);

  // — open the task: the 四件套 —
  await click(contents, '[data-testid="task-row"]');
  const detailOpen = await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-detail"]') !== null`)) === true, { timeoutMs: 3000 });
  add("打开工单详情浮层", detailOpen);
  if (!detailOpen) return { checks, evidence: { headBefore } };

  const baseHeadText = String(await evalIn(contents, `document.querySelector('[data-testid="task-base-head"]')?.textContent ?? ''`));
  add("详情显示起点 HEAD（记录的就是开工时那条提交）", baseHeadText.includes(headBefore.slice(0, 7)), baseHeadText.trim().slice(0, 80));

  const goalView = String(await evalIn(contents, `document.querySelector('[data-testid="task-goal-view"]')?.textContent ?? ''`));
  const acceptanceView = String(await evalIn(contents, `document.querySelector('[data-testid="task-acceptance-view"]')?.innerText ?? ''`));
  add("手改后的目标与验收标准进了工单", goalView.includes(EDITED_GOAL) && acceptanceView.includes(EXTRA_CRITERION));

  await waitFor(async () => (await evalIn(contents, ARTIFACT_JS("diff_summary"))).includes("greet.txt"), { timeoutMs: 10_000 });
  const diffSummary = String(await evalIn(contents, ARTIFACT_JS("diff_summary")));
  const changedFiles = String(await evalIn(contents, ARTIFACT_JS("changed_files")));
  const commandOutput = String(await evalIn(contents, ARTIFACT_JS("command_output")));
  const report = String(await evalIn(contents, ARTIFACT_JS("report")));

  add(
    "四件套① diff 摘要：相对起点（起点→当前两个 HEAD + stat）",
    diffSummary.includes(headBefore.slice(0, 7)) && diffSummary.includes("greet.txt") && diffSummary.includes("changed"),
    diffSummary.slice(0, 90).replace(/\n/g, " ⏎ "),
  );
  add(
    "四件套② 变更文件清单：员工改了什么一目了然",
    changedFiles.includes("M greet.txt") && changedFiles.includes("A greet.test.mjs"),
    changedFiles.slice(0, 80).replace(/\n/g, " ⏎ "),
  );
  add(
    "四件套③ 命令输出：含真实测试运行（node --test 全绿）与提交命令",
    commandOutput.includes("node --test") && commandOutput.includes("# pass 2") && commandOutput.includes("git commit"),
    commandOutput.slice(0, 90).replace(/\n/g, " ⏎ "),
  );
  add(
    "四件套④ 收尾报告：含测试结果的员工自述",
    report.includes("收尾报告") && report.includes("pass 2"),
    report.slice(0, 60).replace(/\n/g, " ⏎ "),
  );

  // — not a git repository → the desk says so, no task created —
  await click(contents, '[data-testid="task-back"]');
  await typeInto(contents, '[data-testid="task-sentence"]', "写一份上线说明文档");
  await waitFor(async () => (await evalIn(contents, PLAYBOOK_JS)).includes("写文档"), { timeoutMs: 3000 });
  await setSelect(contents, '[data-testid="task-employee"]', String(pmId));
  await click(contents, '[data-testid="task-dispatch"]');
  const refused = await waitFor(async () => String(await evalIn(contents, TASK_ERROR_JS)).includes("不是 git 仓库"), { timeoutMs: 4000 });
  // probe the host directly for the exact code, and the host's own list
  // for the task count (no stale DOM):
  const direct = /** @type {any} */ (
    await evalIn(
      contents,
      `(async () => {
        try {
          await window.cubicle.invoke('task.create', { employeeId: ${pmId}, text: "写一份上线说明文档", goal: "写一份上线说明文档", acceptance: [] });
          return { ok: true };
        } catch (err) {
          return { ok: false, code: err.code, message: err.message };
        }
      })()`,
    )
  );
  const hostList = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${snapshot?.activeGroupId ?? 0} })`));
  const stillOneTask = (hostList?.tasks ?? []).length === 1;
  add(
    "工作区不是 git 仓库时明确提示不可用，且未创建工单",
    refused && stillOneTask && direct?.code === "not_a_git_workspace",
    `code=${direct?.code} note="${String(await evalIn(contents, TASK_ERROR_JS)).slice(0, 50)}" tasks=${(hostList?.tasks ?? []).length}`,
  );

  // — the app's git audit for the orchestrator's read-only proof —
  const audit = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.gitAudit')`));

  return {
    checks,
    evidence: {
      programmerId,
      pmId,
      headBefore,
      workspaceDir: dirs.workspaceDir,
      gitAudit: audit?.commands ?? [],
      artifacts: { diffSummary, changedFiles, commandOutput, report },
    },
  };
}

/**
 * @typedef {object} E2EContext
 * @property {import("electron").App} app
 * @property {() => import("electron").BrowserWindow | null} getMainWindow
 * @property {{ state: string, pid: number | null, send: (m: unknown) => boolean }} supervisor
 * @property {string} dataDir
 * @property {number} bootStartMs
 * @property {string} phase
 * @property {string} outDir
 */

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    outcome = await phaseWorkorder(ctx);
  } catch (err) {
    outcome.checks.push({ name: "unexpected error", ok: false, detail: String(err) });
  }

  const allOk = outcome.checks.length > 0 && outcome.checks.every((check) => check.ok);
  for (const check of outcome.checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  mkdirSync(ctx.outDir, { recursive: true });
  await writeFile(
    path.join(ctx.outDir, `${ctx.phase}.json`),
    `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
