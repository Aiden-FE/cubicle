import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openStore } from "../src/host/store.mjs";
import { createProbeRunner, evaluateProbe } from "../src/host/engine/probe.mjs";

// ——— pure verdict logic ———

const PROBE_EVENT_A = [
  { type: "session_start", sessionId: "9" },
  { type: "turn_start" },
  { type: "text_delta", text: "我的上下文里有 CUBICLE_PROBE_MARKER=abc123 这行。" },
  { type: "tool_execution_start", toolCallId: "t1", toolName: "shell", args: { command: "echo cubicle-probe-ok" } },
  { type: "tool_execution_end", toolCallId: "t1", toolName: "shell", isError: false, result: { output: "cubicle-probe-ok" } },
  { type: "text_delta", text: "报告完毕。" },
  { type: "turn_end", status: "ok", usage: { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, reasoning: 0 } },
  { type: "agent_end", status: "ok" },
];

const PROBE_EVENT_B = [
  { type: "session_start", sessionId: "10" },
  { type: "turn_start" },
  { type: "policy_blocked", toolCallId: "b1", toolName: "Bash", rule: "recursive-force-delete", reason: "工位上禁止递归强制删除（会连工作区一起毁掉）" },
  { type: "text_delta", text: "这条命令被策略拦下了。" },
  { type: "turn_end", status: "ok", usage: { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, reasoning: 0 } },
  { type: "agent_end", status: "ok" },
];

test("a healthy two-run stream passes all four verdicts", () => {
  const verdicts = evaluateProbe({
    functionalEvents: PROBE_EVENT_A,
    refusalEvents: PROBE_EVENT_B,
    marker: "abc123",
  });
  assert.equal(verdicts.injection.result, "pass");
  assert.equal(verdicts.tools.result, "pass");
  assert.equal(verdicts.refusal.result, "pass");
  assert.equal(verdicts.events.result, "pass");
});

test("an answer without the marker fails 注入生效, everything else can still pass", () => {
  const events = PROBE_EVENT_A.map((e) =>
    e.type === "text_delta" ? { ...e, text: "我不知道什么标记。" } : e,
  );
  const verdicts = evaluateProbe({ functionalEvents: events, refusalEvents: PROBE_EVENT_B, marker: "abc123" });
  assert.equal(verdicts.injection.result, "fail");
  assert.equal(verdicts.tools.result, "pass");
  assert.equal(verdicts.events.result, "pass");
});

test("no executed tool pair fails 工具可见", () => {
  const events = PROBE_EVENT_A.filter((e) => e.type !== "tool_execution_start" && e.type !== "tool_execution_end");
  const verdicts = evaluateProbe({ functionalEvents: events, refusalEvents: PROBE_EVENT_B, marker: "abc123" });
  assert.equal(verdicts.tools.result, "fail");
});

test("a denied call that still reaches the engine fails 拒绝可见", () => {
  const events = [
    ...PROBE_EVENT_B.slice(0, 2),
    { type: "tool_execution_start", toolCallId: "x", toolName: "Bash", args: { command: "Remove-Item -Recurse -Force x" } },
    { type: "tool_execution_end", toolCallId: "x", toolName: "Bash", isError: false, result: {} },
    ...PROBE_EVENT_B.slice(3),
  ];
  const verdicts = evaluateProbe({ functionalEvents: PROBE_EVENT_A, refusalEvents: events, marker: "abc123" });
  assert.equal(verdicts.refusal.result, "fail");
});

test("a stream without its terminal agent_end fails 事件完整", () => {
  const events = PROBE_EVENT_A.slice(0, -1);
  const verdicts = evaluateProbe({ functionalEvents: events, refusalEvents: PROBE_EVENT_B, marker: "abc123" });
  assert.equal(verdicts.events.result, "fail");
});

test("exactly one agent_end and no engine error keeps 事件完整 honest", () => {
  const events = [...PROBE_EVENT_A, { type: "agent_end", status: "ok" }];
  const verdicts = evaluateProbe({ functionalEvents: events, refusalEvents: PROBE_EVENT_B, marker: "abc123" });
  assert.equal(verdicts.events.result, "fail");
});

// ——— probe runner against a scripted engine ———

function tempStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cubicle-probe-"));
  return { store: openStore({ dataDir: dir }), dir };
}

test("a probe started by the service (which already wrote 运行中) still runs", async () => {
  // Regression (ticket 11 e2e): the service flips probe_status to "running"
  // synchronously with its reply, then calls the runner. If the runner read
  // that same state back and refused, NO probe could ever start.
  const { store, dir } = tempStore();
  try {
    /** @type {((payload: any) => void)[]} */
    const listeners = [];
    const scripted = [PROBE_EVENT_A, PROBE_EVENT_B];
    let next = 300;
    const runner = createProbeRunner({
      store,
      markerFactory: () => "abc123",
      startRun: ({ employeeId }) => {
        const runId = ++next;
        setTimeout(() => {
          for (const event of scripted.shift() ?? []) for (const l of listeners) l({ runId, employeeId, event });
        }, 0);
        return { runId };
      },
      subscribeRunEvents: (listener) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    });

    store.setEngineProbeResult({ engine: "codex", status: "running" });
    const result = await runner.startProbe("codex");
    assert.equal(result.status, "passed");
    assert.equal(/** @type {any} */ (store.engineState("codex")).enabled, true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a probe that dies before its first run lands as failed, not stuck 运行中", async () => {
  const { store, dir } = tempStore();
  try {
    const runner = createProbeRunner({
      store,
      startRun: () => {
        throw new Error("codex 启动失败");
      },
      subscribeRunEvents: () => () => {},
    });

    store.setEngineProbeResult({ engine: "codex", status: "running" });
    await assert.rejects(() => runner.startProbe("codex"), /codex 启动失败/);
    const state = /** @type {any} */ (store.engineState("codex"));
    assert.equal(state.probeStatus, "failed");
    assert.match(state.probe.error, /codex 启动失败/);
    assert.equal(state.enabled, false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an engine error event explains the failed probe on the card", async () => {
  const { store, dir } = tempStore();
  try {
    const broken = [
      { type: "session_start" },
      { type: "turn_start" },
      { type: "error", code: "engine_exec_failed", message: "codex exec 退出码 1：missing field `command`" },
      { type: "agent_end", status: "unknown" },
    ];
    /** @type {((payload: any) => void)[]} */
    const listeners = [];
    let next = 400;
    const runner = createProbeRunner({
      store,
      startRun: ({ employeeId }) => {
        const runId = ++next;
        setTimeout(() => {
          for (const event of broken) for (const l of listeners) l({ runId, employeeId, event });
        }, 0);
        return { runId };
      },
      subscribeRunEvents: (listener) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    });

    const result = await runner.startProbe("codex");
    assert.equal(result.status, "failed");
    assert.match(result.verdicts.events.detail, /engine_exec_failed/);
    const state = /** @type {any} */ (store.engineState("codex"));
    assert.equal(state.probeStatus, "failed");
    assert.match(state.probe.error, /missing field/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the runner drives two probe runs through the run-manager seam and records four verdicts", async () => {
  const { store, dir } = tempStore();
  try {
    /** @type {((payload: any) => void)[]} */
    const listeners = [];
    /** @type {string[]} */
    const seenPrompts = [];
    let nextRunId = 100;
    const scripted = [PROBE_EVENT_A, PROBE_EVENT_B];
    const runner = createProbeRunner({
      store,
      markerFactory: () => "abc123",
      startRun: ({ employeeId, text }) => {
        seenPrompts.push(text);
        const runId = ++nextRunId;
        const events = scripted.shift() ?? [];
        setTimeout(() => {
          for (const event of events) {
            for (const l of listeners) l({ runId, employeeId, event });
          }
        }, 0);
        return { runId };
      },
      subscribeRunEvents: (listener) => {
        listeners.push(listener);
        return () => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
    });

    const result = await runner.startProbe("codex");
    assert.equal(seenPrompts.length, 2);
    assert.ok(seenPrompts[0].includes("CUBICLE_PROBE_MARKER"));
    assert.match(seenPrompts[1], /Remove-Item\s+-Recurse/);
    assert.equal(result.status, "passed");
    assert.deepEqual(
      Object.fromEntries(Object.entries(result.verdicts).map(([k, v]) => [k, v.result])),
      { injection: "pass", tools: "pass", refusal: "pass", events: "pass" },
    );

    const state = /** @type {any} */ (store.engineState("codex"));
    assert.equal(state.probeStatus, "passed");
    assert.equal(state.enabled, true); // a pass admits the engine
    assert.equal(state.probe.verdicts.refusal.result, "pass");

    // the hidden probe employee exists and carries the marker persona
    const snapshot = store.officeSnapshot();
    const seated = new Set(snapshot.desks.map((d) => d.occupant?.id));
    const probeEmployee = /** @type {any} */ (store.employeeByName("准入探针·codex"));
    assert.ok(probeEmployee, "probe employee row exists");
    assert.ok(!seated.has(probeEmployee.id), "the probe employee sits at no desk");
    assert.ok(probeEmployee.roleSnapshot.manifest.persona.includes("CUBICLE_PROBE_MARKER"));
    assert.equal(probeEmployee.roleSnapshot.manifest.engine, "codex");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing probe keeps the engine unadmitted but records everything", async () => {
  const { store, dir } = tempStore();
  try {
    const brokenA = [{ type: "session_start" }, { type: "turn_start" }, { type: "agent_end", status: "failed" }];
    const brokenB = [{ type: "session_start" }, { type: "turn_start" }, { type: "agent_end", status: "failed" }];
    /** @type {((payload: any) => void)[]} */
    const listeners = [];
    const scripted = [brokenA, brokenB];
    const runner = createProbeRunner({
      store,
      startRun: () => {
        const runId = ++next;
        setTimeout(() => {
          for (const event of scripted.shift() ?? []) for (const l of listeners) l({ runId, event });
        }, 0);
        return { runId };
      },
      subscribeRunEvents: (listener) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    });
    let next = 200;

    const result = await runner.startProbe("codex");
    assert.equal(result.status, "failed");
    const state = /** @type {any} */ (store.engineState("codex"));
    assert.equal(state.probeStatus, "failed");
    assert.equal(state.enabled, false); // failed does not admit
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
