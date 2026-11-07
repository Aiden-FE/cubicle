import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";
import { commandTranscript, createTaskRunHook, finalReport } from "../src/host/task/artifacts.mjs";

/**
 * The collector seam: engine events in, four artifacts out — verified
 * against a real store and a scripted git reader, so the git door itself is
 * covered separately (test/git-reader.test.mjs) and this file owns the
 * "四件套" contract.
 */

/**
 * @param {string} name
 * @param {{ ok: boolean, headNow?: string, stat?: string, nameStatus?: { status: string, path: string }[], porcelain?: string, code?: string, message?: string }} gitScript
 */
async function withCollector(name, gitScript) {
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-artifacts-${name}-`));
  const store = openStore({ dataDir });
  let diffCalls = /** @type {{ workspaceDir: string, baseSha: string }[]} */ ([]);
  const git = /** @type {any} */ ({
    diffInfo(/** @type {string} */ workspaceDir, /** @type {string} */ baseSha) {
      diffCalls.push({ workspaceDir, baseSha });
      return { ...gitScript };
    },
  });
  const group = store.officeSnapshot().groups[0];
  const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));
  const desk = store.listDesks({ groupId: group.id })[0];
  const employee = store.hireEmployee({ deskId: desk.id, roleId: programmer.id, name: "小程" }).employee;
  const workspaceDir = path.join(dataDir, "workspace");
  const task = store.createTask({
    groupId: group.id,
    employeeId: employee.id,
    workspaceDir,
    title: "给 greet.txt 加欢迎语",
    goal: "给 greet.txt 加一行欢迎语",
    playbook: "feature",
    acceptance: ["欢迎语可见"],
    baseHead: "a".repeat(40),
  });
  const employeeSession = store.getOrCreateEmployeeSession({
    employeeId: employee.id,
    engine: "pi",
    agentDir: "a",
    sessionsDir: "s",
    workspaceDir,
  });
  store.setTaskStatus(task.id, "running");
  const taskSession = store.openTaskSession({
    taskId: task.id,
    employeeSessionId: employeeSession.id,
    engine: "pi",
  });
  const run = store.createRun({
    employeeId: employee.id,
    employeeSessionId: employeeSession.id,
    engine: "pi",
    prompt: "干活",
    taskId: task.id,
    taskSessionId: taskSession.id,
  });
  const hook = createTaskRunHook({ store, git });
  return {
    store,
    hook,
    task,
    taskSession,
    run,
    diffCalls,
    dispose: () => {
      store.close();
      return rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** @param {any[]} spec @returns {{ at: number, event: any }[]} */
function eventsOf(spec) {
  return spec.map((event, index) => ({ at: 1000 + index, event }));
}

const WORK_RUN = eventsOf([
  { type: "session_start", sessionId: "1" },
  { type: "text_delta", text: "收到工单，开始干活。" },
  { type: "tool_execution_start", toolCallId: "c1", toolName: "write", args: { path: "greet.txt", content: "hello\nwelcome\n" } },
  { type: "tool_execution_end", toolCallId: "c1", toolName: "write", isError: false, result: "ok" },
  { type: "tool_execution_start", toolCallId: "c2", toolName: "bash", args: { command: "git add -A && git commit -m feat" } },
  { type: "tool_execution_end", toolCallId: "c2", toolName: "bash", isError: false, result: "[main 1234567] feat" },
  { type: "text_delta", text: "收尾报告\n完成：greet.txt 加欢迎语\n测试：npm test → 12/12 通过" },
  { type: "agent_end", status: "ok" },
]);

test("a finished task run leaves exactly the four artifacts, in order", async () => {
  const ctx = await withCollector("four", {
    ok: true,
    headNow: "b".repeat(40),
    stat: "greet.txt | 2 +-\n1 file changed, 2 insertions(+)",
    nameStatus: [{ status: "M", path: "greet.txt" }],
    porcelain: "M greet.txt",
  });
  try {
    ctx.hook({ run: ctx.run, status: "completed", events: WORK_RUN });
    const artifacts = ctx.store.listArtifacts({ taskId: ctx.task.id });
    assert.deepEqual(artifacts.map((a) => a.kind), ["diff_summary", "changed_files", "command_output", "report"]);
    assert.deepEqual(artifacts.map((a) => a.runId), [ctx.run.id, ctx.run.id, ctx.run.id, ctx.run.id]);

    const [diff, files, commands, report] = artifacts;
    // diff is relative to the recorded start HEAD (ticket 05 acceptance)
    assert.deepEqual(ctx.diffCalls, [{ workspaceDir: ctx.task.workspaceDir, baseSha: ctx.task.baseHead }]);
    assert.ok(diff.content.includes(`${"a".repeat(7)}…`));
    assert.ok(diff.content.includes(`${"b".repeat(7)}…`));
    assert.ok(diff.content.includes("1 file changed"));

    assert.ok(files.content.includes("M greet.txt"));

    // command output carries the bash invocation AND its output — tests too
    assert.ok(commands.content.includes("git add -A && git commit -m feat"));
    assert.ok(commands.content.includes("[main 1234567] feat"));
    assert.ok(!commands.content.includes("greet.txt, content"), "write tool args are not command output");

    assert.ok(report.content.startsWith("收尾报告"));
    assert.ok(report.content.includes("12/12 通过"));
  } finally {
    await ctx.dispose();
  }
});

test("a clean run ends in 待验收 — 完成 is the boss's call, never the engine's (票 06)", async () => {
  const ctx = await withCollector("review", { ok: true, headNow: "c".repeat(40), stat: "", nameStatus: [], porcelain: "" });
  try {
    ctx.hook({ run: ctx.run, status: "completed", events: WORK_RUN });
    assert.equal(/** @type {any} */ (ctx.store.taskById(ctx.task.id)).status, "review");
    // four honest slots even for an aborted run with nothing in them
    assert.equal(ctx.store.listArtifacts({ taskId: ctx.task.id }).length, 4);
  } finally {
    await ctx.dispose();
  }
});

test("a cancelled or failed run marks the task 失败 (票 06: 取消终止并标记失败)", async () => {
  for (const runStatus of ["aborted", "failed"]) {
    const ctx = await withCollector(`fail-${runStatus}`, { ok: true, headNow: "c".repeat(40), stat: "", nameStatus: [], porcelain: "" });
    try {
      ctx.hook({ run: ctx.run, status: /** @type {any} */ (runStatus), events: eventsOf([{ type: "agent_end", status: "failed" }]) });
      assert.equal(/** @type {any} */ (ctx.store.taskById(ctx.task.id)).status, "failed");
      // 失败不是终态：重试从 失败 → 进行中 回到循环里
      assert.equal(ctx.store.setTaskStatus(ctx.task.id, "running").status, "running");
    } finally {
      await ctx.dispose();
    }
  }
});

test("paused（下班落盘）：不落四件套、不搬任务状态 —— 暂停的一轮等上班续跑（票 09）", async () => {
  const ctx = await withCollector("paused", { ok: true, headNow: "c".repeat(40), stat: "", nameStatus: [], porcelain: "" });
  try {
    ctx.hook({
      run: ctx.run,
      status: "paused",
      events: eventsOf([
        { type: "tool_execution_start", toolCallId: "c9", toolName: "powershell", args: { command: "Start-Sleep -Seconds 3" } },
        { type: "agent_end", status: "failed" },
      ]),
    });
    assert.equal(ctx.store.listArtifacts({ taskId: ctx.task.id }).length, 0, "暂停的一轮不是交付：不写四件套");
    assert.equal(ctx.diffCalls.length, 0, "也不为它跑 git diff");
    assert.equal(/** @type {any} */ (ctx.store.taskById(ctx.task.id)).status, "running", "任务停在「进行中」挂暂停徽标，不搬去失败也不搬去待验收");
  } finally {
    await ctx.dispose();
  }
});

test("artifacts still land when the workspace cannot be diffed — with an honest reason", async () => {
  const ctx = await withCollector("nogit", { ok: false, code: "not_a_git_workspace", message: "工作区不是 git 仓库" });
  try {
    ctx.hook({ run: ctx.run, status: "completed", events: WORK_RUN });
    const artifacts = ctx.store.listArtifacts({ taskId: ctx.task.id });
    assert.deepEqual(artifacts.map((a) => a.kind), ["diff_summary", "changed_files", "command_output", "report"]);
    assert.ok(artifacts[0].content.includes("工作区不是 git 仓库"));
    assert.ok(artifacts[1].content.includes("工作区不是 git 仓库"));
  } finally {
    await ctx.dispose();
  }
});

test("commandTranscript keeps every bash command with its output and failure marks", () => {
  const transcript = commandTranscript([
    { at: 1, event: { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: { command: "npm test" } } },
    { at: 2, event: { type: "tool_execution_end", toolCallId: "a", toolName: "bash", isError: false, result: "12 pass" } },
    { at: 3, event: { type: "tool_execution_end", toolCallId: "b", toolName: "bash", isError: true, result: { output: "boom" } } },
    { at: 4, event: { type: "tool_execution_end", toolCallId: "c", toolName: "read", isError: false, result: "x" } },
  ]);
  assert.ok(transcript.includes("$ npm test"));
  assert.ok(transcript.includes("12 pass"));
  assert.ok(transcript.includes("[失败]"));
  assert.ok(transcript.includes("boom"), "object results are rendered as text");
  assert.ok(!transcript.includes("read"));
});

test("powershell runs count as command output too, rendered from the engine's structured result", () => {
  const transcript = commandTranscript([
    { at: 1, event: { type: "tool_execution_start", toolCallId: "p", toolName: "powershell", args: { command: "node --test" } } },
    {
      at: 2,
      event: {
        type: "tool_execution_end",
        toolCallId: "p",
        toolName: "powershell",
        isError: false,
        result: {
          content: [{ type: "text", text: "# tests 2\n# pass 2\n# fail 0" }],
          structuredContent: { output: "# tests 2\n# pass 2\n# fail 0", exit_code: 0 },
          isError: false,
        },
      },
    },
  ]);
  assert.ok(transcript.includes("$ node --test"));
  assert.ok(transcript.includes("# pass 2"));
  assert.ok(!transcript.includes("structuredContent"), "raw engine envelope JSON must not leak into the artifact");
});

test("finalReport is the assistant text after the last tool call", () => {
  assert.equal(
    finalReport([
      { at: 1, event: { type: "text_delta", text: "先看一眼" } },
      { at: 2, event: { type: "tool_execution_end", toolCallId: "a", toolName: "bash", isError: false, result: "ok" } },
      { at: 3, event: { type: "text_delta", text: "收尾报告：" } },
      { at: 4, event: { type: "text_delta", text: "完成" } },
    ]),
    "收尾报告：完成",
  );
  assert.equal(finalReport([]), "");
});
