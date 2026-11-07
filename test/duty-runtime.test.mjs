import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";
import { DEFAULT_SCHEDULE } from "../src/host/duty/schedule.mjs";
import { createDutyRuntime } from "../src/host/duty/runtime.mjs";
import { taskPrompt } from "../src/host/task/playbook.mjs";

/**
 * duty runtime seam — 纯状态机 (duty/schedule.mjs) × store × run-manager 的
 * 接线层（票 09）。时钟注入（nowFn），引擎侧用假 runManager 记录动作：
 * 这里钉的是「谁在什么时候被 pause / 被续跑」，run/session 落库语义在
 * store/run-manager 各自的 seam 钉死。
 */

/** @param {string} name */
async function withRuntime(name, { tickMs = 1000 } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-duty-${name}-`));
  const store = openStore({ dataDir });
  let now = new Date(2026, 10, 5, 10, 0, 0).getTime(); // 工作日 10:00，默认班表内
  /** @type {any[]} */
  const started = [];
  /** @type {any[]} */
  const paused = [];
  /** @type {any[]} */
  let activeRuns = [];
  const runManager = {
    activeRuns: () => activeRuns,
    start: (/** @type {any} */ input) => {
      started.push({ employeeId: input.employeeId, text: input.text, taskId: input.task?.id ?? null, resume: input.resume === true });
      activeRuns.push({ id: 900 + started.length, employeeId: input.employeeId });
      return { run: { id: 900 + started.length }, session: {} };
    },
    pause: async (/** @type {any} */ input) => {
      paused.push(input.employeeId);
      activeRuns = activeRuns.filter((run) => run.employeeId !== input.employeeId);
    },
  };
  const runtime = createDutyRuntime({
    store,
    runManager,
    nowFn: () => now,
    tickMs,
    taskPromptFor: taskPrompt,
  });
  return {
    store,
    runtime,
    runManager,
    started,
    paused,
    setActiveRuns: (/** @type {any[]} */ runs) => (activeRuns = runs),
    setNow: (/** @type {number} */ ms) => (now = ms),
    at: (/** @type {number} */ h, /** @type {number} */ mi = 0, /** @type {number} */ s = 0, /** @type {number} */ day = 5) =>
      new Date(2026, 10, day, h, mi, s).getTime(),
    hireAt: (/** @type {number} */ deskIndex, /** @type {string} */ employeeName, /** @type {number} */ groupId) => {
      const desks = store.listDesks({ groupId });
      const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));
      return store.hireEmployee({ deskId: desks[deskIndex].id, roleId: programmer.id, name: employeeName }).employee;
    },
    makeRunningPausedTask: (/** @type {any} */ employee, /** @type {number} */ groupId, /** @type {string} */ title) => {
      const task = store.createTask({
        groupId,
        employeeId: employee.id,
        workspaceDir: "C:\\nowhere",
        title,
        goal: title,
        playbook: "free",
        acceptance: [],
        baseHead: "d".repeat(40),
      });
      store.setTaskStatus(task.id, "running");
      const session = store.getOrCreateEmployeeSession({
        employeeId: employee.id,
        engine: "pi",
        agentDir: "a",
        sessionsDir: "s",
        workspaceDir: "w",
      });
      const taskSession = store.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine: "pi" });
      const run = store.createRun({
        employeeId: employee.id,
        employeeSessionId: session.id,
        engine: "pi",
        prompt: title,
        taskId: task.id,
        taskSessionId: taskSession.id,
      });
      store.finishRun({ runId: run.id, status: "paused" });
      store.finishTaskSession({ taskSessionId: taskSession.id, status: "paused" });
      return task;
    },
    dispose: async () => {
      runtime.stop();
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("到点上班：running+paused 与 崩溃回待办 的任务都被激活续跑；从没派过的待办不被擅自开工", async () => {
  const ctx = await withRuntime("clock-in");
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const company = ctx.store.officeSnapshot().companies[0];
    const workerA = ctx.hireAt(0, "小程", group.id);
    const workerB = ctx.hireAt(1, "小程二", group.id);
    const workerC = ctx.hireAt(2, "小程三", group.id);

    const pausedTask = ctx.makeRunningPausedTask(workerA, group.id, "跨夜慢活");

    // workerB：崩溃遗留 → 开库自愈后的形态是「待办 + 最近会话 interrupted」
    const healedTask = ctx.store.createTask({
      groupId: group.id,
      employeeId: workerB.id,
      workspaceDir: "C:\\nowhere",
      title: "崩溃前派过的活",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });
    const bSession = ctx.store.getOrCreateEmployeeSession({ employeeId: workerB.id, engine: "pi", agentDir: "a", sessionsDir: "s", workspaceDir: "w" });
    const bTaskSession = ctx.store.openTaskSession({ taskId: healedTask.id, employeeSessionId: bSession.id, engine: "pi" });
    ctx.store.finishTaskSession({ taskSessionId: bTaskSession.id, status: "interrupted" });

    // workerC：从没派过单的待办 → 不应被自动开工
    const freshTask = ctx.store.createTask({
      groupId: group.id,
      employeeId: workerC.id,
      workspaceDir: "C:\\nowhere",
      title: "还没派的活",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });

    // 前一晚 20:00（下班相位），到 09:00 的 tick 上班
    ctx.store.setDutyStatus({ companyId: company.id, phase: "off", phaseSince: ctx.at(20, 0, 0, 4), graceUntil: null });
    ctx.setNow(ctx.at(8, 59, 59));
    ctx.runtime.tick();
    assert.deepEqual(ctx.started.map((s) => s.taskId), [], "没到点不动");

    ctx.setNow(ctx.at(9, 0, 0));
    ctx.runtime.tick();
    const resumes = ctx.started.filter((s) => s.resume);
    assert.equal(resumes.length, 1, "paused 的任务续跑一次（resume 通道）");
    assert.equal(resumes[0].employeeId, workerA.id);
    assert.equal(resumes[0].taskId, pausedTask.id);
    const fresh = ctx.started.filter((s) => !s.resume);
    assert.deepEqual(fresh.map((s) => s.taskId), [healedTask.id], "崩溃遗留的待办上班自动续跑（open→running 合法转移）");
    assert.ok(
      ctx.started.every((s) => typeof s.text === "string" && s.text.length > 0),
      "续跑带任务合同（taskPrompt），引擎会话延续对话记忆",
    );
    assert.ok(!ctx.started.some((s) => s.taskId === freshTask.id), "从没派过单的待办不会被上班擅自开工");
    const status = /** @type {any} */ (ctx.store.getDutyStatus(company.id));
    assert.equal(status.phase, "on", "相位落盘：上班中");
  } finally {
    await ctx.dispose();
  }
});

test("到点下班：先进 90 秒宽限（run 不被掐、工具照常），宽限到期才 pause", async () => {
  const ctx = await withRuntime("grace");
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const company = ctx.store.officeSnapshot().companies[0];
    const worker = ctx.hireAt(0, "小程", group.id);
    ctx.store.upsertCompanySchedule({ companyId: company.id, workStart: "09:00", workEnd: "18:00", graceSeconds: 90 });
    ctx.setActiveRuns([{ id: 500, employeeId: worker.id }]);

    ctx.setNow(ctx.at(17, 59, 59));
    ctx.runtime.tick(); // 首次观测 → on
    ctx.setActiveRuns([{ id: 500, employeeId: worker.id }]);

    ctx.setNow(ctx.at(18, 0, 30));
    ctx.runtime.tick();
    assert.deepEqual(ctx.paused, [], "到点后 30 秒还在宽限里：run 不停");
    const grace = /** @type {any} */ (ctx.store.getDutyStatus(company.id));
    assert.equal(grace.phase, "grace");
    assert.equal(grace.graceUntil, ctx.at(18, 0, 0) + 90_000, "宽限从界点起算");

    ctx.setNow(ctx.at(18, 1, 31));
    ctx.runtime.tick();
    assert.deepEqual(ctx.paused, [worker.id], "宽限到期 → 引擎 abort 落盘");
    const off = /** @type {any} */ (ctx.store.getDutyStatus(company.id));
    assert.equal(off.phase, "off");
  } finally {
    await ctx.dispose();
  }
});

test("宽限可配成秒级：e2e 用「下班配成几秒后 + 短宽限」演示真实等待", async () => {
  const ctx = await withRuntime("fast-grace");
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const company = ctx.store.officeSnapshot().companies[0];
    const worker = ctx.hireAt(0, "小程", group.id);
    ctx.store.upsertCompanySchedule({ companyId: company.id, workStart: "09:00", workEnd: "14:00:05", graceSeconds: 3 });
    ctx.setActiveRuns([{ id: 501, employeeId: worker.id }]);
    ctx.setNow(ctx.at(13, 59, 59));
    ctx.runtime.tick();
    ctx.setNow(ctx.at(14, 0, 6));
    ctx.runtime.tick();
    assert.deepEqual(ctx.paused, [], "宽限内不掐");
    ctx.setNow(ctx.at(14, 0, 8));
    ctx.runtime.tick();
    assert.deepEqual(ctx.paused, [worker.id]);
  } finally {
    await ctx.dispose();
  }
});

test("默认时间表：没配过的公司走 90 秒宽限的默认班表", async () => {
  const ctx = await withRuntime("default-schedule");
  try {
    const company = ctx.store.officeSnapshot().companies[0];
    assert.equal(ctx.store.getCompanySchedule(company.id), null);
    assert.equal(DEFAULT_SCHEDULE.graceSeconds, 90);
    const group = ctx.store.officeSnapshot().groups[0];
    const worker = ctx.hireAt(0, "小程", group.id);
    ctx.setActiveRuns([{ id: 502, employeeId: worker.id }]);
    ctx.setNow(ctx.at(17, 59, 59));
    ctx.runtime.tick();
    ctx.setNow(ctx.at(18, 1, 0));
    ctx.runtime.tick();
    const grace = /** @type {any} */ (ctx.store.getDutyStatus(company.id));
    assert.equal(grace.phase, "grace", "默认班表也走宽限");
    assert.deepEqual(ctx.paused, []);
  } finally {
    await ctx.dispose();
  }
});

test("手动 override：立即下班（无宽限）+ 立即上班（续跑），时间表一个字不改", async () => {
  const ctx = await withRuntime("override");
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const company = ctx.store.officeSnapshot().companies[0];
    const worker = ctx.hireAt(0, "小程", group.id);
    ctx.store.upsertCompanySchedule({ companyId: company.id, workStart: "09:00", workEnd: "18:00", graceSeconds: 90 });
    const before = ctx.store.getCompanySchedule(company.id);
    const pausedTask = ctx.makeRunningPausedTask(worker, group.id, "跨夜慢活");
    assert.ok(before, "配置行已存在");
    // 先造一个「已暂停」的现状，再手动上班续跑
    ctx.setNow(ctx.at(15, 0));
    ctx.runtime.applyOverride(company.id, "on");
    const resumes = ctx.started.filter((s) => s.resume);
    assert.equal(resumes.length, 1, "手动上班 = 立即激活有未完成任务的员工");
    assert.equal(resumes[0].taskId, pausedTask.id);

    // 上班 5 秒后手动下班：立即 pause，没有宽限相位
    ctx.setActiveRuns([{ id: 503, employeeId: worker.id }]);
    ctx.setNow(ctx.at(15, 0, 5));
    ctx.runtime.applyOverride(company.id, "off");
    assert.deepEqual(ctx.paused, [worker.id], "手动下班立即生效");
    const status = /** @type {any} */ (ctx.store.getDutyStatus(company.id));
    assert.equal(status.phase, "off", "手动下班直接 off，不进宽限");

    const after = ctx.store.getCompanySchedule(company.id);
    assert.ok(after, "配置行仍然存在：override 没删也没改它");
    assert.deepEqual(
      { workStart: after.workStart, workEnd: after.workEnd, graceSeconds: after.graceSeconds },
      { workStart: before.workStart, workEnd: before.workEnd, graceSeconds: before.graceSeconds },
      "override 不动时间表（验收 2）",
    );

    // 越夜到次日上午：override 失效，按时间表自动上班续跑
    const beforeNextDay = ctx.started.length;
    ctx.setNow(ctx.at(9, 0, 1, 6));
    ctx.runtime.tick();
    assert.equal(/** @type {any} */ (ctx.store.getDutyOverride(company.id)), null, "override 越过界点自动失效");
    assert.ok(ctx.started.length > beforeNextDay, "次日上按班表上班并续跑");
    const phaseAfter = /** @type {any} */ (ctx.store.getDutyStatus(company.id));
    assert.equal(phaseAfter.phase, "on");
  } finally {
    await ctx.dispose();
  }
});

test("上班续跑也认「进行中 + 最近一轮 interrupted」：续跑后崩溃的活不被落下", async () => {
  const ctx = await withRuntime("resume-interrupted");
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const company = ctx.store.officeSnapshot().companies[0];
    const worker = ctx.hireAt(0, "小程", group.id);
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: worker.id,
      workspaceDir: "C:\\nowhere",
      title: "昨晚续跑过又断了",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });
    ctx.store.setTaskStatus(task.id, "running");
    const session = ctx.store.getOrCreateEmployeeSession({ employeeId: worker.id, engine: "pi", agentDir: "a", sessionsDir: "s", workspaceDir: "w" });
    const pausedFirst = ctx.store.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine: "pi" });
    ctx.store.finishTaskSession({ taskSessionId: pausedFirst.id, status: "paused" }); // 下班落盘（自愈会因此不动任务状态）
    const crashed = ctx.store.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine: "pi" }); // 上班续跑…
    ctx.store.finishTaskSession({ taskSessionId: crashed.id, status: "interrupted" }); // …崩溃自愈落 interrupted
    ctx.store.setDutyStatus({ companyId: company.id, phase: "off", phaseSince: ctx.at(20, 0, 0, 4), graceUntil: null });

    ctx.setNow(ctx.at(9, 0, 1));
    ctx.runtime.tick();
    const resumes = ctx.started.filter((s) => s.resume);
    assert.equal(resumes.length, 1, "进行中 + interrupted 也走 resume 通道续跑");
    assert.equal(resumes[0].taskId, task.id);
  } finally {
    await ctx.dispose();
  }
});

test("多公司并行：A 到点下班只掐 A 的 run，B 不受牵连", async () => {
  const ctx = await withRuntime("multi-company");
  try {
    const a = ctx.store.officeSnapshot().companies[0];
    const aGroup = ctx.store.officeSnapshot().groups[0];
    const b = ctx.store.createCompany({ name: "远岸软件" });
    const bGroup = ctx.store.createProjectGroup({ companyId: b.id, name: "看板组" });
    const aWorker = ctx.hireAt(0, "小程", aGroup.id);
    const bWorker = ctx.hireAt(1, "小岸", bGroup.id);
    void bWorker;

    ctx.store.upsertCompanySchedule({ companyId: a.id, workStart: "09:00", workEnd: "18:00", graceSeconds: 0 });
    ctx.store.upsertCompanySchedule({ companyId: b.id, workStart: "09:00", workEnd: "23:00", graceSeconds: 90 });
    ctx.setActiveRuns([
      { id: 504, employeeId: aWorker.id },
      { id: 505, employeeId: bWorker.id },
    ]);
    ctx.setNow(ctx.at(17, 59, 59));
    ctx.runtime.tick();
    ctx.setActiveRuns([
      { id: 504, employeeId: aWorker.id },
      { id: 505, employeeId: bWorker.id },
    ]);

    ctx.setNow(ctx.at(18, 0, 1));
    ctx.runtime.tick();
    assert.deepEqual(ctx.paused, [aWorker.id], "只有 A 公司落盘");
    assert.equal(/** @type {any} */ (ctx.store.getDutyStatus(b.id)).phase, "on", "B 还在上班");
  } finally {
    await ctx.dispose();
  }
});

test("pauseAll（退出直接退）：掐掉所有公司的在跑 run，返回落盘数量", async () => {
  const ctx = await withRuntime("pause-all");
  try {
    const a = ctx.store.officeSnapshot().companies[0];
    const aGroup = ctx.store.officeSnapshot().groups[0];
    const b = ctx.store.createCompany({ name: "远岸软件" });
    const bGroup = ctx.store.createProjectGroup({ companyId: b.id, name: "看板组" });
    const aWorker = ctx.hireAt(0, "小程", aGroup.id);
    const bWorker = ctx.hireAt(1, "小岸", bGroup.id);

    ctx.setActiveRuns([
      { id: 506, employeeId: aWorker.id },
      { id: 507, employeeId: bWorker.id },
    ]);
    const count = await ctx.runtime.pauseAll();
    assert.equal(count, 2);
    assert.deepEqual(new Set(ctx.paused), new Set([aWorker.id, bWorker.id]));
    assert.deepEqual(ctx.started, [], "pauseAll 只收尾，不开新的");
  } finally {
    await ctx.dispose();
  }
});

test("phaseForEmployee：下班公司的员工查得到 off（派单闸门用），未播种公司保守按 on", async () => {
  const ctx = await withRuntime("phase-gate");
  try {
    const company = ctx.store.officeSnapshot().companies[0];
    const group = ctx.store.officeSnapshot().groups[0];
    const worker = ctx.hireAt(0, "小程", group.id);
    assert.equal(ctx.runtime.phaseForEmployee(worker.id), "on", "工作时段默认在班");
    ctx.runtime.applyOverride(company.id, "off");
    assert.equal(ctx.runtime.phaseForEmployee(worker.id), "off");
    assert.equal(ctx.runtime.phaseForEmployee(999999), "on", "查不到的员工不误伤");
  } finally {
    await ctx.dispose();
  }
});

test("loop 用注入时钟自动 tick：start() 之后到点自己落盘", async () => {
  const ctx = await withRuntime("auto-loop", { tickMs: 20 });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const company = ctx.store.officeSnapshot().companies[0];
    const worker = ctx.hireAt(0, "小程", group.id);
    ctx.store.upsertCompanySchedule({ companyId: company.id, workStart: "09:00", workEnd: "18:00", graceSeconds: 0 });
    ctx.setActiveRuns([{ id: 508, employeeId: worker.id }]);
    ctx.setNow(ctx.at(17, 59, 59));
    ctx.runtime.start();
    // 把「未来」拨到下班点后，等待自动 tick 落盘
    await new Promise((resolve) => setTimeout(resolve, 30));
    ctx.setActiveRuns([{ id: 508, employeeId: worker.id }]);
    ctx.setNow(ctx.at(18, 0, 1));
    const deadline = Date.now() + 2000;
    while (ctx.paused.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(ctx.paused, [worker.id], "不用手动 tick：到点自动下班落盘");
  } finally {
    await ctx.dispose();
  }
});
