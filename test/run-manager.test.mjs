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
 * @param {{ adapter?: any, dataDirPrefix?: string }} [options]
 */
async function withManager(name, options = {}) {
  const { adapter, dataDirPrefix = `cubicle-runs-${name}-` } = options;
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
  });
  return {
    store,
    manager,
    employee,
    employeeId: employee.id,
    emitted,
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
 * @param {{ events?: any[], pending?: boolean, openThrows?: { code: string } | null, sessionFile?: string | null }} [options]
 */
function makeStub({ events = [], pending = false, openThrows = null, sessionFile = path.join("E:", "engine", "session.jsonl") } = {}) {
  const state = { opens: 0, prompts: /** @type {string[]} */ ([]), aborts: 0, employee: /** @type {any} */ (null), session: /** @type {any} */ (null) };
  let endPrompt = /** @type {((value?: unknown) => void) | null} */ (null);
  let emit = /** @type {((event: any) => void) | null} */ (null);
  return {
    state,
    forAll: true,
    /**
     * @param {{ employee: any, session: any, onEvent: (event: any) => void }} input
     */
    async open({ employee, session, onEvent }) {
      state.opens += 1;
      state.employee = employee;
      state.session = session;
      emit = onEvent;
      if (openThrows) throw appError(openThrows.code, "stub engine cannot start");
      return {
        /** @param {string} text */
        async prompt(text) {
          state.prompts.push(text);
          for (const event of events) onEvent(event);
          if (pending) await new Promise((resolve) => (endPrompt = resolve));
        },
        async abort() {
          state.aborts += 1;
          if (pending) {
            onEvent({ type: "agent_end", status: "failed" });
            endPrompt?.();
          }
        },
        sessionFile: () => sessionFile,
      };
    },
    /** let a pending prompt finish */
    settle() {
      endPrompt?.();
    },
    /** push one more normalized event through the open subscription */
    push(/** @type {any} */ event) {
      emit?.(event);
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
    assert.ok(started.session.workspaceDir.includes(path.join("engines", "pi", `employee-${ctx.employeeId}`)));

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
