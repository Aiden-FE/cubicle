import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";
import { createRunManager } from "../src/host/engine/run-manager.mjs";
import { appError } from "../src/shared/apperror.mjs";

/**
 * @param {string} name
 * @param {{ adapter?: any, dataDirPrefix?: string, drainTimeoutMs?: number, runTimeoutMs?: number }} [options]
 */
async function withManager(name, options = {}) {
  const { adapter, dataDirPrefix = `cubicle-runs-${name}-`, drainTimeoutMs, runTimeoutMs } = options;
  const dataDir = await mkdtemp(path.join(tmpdir(), dataDirPrefix));
  const store = openStore({ dataDir });
  const group = store.officeSnapshot().groups[0];
  const desks = store.listDesks({ groupId: group.id });
  const roles = store.listRoles();
  const programmer = /** @type {any} */ (roles.find((r) => r.key === "programmer"));
  const employee = store.hireEmployee({ deskId: desks[0].id, roleId: programmer.id, name: "小程" }).employee;

  const emitted = /** @type {any[]} */ ([]);
  const manager = createRunManager({
    store,
    getAdapter: (engine) => (adapter && (adapter.forAll || engine === "pi") ? adapter : null),
    emit: (payload) => emitted.push(payload),
    ...(drainTimeoutMs === undefined ? {} : { drainTimeoutMs }),
    ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
  });
  return {
    store,
    manager,
    employee,
    employeeId: employee.id,
    emitted,
    dataDir,
    dispose: async () => {
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Stub engine adapter: `scripted` events are streamed on prompt; `pending`
 * keeps prompt open until endPrompt()/abort(). Mirrors the contract the pi
 * adapter must satisfy: open → live session { prompt, abort, sessionFile }.
 *
 * Pending prompts and event subscriptions are keyed per employee, so two
 * employees can be open at once without their handles overwriting each
 * other (ticket 09 pause/pauseAll tests run two live runs side by side).
 *
 * @param {{ events?: any[], pending?: boolean, openThrows?: { code: string } | null, sessionFile?: string | null }} [options]
 */
function makeStub({ events = [], pending = false, openThrows = null, sessionFile = path.join("E:", "engine", "session.jsonl") } = {}) {
  const state = { opens: 0, prompts: /** @type {string[]} */ ([]), aborts: 0, employee: /** @type {any} */ (null), session: /** @type {any} */ (null) };
  /** @type {Map<number, { endPrompt: ((value?: unknown) => void) | null, emit: ((event: any) => void) | null }>} */
  const perEmployee = new Map();
  const handleFor = (/** @type {number} */ employeeId) => {
    let entry = perEmployee.get(employeeId);
    if (!entry) {
      entry = { endPrompt: null, emit: null };
      perEmployee.set(employeeId, entry);
    }
    return entry;
  };
  return {
    state,
    forAll: true,
    sessionFileFor: sessionFile,
    /**
     * @param {{ employee: any, session: any, onEvent: (event: any) => void }} input
     */
    async open({ employee, session, onEvent }) {
      state.opens += 1;
      state.employee = employee;
      state.session = session;
      const entry = handleFor(Number(session.employeeId));
      entry.emit = onEvent;
      if (openThrows) throw appError(openThrows.code, "stub engine cannot start");
      return {
        /** @param {string} text */
        async prompt(text) {
          state.prompts.push(text);
          for (const event of events) onEvent(event);
          if (pending) await new Promise((resolve) => (entry.endPrompt = resolve));
        },
        async abort() {
          state.aborts += 1;
          if (pending) {
            onEvent({ type: "agent_end", status: "failed" });
            entry.endPrompt?.();
          }
        },
        sessionFile: () => sessionFile,
      };
    },
    /** let pending prompts finish (all employees, or one by id) */
    settle(/** @type {number | undefined} */ employeeId = undefined) {
      const targets = employeeId === undefined ? [...perEmployee.values()] : [handleFor(employeeId)];
      for (const entry of targets) entry.endPrompt?.();
    },
    /** push one more normalized event through an employee's open subscription */
    push(/** @type {any} */ event, /** @type {number | undefined} */ employeeId = undefined) {
      const target = employeeId === undefined
        ? [...perEmployee.values()].at(-1)
        : handleFor(employeeId);
      target?.emit?.(event);
    },
  };
}

const AGENT_END = { type: "agent_end", status: "ok" };

test("ticket 11 admission gate: a not-enabled engine cannot take work, enabling lets it through", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const h = await withManager("admission", { adapter: stub });
  try {
    h.store.setEmployeeEngine({ employeeId: h.employeeId, engine: "codex" });
    assert.throws(() => h.manager.start({ employeeId: h.employeeId, text: "干活" }), (err) => /** @type {any} */ (err).code === "engine_not_admitted");

    h.store.setEngineEnabled({ engine: "codex", enabled: true, manualOverride: true });
    const { run } = h.manager.start({ employeeId: h.employeeId, text: "干活" });
    await h.manager.whenQuiet();
    assert.equal(run.engine, "codex");
    assert.equal(h.store.latestRunForEmployee(h.employeeId)?.status, "completed");
  } finally {
    await h.dispose();
  }
});

test("the admission probe bypasses the gate for a not-yet-enabled engine", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const h = await withManager("probe-gate", { adapter: stub });
  try {
    h.store.setEmployeeEngine({ employeeId: h.employeeId, engine: "codex" });
    assert.throws(() => h.manager.start({ employeeId: h.employeeId, text: "干活" }), (err) => /** @type {any} */ (err).code === "engine_not_admitted");
    // probe:true runs the engine to TEST admission
    const { run } = h.manager.start({ employeeId: h.employeeId, text: "探针", probe: true });
    await h.manager.whenQuiet();
    assert.equal(run.engine, "codex");
    assert.equal(h.store.latestRunForEmployee(h.employeeId)?.status, "completed");
    assert.equal(h.store.engineState("codex")?.enabled, false); // a probe run does not admit by itself
  } finally {
    await h.dispose();
  }
});

test("subscribe rides every run event with the run id (probe observation)", async () => {  const stub = makeStub({ events: [{ type: "text_delta", text: "hi" }, AGENT_END] });
  const h = await withManager("subscribe", { adapter: stub });
  try {
    /** @type {any[]} */
    const seen = [];
    const unsubscribe = h.manager.subscribe((payload) => seen.push(payload));
    const { run } = h.manager.start({ employeeId: h.employeeId, text: "hi" });
    await h.manager.whenQuiet();
    unsubscribe();
    h.manager.start({ employeeId: h.employeeId, text: "again" });
    await h.manager.whenQuiet();
    assert.ok(seen.some((p) => p.runId === run.id && p.event.type === "text_delta"));
    assert.ok(seen.some((p) => p.event.type === "session_start"));
    assert.equal(seen.filter((p) => p.runId === run.id).at(-1)?.event.type, "agent_end");
  } finally {
    await h.dispose();
  }
});

test("start streams the engine events in order, closes the run as completed, and records the resume pointer", async () => {
  const script = [
    { type: "turn_start" },
    { type: "text_delta", text: "Reading " },
    { type: "text_delta", text: "hello.txt" },
    { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "hello.txt" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "read", isError: false, result: "hi" },
    { type: "turn_end", status: "ok" },
    AGENT_END,
  ];
  const stub = makeStub({ events: script });
  const ctx = await withManager("complete", { adapter: stub });
  try {
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "读一下 hello.txt" });
    assert.equal(started.run.status, "running");
    assert.equal(started.session.engine, "pi");
    assert.ok(started.session.workspaceDir.includes(path.join("workspaces", `employee-${ctx.employeeId}`)));

    await ctx.manager.whenQuiet();

    const types = ctx.emitted.map((p) => p.event.type);
    assert.deepEqual(types, ["session_start", ...script.map((e) => e.type)]);
    assert.deepEqual(ctx.emitted[0].event, { type: "session_start", sessionId: String(started.session.id) });
    for (const payload of ctx.emitted) {
      assert.equal(payload.runId, started.run.id);
      assert.equal(payload.employeeId, ctx.employeeId);
      assert.equal(payload.sessionId, started.session.id);
    }
    // pass-through fidelity: one scripted event is copied verbatim
    assert.deepEqual(ctx.emitted[4].event, script[3]);

    const latest = /** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId));
    assert.equal(latest.status, "completed");
    assert.equal(latest.id, started.run.id);
    assert.equal(/** @type {any} */ (ctx.store.employeeSessionById(started.session.id)).sessionFile, path.join("E:", "engine", "session.jsonl"));
    assert.deepEqual(stub.state.prompts, ["读一下 hello.txt"]);
  } finally {
    await ctx.dispose();
  }
});

test("a second conversation from the same employee reuses one engine session and one session entity", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("reuse", { adapter: stub });
  try {
    const first = ctx.manager.start({ employeeId: ctx.employeeId, text: "第一句" });
    await ctx.manager.whenQuiet();
    const second = ctx.manager.start({ employeeId: ctx.employeeId, text: "第二句" });
    await ctx.manager.whenQuiet();

    assert.equal(stub.state.opens, 1, "engine session opened exactly once");
    assert.deepEqual(stub.state.prompts, ["第一句", "第二句"]);
    assert.equal(second.session.id, first.session.id);
    const firstRun = /** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId));
    assert.notEqual(firstRun.id, first.run.id);
    assert.equal(firstRun.employeeSessionId, first.session.id);
  } finally {
    await ctx.dispose();
  }
});

test("an employee that is already working rejects a second message with employee_busy", async () => {
  const stub = makeStub({ pending: true });
  const ctx = await withManager("busy", { adapter: stub });
  try {
    ctx.manager.start({ employeeId: ctx.employeeId, text: "干活中" });
    assert.throws(
      () => ctx.manager.start({ employeeId: ctx.employeeId, text: "别催" }),
      (err) => /** @type {{ code?: string }} */ (err).code === "employee_busy",
    );
    stub.push(AGENT_END);
    stub.settle();
    await ctx.manager.whenQuiet();
    assert.equal(/** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId)).status, "completed");
  } finally {
    await ctx.dispose();
  }
});

test("abort stops the run, finishes it as aborted, and rejects when nothing is running", async () => {
  const stub = makeStub({ pending: true });
  const ctx = await withManager("abort", { adapter: stub });
  try {
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "说得很长" });
    await ctx.manager.abort({ employeeId: ctx.employeeId });
    await ctx.manager.whenQuiet();

    assert.equal(stub.state.aborts, 1);
    assert.deepEqual(ctx.emitted.at(-1).event, { type: "agent_end", status: "failed" });
    assert.equal(/** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId)).status, "aborted");
    assert.throws(
      () => ctx.manager.abort({ employeeId: ctx.employeeId }),
      (err) => /** @type {{ code?: string }} */ (err).code === "no_active_run",
    );
    // the aborted run still belongs to the same reusable session
    assert.equal(started.session.id, /** @type {any} */ (ctx.store.employeeSessionById(started.session.id)).id);
  } finally {
    await ctx.dispose();
  }
});

test("cancel drains before releasing the employee: start is still employee_busy mid-drain", async () => {
  const adapter = {
    forAll: true,
    /** @param {{ session: any, onEvent: (event: any) => void }} input */
    async open({ session, onEvent }) {
      return {
        prompt: () => new Promise(() => {}),
        abort: async () => {},
        sessionFile: () => null,
      };
    },
  };
  const ctx = await withManager("cancel-drain", { adapter, drainTimeoutMs: 30 });
  try {
    ctx.manager.start({ employeeId: ctx.employeeId, text: "先跑着" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelling = ctx.manager.abort({ employeeId: ctx.employeeId });
    assert.equal(ctx.manager.activeRuns().length, 1, "abort 之后的 drain 窗口里，run 仍占着员工");
    assert.throws(
      () => ctx.manager.start({ employeeId: ctx.employeeId, text: "立刻重派" }),
      (err) => /** @type {{ code?: string }} */ (err).code === "employee_busy",
      "引擎收尾前不允许新 run 复用同一员工",
    );
    await cancelling;
    assert.equal(ctx.manager.activeRuns().length, 0, "drain 结束后才释放员工");
    assert.equal(/** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId)).status, "aborted");
  } finally {
    await ctx.dispose();
  }
});

test("换引擎后旧任务在自己的 workspace 跑，不跟着引擎目录漂移", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("task-workspace", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const oldWorkspace = path.join(ctx.dataDir, "old-task-workspace");
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: oldWorkspace,
      title: "换引擎也要认旧工作区",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "0".repeat(40),
    });
    ctx.store.setEmployeeEngine({ employeeId: ctx.employeeId, engine: "codex" });
    ctx.store.setEngineEnabled({ engine: "codex", enabled: true, manualOverride: true });

    ctx.manager.start({ employeeId: ctx.employeeId, text: "干活", task: { id: task.id } });
    await ctx.manager.whenQuiet();
    assert.equal(stub.state.session.workspaceDir, oldWorkspace, "task 行记录的工作区优先于引擎的共享工作区");
  } finally {
    await ctx.dispose();
  }
});

test("BYOK 配置指纹变化会退役缓存 handle，下一轮重新 open", async () => {
  const stub = /** @type {any} */ (makeStub({ events: [AGENT_END] }));
  let fingerprint = "models-v1";
  stub.configFingerprint = () => fingerprint;
  const h = await withManager("config-fingerprint", { adapter: stub });
  try {
    h.manager.start({ employeeId: h.employeeId, text: "第一轮" });
    await h.manager.whenQuiet();
    assert.equal(stub.state.opens, 1);

    fingerprint = "models-v2";
    h.manager.start({ employeeId: h.employeeId, text: "第二轮" });
    await h.manager.whenQuiet();
    assert.equal(stub.state.opens, 2, "models.json 变化后不能复用旧引擎会话 handle");
    assert.equal(h.store.latestRunForEmployee(h.employeeId)?.status, "completed");
  } finally {
    await h.dispose();
  }
});

test("一个 run 永不收尾时由 watchdog 强制结束，whenQuiet 不会挂死", async () => {
  const adapter = {
    forAll: true,
    async open() {
      return {
        prompt: () => new Promise(() => {}),
        abort: async () => {},
        sessionFile: () => null,
      };
    },
  };
  const ctx = await withManager("run-watchdog", { adapter, runTimeoutMs: 25, drainTimeoutMs: 20 });
  try {
    ctx.manager.start({ employeeId: ctx.employeeId, text: "卡死不回" });
    await ctx.manager.whenQuiet();
    assert.equal(ctx.manager.activeRuns().length, 0);
    assert.equal(/** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId)).status, "aborted");
    assert.ok(ctx.emitted.some((p) => p.event.type === "error" && p.event.code === "run_timeout"));
  } finally {
    await ctx.dispose();
  }
});

test("an engine that cannot start surfaces an error event and fails the run", async () => {
  const stub = makeStub({ openThrows: { code: "engine_not_configured" } });
  const ctx = await withManager("engine-fail", { adapter: stub });
  try {
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "随便说" });
    await ctx.manager.whenQuiet();

    const codes = ctx.emitted.filter((p) => p.event.type === "error").map((p) => p.event.code);
    assert.deepEqual(codes, ["engine_not_configured"]);
    assert.deepEqual(ctx.emitted.at(-1).event, { type: "agent_end", status: "failed" });
    assert.equal(/** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId)).status, "failed");
    assert.ok(started.run.id > 0);
  } finally {
    await ctx.dispose();
  }
});

test("engines without an adapter are rejected up front with engine_unavailable", async () => {
  const ctx = await withManager("no-adapter", { adapter: null });
  try {
    assert.throws(
      () => ctx.manager.start({ employeeId: ctx.employeeId, text: "喂" }),
      (err) => /** @type {{ code?: string }} */ (err).code === "engine_unavailable",
    );
    assert.deepEqual(ctx.emitted, []);
    assert.equal(ctx.store.latestRunForEmployee(ctx.employeeId), null);
  } finally {
    await ctx.dispose();
  }
});

test("history answers with the last run and the events streamed for it", async () => {
  const stub = makeStub({ events: [{ type: "text_delta", text: "答" }, AGENT_END] });
  const ctx = await withManager("history", { adapter: stub });
  try {
    const fresh = ctx.manager.history({ employeeId: ctx.employeeId });
    assert.equal(fresh.lastRun, null);
    assert.deepEqual(fresh.events, []);

    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "问" });
    await ctx.manager.whenQuiet();

    const after = ctx.manager.history({ employeeId: ctx.employeeId });
    assert.ok(after.lastRun);
    assert.equal(after.lastRun.id, started.run.id);
    assert.equal(after.lastRun.status, "completed");
    assert.deepEqual(after.events.map((e) => e.event.type), ["session_start", "text_delta", "agent_end"]);
  } finally {
    await ctx.dispose();
  }
});

test("history tail keeps at most the newest events, dropping from the front", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("history-cap", { adapter: stub });
  try {
    ctx.manager.start({ employeeId: ctx.employeeId, text: "刷屏" });
    for (let i = 0; i < 500; i += 1) stub.push({ type: "text_delta", text: `#${i}` });
    await ctx.manager.whenQuiet();

    const after = ctx.manager.history({ employeeId: ctx.employeeId });
    assert.ok(after.events.length <= 400, `tail capped, got ${after.events.length}`);
    assert.equal(/** @type {any} */ (after.events[0]).event.type, "text_delta", "the OLD head was dropped, not a middle event");
    assert.equal(/** @type {any} */ (after.events[after.events.length - 1]).event.type, "agent_end");
    assert.ok(
      after.events.some((entry) => /** @type {any} */ (entry.event).text === "#499"),
      "the newest deltas survive",
    );
  } finally {
    await ctx.dispose();
  }
});

test("an engine that settles silently still ends the run as failed", async () => {
  const stub = makeStub({ events: [] });
  const ctx = await withManager("silent-settle", { adapter: stub });
  try {
    ctx.manager.start({ employeeId: ctx.employeeId, text: "没回音" });
    await ctx.manager.whenQuiet();

    const end = ctx.emitted.at(-1).event;
    assert.equal(end.type, "agent_end");
    assert.equal(end.status, "unknown");
    assert.equal(/** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId)).status, "failed");
  } finally {
    await ctx.dispose();
  }
});

test("start rejects unknown employees and empty text", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("validation", { adapter: stub });
  try {
    assert.throws(
      () => ctx.manager.start({ employeeId: 99999, text: "有人吗" }),
      (err) => /** @type {{ code?: string }} */ (err).code === "unknown_employee",
    );
    assert.throws(
      () => ctx.manager.start({ employeeId: ctx.employeeId, text: "   " }),
      (err) => /** @type {{ code?: string }} */ (err).code === "invalid_payload",
    );
  } finally {
    await ctx.dispose();
  }
});

test("a task run folds turn_end usage onto its run row (票 06: 本任务 token 的来源)", async () => {
  const stub = makeStub({
    events: [
      { type: "turn_start" },
      { type: "turn_end", status: "ok", usage: { input: 100, cachedInput: 10, cacheWrite: 2, output: 20, reasoning: 5 } },
      { type: "turn_start" },
      { type: "turn_end", status: "ok", usage: { input: 50, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0 } },
      AGENT_END,
    ],
  });
  const ctx = await withManager("task-usage", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: "C:\\nowhere",
      title: "t",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "干活", task: { id: task.id } });
    await ctx.manager.whenQuiet();

    const run = /** @type {any} */ (ctx.store.runById(started.run.id));
    assert.deepEqual(run.usage, { input: 150, cachedInput: 10, cacheWrite: 2, output: 50, reasoning: 5 });
    assert.equal(ctx.store.taskTokenSummary(task.id).total, 150 + 10 + 2 + 50 + 5);
  } finally {
    await ctx.dispose();
  }
});

test("runs with no reported usage keep the run row honest (usage stays null)", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("task-usage-none", { adapter: stub });
  try {
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "干活" });
    await ctx.manager.whenQuiet();
    assert.equal(/** @type {any} */ (ctx.store.runById(started.run.id)).usage, null);
  } finally {
    await ctx.dispose();
  }
});

test("打回后再开工: the same task grows a second task session on the SAME employee session, one live engine session", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("task-iteration", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: "C:\\nowhere",
      title: "t",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });

    const first = ctx.manager.start({ employeeId: ctx.employeeId, text: "第一轮", task: { id: task.id } });
    await ctx.manager.whenQuiet();
    ctx.store.setTaskStatus(task.id, "review"); // 跑完自动待验收（hook 语义，这里直接落状态）

    const second = ctx.manager.start({ employeeId: ctx.employeeId, text: "打回后重来", task: { id: task.id } });
    await ctx.manager.whenQuiet();

    const sessions = ctx.store.listTaskSessions(task.id);
    assert.equal(sessions.length, 2, "迭代次数 = 任务下的会话条数");
    assert.ok(/** @type {number} */ (second.run.taskSessionId) > /** @type {number} */ (first.run.taskSessionId), "新迭代是追加，不是改写");
    assert.equal(sessions[0].employeeSessionId, sessions[1].employeeSessionId, "历史连续：同一员工会话实体");
    assert.equal(stub.state.opens, 1, "引擎会话跨迭代复用 — 对话历史延续");
    assert.deepEqual(stub.state.prompts, ["第一轮", "打回后重来"]);
    const total = ctx.store.taskTokenSummary(task.id);
    assert.equal(total.total, 0);
  } finally {
    await ctx.dispose();
  }
});

test("a task run opens a task session, marks the task running, and hands the run tail to the task hook", async () => {
  const stub = makeStub({ events: [{ type: "text_delta", text: "好的" }, AGENT_END] });
  const ctx = await withManager("task-hook", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: "C:\\nowhere",
      title: "t",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });
    /** @type {any[]} */
    const hookCalls = [];
    const manager = createRunManager({
      store: ctx.store,
      getAdapter: () => stub,
      emit: () => {},
      onTaskRunFinished: (/** @type {any} */ call) => { hookCalls.push(call); },
    });

    const started = manager.start({ employeeId: ctx.employeeId, text: "干活", task: { id: task.id } });
    assert.equal(started.run.taskId, task.id);
    assert.notEqual(started.run.taskSessionId, null);
    assert.equal(/** @type {any} */ (ctx.store.taskById(task.id)).status, "running");

    await manager.whenQuiet();
    assert.equal(hookCalls.length, 1);
    assert.equal(hookCalls[0].run.id, started.run.id);
    assert.equal(hookCalls[0].status, "completed");
    assert.deepEqual(
      hookCalls[0].events.map((/** @type {any} */ e) => e.event.type),
      ["session_start", "text_delta", "agent_end"],
    );
    const taskSession = /** @type {any} */ (ctx.store.latestTaskSessionForTask(task.id));
    assert.equal(taskSession.id, started.run.taskSessionId);
    assert.equal(taskSession.status, "completed");

    // a plain chat run never enters the task story
    manager.start({ employeeId: ctx.employeeId, text: "闲聊" });
    await manager.whenQuiet();
    assert.equal(hookCalls.length, 1);
  } finally {
    await ctx.dispose();
  }
});

// — 上下班 (ticket 09: 宽限后落盘 paused / 上班续跑追加会话) —

test("下班落盘：pause 把 run 与 task_session 合上为 paused，任务保持进行中，hook 收到 paused", async () => {
  const stub = makeStub({ pending: true });
  const ctx = await withManager("pause-landing", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: "C:\\nowhere",
      title: "慢活",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });
    /** @type {any[]} */
    const hookCalls = [];
    const manager = createRunManager({
      store: ctx.store,
      getAdapter: () => stub,
      emit: () => {},
      onTaskRunFinished: (/** @type {any} */ call) => { hookCalls.push(call); },
    });

    const started = manager.start({ employeeId: ctx.employeeId, text: "慢慢干", task: { id: task.id } });
    assert.equal(/** @type {any} */ (ctx.store.taskById(task.id)).status, "running");

    await manager.pause({ employeeId: ctx.employeeId });
    await manager.whenQuiet();

    assert.equal(stub.state.aborts, 1, "下班收尾走引擎 abort — 之后不再产生新的工具调用");
    const run = /** @type {any} */ (ctx.store.runById(started.run.id));
    assert.equal(run.status, "paused");
    assert.notEqual(run.endedAt, null);
    const taskSession = /** @type {any} */ (ctx.store.latestTaskSessionForTask(task.id));
    assert.equal(taskSession.status, "paused");
    assert.equal(/** @type {any} */ (ctx.store.taskById(task.id)).status, "running", "五状态不新增第六态：任务还在「进行中」");
    assert.equal(hookCalls.length, 1);
    assert.equal(hookCalls[0].status, "paused", "task hook 认得 paused：不落四件套、不搬任务状态");
  } finally {
    await ctx.dispose();
  }
});

test("pause 无在跑的员工作报告 no_active_run（宽限内 run 已自己收尾就是这条路）", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("pause-noop", { adapter: stub });
  try {
    ctx.manager.start({ employeeId: ctx.employeeId, text: "快活" });
    await ctx.manager.whenQuiet();
    assert.throws(
      () => ctx.manager.pause({ employeeId: ctx.employeeId }),
      (err) => /** @type {{ code?: string }} */ (err).code === "no_active_run",
    );
    assert.equal(/** @type {any} */ (ctx.store.latestRunForEmployee(ctx.employeeId)).status, "completed", "先收尾的 run 不会被事后 pause 改写");
  } finally {
    await ctx.dispose();
  }
});

test("上班续跑：resume 在同一任务上追加 task_session，不动任务状态、复用引擎会话", async () => {
  const stub = makeStub({ pending: true });
  const ctx = await withManager("resume-append", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: "C:\\nowhere",
      title: "跨夜慢活",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });

    const first = ctx.manager.start({ employeeId: ctx.employeeId, text: "上班干活", task: { id: task.id } });
    await ctx.manager.pause({ employeeId: ctx.employeeId }); // 下班落盘
    await ctx.manager.whenQuiet();
    assert.equal(/** @type {any} */ (ctx.store.latestTaskSessionForTask(task.id)).status, "paused");
    assert.equal(/** @type {any} */ (ctx.store.taskById(task.id)).status, "running");

    // 五状态转移表会拒绝 running→running —— resume 跳过状态门（任务本就在进行中）
    const second = ctx.manager.start({ employeeId: ctx.employeeId, text: "上班续跑", task: { id: task.id }, resume: true });
    assert.notEqual(second.run.taskSessionId, null);
    assert.ok(/** @type {number} */ (second.run.taskSessionId) > /** @type {number} */ (first.run.taskSessionId), "续跑 = 追加一条 task_session（与打回同构）");

    stub.push(AGENT_END, ctx.employeeId); // 续跑那轮照常跑完
    stub.settle(ctx.employeeId);
    await ctx.manager.whenQuiet();

    const sessions = ctx.store.listTaskSessions(task.id);
    assert.deepEqual(sessions.map((s) => s.status), ["paused", "completed"]);
    assert.equal(/** @type {any} */ (ctx.store.runById(second.run.id)).status, "completed", "续跑那轮是正常的一轮 run（hook 会照常把它搬进待验收）");
    assert.equal(sessions[0].employeeSessionId, sessions[1].employeeSessionId, "同一员工会话实体：历史连续");
    assert.equal(stub.state.opens, 1, "引擎会话跨暂停续跑复用：对话记忆延续");
    assert.equal(/** @type {any} */ (ctx.store.taskById(task.id)).status, "running", "任务状态搬运归 task hook（artifacts seam 钉），manager 只管会话与 run");
  } finally {
    await ctx.dispose();
  }
});

test("resume 只给「进行中」的任务续跑：待办/待验收误用被拒", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("resume-guard", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: "C:\\nowhere",
      title: "t",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });
    // 待办：走 resume 是误用（待办续跑应走普通派单，open→running 合法）
    assert.throws(
      () => ctx.manager.start({ employeeId: ctx.employeeId, text: "续跑", task: { id: task.id }, resume: true }),
      (err) => /** @type {{ code?: string }} */ (err).code === "invalid_transition",
    );
    assert.equal(ctx.store.listTaskSessions(task.id).length, 0, "被拒的 resume 不留悬挂会话行");
  } finally {
    await ctx.dispose();
  }
});

test("票 10 崩溃续跑（整环）：强杀遗留 running 行 → 开库自愈 → resume 通道 open→running + 追加会话；恢复指针崩溃前就已落库", async () => {
  const stub = makeStub({ pending: true });
  const ctx = await withManager("crash-resume", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const task = ctx.store.createTask({
      groupId: group.id,
      employeeId: ctx.employeeId,
      workspaceDir: "C:\\nowhere",
      title: "崩溃的慢活",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "d".repeat(40),
    });
    const first = ctx.manager.start({ employeeId: ctx.employeeId, text: "派单慢活", task: { id: task.id } });
    await waitForActive(ctx.manager, 1); // 引擎会话已 open：恢复指针应当已经落库（不等 finishRun）

    // 崩溃时指针就已在库里 —— 否则每次首轮崩溃都退化成「只能重跑」。
    assert.equal(
      /** @type {any} */ (ctx.store.employeeSessionById(/** @type {number} */ (first.run.employeeSessionId))).sessionFile,
      stub.sessionFileFor ?? path.join("E:", "engine", "session.jsonl"), // makeStub 默认指针
      "resume pointer is persisted as soon as the engine session opens, not only at finishRun",
    );

    // 「强杀」：run 行还 running 就掀桌（store seam 钉过自愈语义，这里走整环）。
    const store = openStore({ dataDir: ctx.dataDir });
    assert.equal(/** @type {any} */ (store.taskById(task.id)).status, "open", "自愈后任务回待办（04/06 语义不变）");
    assert.equal(/** @type {any} */ (store.latestTaskSessionForTask(task.id)).status, "interrupted");

    const manager = createRunManager({ store, getAdapter: () => stub, emit: () => {} });
    const second = manager.start({ employeeId: ctx.employeeId, text: "崩溃续跑", task: { id: task.id }, resume: true });
    assert.equal(/** @type {any} */ (store.taskById(task.id)).status, "running", "interrupted 续跑走 open→running 合法转移 + resume 标记");
    assert.ok(
      /** @type {number} */ (second.run.taskSessionId) > /** @type {number} */ (first.run.taskSessionId),
      "续跑 = 追加一条 task_session（与打回/上班续跑同构）",
    );
    stub.push(AGENT_END, ctx.employeeId);
    stub.settle(ctx.employeeId);
    await manager.whenQuiet();

    const sessions = store.listTaskSessions(task.id);
    assert.deepEqual(sessions.map((s) => s.status), ["interrupted", "completed"]);
    assert.equal(sessions[0].employeeSessionId, sessions[1].employeeSessionId, "同一员工会话实体：历史连续");
    store.close();
  } finally {
    await ctx.dispose();
  }
});

test("activeRuns 列出在跑的 run（下班 pauseAll 的迭代入口），多员工互不牵连", async () => {
  const stub = makeStub({ pending: true });
  const ctx = await withManager("active-runs", { adapter: stub });
  try {
    const group = ctx.store.officeSnapshot().groups[0];
    const desks = ctx.store.listDesks({ groupId: group.id });
    const programmer = /** @type {any} */ (ctx.store.listRoles().find((r) => r.key === "programmer"));
    const other = ctx.store.hireEmployee({ deskId: desks[1].id, roleId: programmer.id, name: "小程二" }).employee;

    ctx.manager.start({ employeeId: ctx.employeeId, text: "活一" });
    ctx.manager.start({ employeeId: other.id, text: "活二" });
    const actives = ctx.manager.activeRuns();
    assert.deepEqual(actives.map((run) => run.employeeId).sort((a, b) => a - b), [ctx.employeeId, other.id].sort((a, b) => a - b));

    await ctx.manager.pause({ employeeId: ctx.employeeId });
    await waitForActive(ctx.manager, 1);
    const remaining = ctx.manager.activeRuns();
    assert.deepEqual(remaining.map((run) => run.employeeId), [other.id], "pause 单个员工不牵连别人（多公司/多员工并行硬约束）");
    const pausedRun = actives.find((run) => run.employeeId === ctx.employeeId);
    assert.ok(pausedRun, "employee 1 had an active run before the pause");
    assert.equal(/** @type {any} */ (ctx.store.runById(pausedRun.id)).status, "paused");

    await ctx.manager.abort({ employeeId: other.id });
    await ctx.manager.whenQuiet();
  } finally {
    await ctx.dispose();
  }
});

/** poll helper for the activeRuns view */
async function waitForActive(
  /** @type {{ activeRuns(): { id: number, employeeId: number }[] }} */ manager,
  /** @type {number} */ wanted,
) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (manager.activeRuns().length === wanted) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`activeRuns never settled at ${wanted}: got ${manager.activeRuns().length}`);
}

// — 失败与成本 (ticket 12: 人话原因落库 / 预算软闸自动 pause / usage 三态) —

/** Create a task under the ctx employee with a token budget (票 12). */
function taskWithBudget(
  /** @type {{ store: ReturnType<typeof openStore>, employeeId: number }} */ ctx,
  /** @type {number} */ tokenBudget,
) {
  const group = ctx.store.officeSnapshot().groups[0];
  return ctx.store.createTask({
    groupId: group.id,
    employeeId: ctx.employeeId,
    workspaceDir: "C:\\nowhere",
    title: "预算活",
    goal: "g",
    playbook: "free",
    acceptance: [],
    baseHead: "d".repeat(40),
    tokenBudget,
  });
}

test("失败收尾把 explainRunFailure 的人话写进 run.fail_reason（不是堆栈）", async () => {
  const stub = makeStub({ openThrows: { code: "engine_not_configured" } });
  const ctx = await withManager("fail-reason", { adapter: stub });
  try {
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "随便说" });
    await ctx.manager.whenQuiet();

    const run = /** @type {any} */ (ctx.store.runById(started.run.id));
    assert.equal(run.status, "failed");
    assert.match(run.failReason, /引擎还没配置模型/);
    assert.match(run.failReason, /engine_not_configured/);
    assert.doesNotMatch(String(run.failReason), /\n\s+at /);
  } finally {
    await ctx.dispose();
  }
});

test("取消的 run 人话是已取消；paused（下班/预算）不带失败原因", async () => {
  const stub = makeStub({ pending: true });
  const ctx = await withManager("fail-cancel", { adapter: stub });
  try {
    const chat = ctx.manager.start({ employeeId: ctx.employeeId, text: "说得很长" });
    await ctx.manager.abort({ employeeId: ctx.employeeId });
    await ctx.manager.whenQuiet();
    assert.match(/** @type {any} */ (ctx.store.runById(chat.run.id)).failReason, /已取消/);

    const work = ctx.manager.start({ employeeId: ctx.employeeId, text: "下班会暂停" });
    await ctx.manager.pause({ employeeId: ctx.employeeId });
    await ctx.manager.whenQuiet();
    const pausedRun = /** @type {any} */ (ctx.store.runById(work.run.id));
    assert.equal(pausedRun.status, "paused");
    assert.equal(pausedRun.failReason, null, "暂停不是失败，没有失败原因可读");
  } finally {
    await ctx.dispose();
  }
});

test("引擎没发 agent_end 就收场：人话写明「没有回音」", async () => {
  const stub = makeStub({ events: [] });
  const ctx = await withManager("fail-silent", { adapter: stub });
  try {
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "没回音" });
    await ctx.manager.whenQuiet();
    assert.match(/** @type {any} */ (ctx.store.runById(started.run.id)).failReason, /没有回音/);
  } finally {
    await ctx.dispose();
  }
});

test("turn_end 报全 0 usage：落「计量到 0」不塌 null；没报才 null（缺失与 0 严格区分）", async () => {
  const stub = makeStub({
    events: [{ type: "turn_end", status: "ok", usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 } }, AGENT_END],
  });
  const ctx = await withManager("zero-usage", { adapter: stub });
  try {
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "报了 0" });
    await ctx.manager.whenQuiet();
    const run = /** @type {any} */ (ctx.store.runById(started.run.id));
    assert.deepEqual(run.usage, { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 });
    const summary = /** @type {any} */ (ctx.store.taskTokenSummary(started.run.taskId ?? 0));
    assert.equal(summary.measured, false, "没有 task 的闲聊 run 不该出现在任何任务账单里");
  } finally {
    await ctx.dispose();
  }
});

test("任务 run 的事件 payload 携带 taskId（三层 token 可见的 UI 路由）", async () => {
  const stub = makeStub({ events: [AGENT_END] });
  const ctx = await withManager("event-taskid", { adapter: stub });
  try {
    const task = taskWithBudget(ctx, 500);
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "干活", task: { id: task.id } });
    await ctx.manager.whenQuiet();
    assert.ok(ctx.emitted.every((p) => p.taskId === task.id), "task run 的每个事件都带 taskId");
    assert.ok(started.run.taskId === task.id);

    ctx.manager.start({ employeeId: ctx.employeeId, text: "闲聊" });
    await ctx.manager.whenQuiet();
    assert.ok(ctx.emitted.slice(-2).every((p) => p.taskId === null), "闲聊事件 taskId 为 null");
  } finally {
    await ctx.dispose();
  }
});

test("预算软闸：80% 发一次 budget_warning（带 tokens/budget），不到 100% 不打断", async () => {
  const stub = makeStub({
    events: [
      { type: "turn_end", status: "ok", usage: { input: 300, cachedInput: 0, cacheWrite: 0, output: 10, reasoning: 0 } },
      { type: "turn_end", status: "ok", usage: { input: 90, cachedInput: 0, cacheWrite: 0, output: 5, reasoning: 0 } }, // 累计 405/500 = 81%
      AGENT_END,
    ],
  });
  const ctx = await withManager("budget-warn", { adapter: stub });
  try {
    const task = taskWithBudget(ctx, 500);
    const started = ctx.manager.start({ employeeId: ctx.employeeId, text: "干活", task: { id: task.id } });
    await ctx.manager.whenQuiet();

    const warns = ctx.emitted.filter((p) => p.event.type === "budget_warning");
    assert.equal(warns.length, 1, "黄点只报一次，不刷屏");
    assert.equal(warns[0].event.tokens, 405);
    assert.equal(warns[0].event.budget, 500);
    assert.equal(warns[0].taskId, task.id);
    assert.deepEqual(ctx.emitted.filter((p) => p.event.type === "budget_exhausted"), []);
    const run = /** @type {any} */ (ctx.store.runById(started.run.id));
    assert.equal(run.status, "completed", "warn 不掐 run — 黄点只是提示");
    assert.equal(/** @type {any} */ (ctx.store.taskById(task.id)).status, "running", "状态搬运仍归 task hook");
  } finally {
    await ctx.dispose();
  }
});

test("预算软闸 100%：发 budget_exhausted 后自动 pause — 复用 09 的 paused 落盘层", async () => {
  const stub = makeStub({
    events: [
      { type: "turn_end", status: "ok", usage: { input: 300, cachedInput: 0, cacheWrite: 0, output: 10, reasoning: 0 } }, // 62%
      { type: "turn_end", status: "ok", usage: { input: 150, cachedInput: 0, cacheWrite: 0, output: 40, reasoning: 0 } }, // 累计 500/500 = 100%
      AGENT_END, // 到顶后引擎再说什么都不该再算
    ],
    pending: true,
  });
  const ctx = await withManager("budget-exhausted", { adapter: stub });
  try {
    const task = taskWithBudget(ctx, 500);
    const hookCalls = /** @type {any[]} */ ([]);
    const manager = createRunManager({
      store: ctx.store,
      getAdapter: () => stub,
      emit: (payload) => ctx.emitted.push(payload),
      onTaskRunFinished: (/** @type {any} */ call) => { hookCalls.push(call); },
    });

    const started = manager.start({ employeeId: ctx.employeeId, text: "烧钱", task: { id: task.id } });
    await manager.whenQuiet();

    const exhausted = ctx.emitted.filter((p) => p.event.type === "budget_exhausted");
    assert.equal(exhausted.length, 1);
    assert.ok(Number(exhausted[0].event.tokens) >= 500);
    assert.equal(exhausted[0].taskId, task.id);

    const run = /** @type {any} */ (ctx.store.runById(started.run.id));
    assert.equal(run.status, "paused", "到顶自动暂停 = 09 的 paused 落盘层，不新增第六态");
    assert.notEqual(run.usage, null, "暂停时把已烧的 usage 落库（账单不说谎）");
    const taskSession = /** @type {any} */ (ctx.store.latestTaskSessionForTask(task.id));
    assert.equal(taskSession.status, "paused");
    assert.equal(/** @type {any} */ (ctx.store.taskById(task.id)).status, "running", "任务五状态不动，挂「预算到顶」由视图判");
    assert.equal(hookCalls.length, 1);
    assert.equal(hookCalls[0].status, "paused", "task hook 认得 paused：不落四件套");
    assert.equal(stub.state.aborts, 1, "暂停走引擎 abort — 到顶后不再产生新的工具调用");
  } finally {
    await ctx.dispose();
  }
});
