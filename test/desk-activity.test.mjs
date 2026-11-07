import assert from "node:assert/strict";
import { test } from "node:test";

import { initialDeskActivity, reduceDeskActivity, expireDeskBlocked, DESK_BLOCKED_TTL_MS } from "../renderer/src/scene/deskActivity.js";

// Ticket 07 acceptance, event-driven half: 工位状态必须由归一化事件流驱动
// (session_start / tool_execution_* / policy_blocked / agent_end are the
// exact shapes from src/host/engine/events.mjs). Expectations are the
// ticket's words: 屏幕随状态切换、失败红/通过绿、被拒不静默.

/**
 * Fold a scripted event sequence, with a controllable clock.
 * @param {import("../src/host/engine/events.mjs").NormalizedEvent[]} events
 * @param {number} [startNow]
 */
function fold(events, startNow = 1_000) {
  let now = startNow;
  let state = initialDeskActivity();
  for (const event of events) {
    now += 1;
    state = reduceDeskActivity(state, event, now);
  }
  return { state, now };
}

test("an idle desk at the start shows nothing and is not busy", () => {
  const state = initialDeskActivity();
  assert.equal(state.working, false);
  assert.equal(state.activity, null);
  assert.equal(state.screenTone, null);
  assert.equal(state.blocked, null);
});

test("session_start flips the desk to busy and stays busy across turns", () => {
  const { state } = fold([{ type: "session_start", sessionId: "1" }, { type: "turn_end", status: "ok" }]);
  assert.equal(state.working, true);
});

test("tool activities switch the screen: 读 → 写 → 执行 per tool events", () => {
  const { state } = fold([
    { type: "session_start", sessionId: "1" },
    { type: "tool_execution_start", toolCallId: "a", toolName: "read", args: { path: "hello.txt" } },
    { type: "tool_execution_end", toolCallId: "a", toolName: "read", isError: false, result: "hi" },
    { type: "tool_execution_start", toolCallId: "b", toolName: "write", args: { path: "notes.md" } },
    { type: "tool_execution_start", toolCallId: "c", toolName: "bash", args: { command: "echo hi" } },
  ]);
  assert.equal(state.activity, "exec");
});

test("the screen holds the last tool kind until the next tool or the run end", () => {
  const { state } = fold([
    { type: "session_start", sessionId: "1" },
    { type: "tool_execution_start", toolCallId: "a", toolName: "grep", args: { pattern: "x" } },
    { type: "tool_execution_end", toolCallId: "a", toolName: "grep", isError: false, result: "" },
    { type: "text_delta", text: "找到了" },
  ]);
  assert.equal(state.activity, "read");
});

test("测试 passed → screen goes 绿(pass); 测试 failed → screen goes 红(fail)", () => {
  const green = fold([
    { type: "session_start", sessionId: "1" },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: false, result: "ok" },
  ]);
  assert.equal(green.state.activity, "test");
  assert.equal(green.state.screenTone, "pass");

  const red = fold([
    { type: "session_start", sessionId: "1" },
    { type: "tool_execution_start", toolCallId: "t2", toolName: "bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "t2", toolName: "bash", isError: true, result: "exit 1" },
  ]);
  assert.equal(red.state.activity, "test");
  assert.equal(red.state.screenTone, "fail");
});

test("non-test tools never touch the pass/fail tone", () => {
  const { state } = fold([
    { type: "session_start", sessionId: "1" },
    { type: "tool_execution_start", toolCallId: "w", toolName: "write", args: { path: "a.md" } },
    { type: "tool_execution_end", toolCallId: "w", toolName: "write", isError: true, result: "EACCES" },
  ]);
  assert.equal(state.screenTone, null);
});

test("policy_blocked raises a visible marker at the desk — never silent", () => {
  const { state, now } = fold([
    { type: "session_start", sessionId: "1" },
    { type: "tool_execution_start", toolCallId: "d", toolName: "bash", args: { command: "rm -rf important.txt" } },
    { type: "policy_blocked", toolCallId: "d", toolName: "bash", rule: "recursive-force-delete", reason: "工位上禁止递归强制删除" },
  ]);
  assert.ok(state.blocked, "blocked marker must be present");
  assert.equal(state.blocked.reason, "工位上禁止递归强制删除");
  assert.equal(state.blocked.at, now);
});

test("the blocked marker expires on the injected clock, and a fresh run clears it", () => {
  const { state, now } = fold([
    { type: "session_start", sessionId: "1" },
    { type: "policy_blocked", toolCallId: "d", toolName: "bash", rule: "r", reason: "x" },
  ]);
  assert.equal(expireDeskBlocked(state, now + DESK_BLOCKED_TTL_MS - 1).blocked !== null, true);
  assert.equal(expireDeskBlocked(state, now + DESK_BLOCKED_TTL_MS).blocked, null);
  const refocused = reduceDeskActivity(state, { type: "session_start", sessionId: "2" }, now + 10);
  assert.equal(refocused.blocked, null);
});

test("agent_end sends the desk home: idle, no screen mode, no tone; the marker rides on", () => {
  const { state } = fold([
    { type: "session_start", sessionId: "1" },
    { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "t", toolName: "bash", isError: true, result: "exit 1" },
    { type: "policy_blocked", toolCallId: "p", toolName: "bash", rule: "r", reason: "x" },
    { type: "agent_end", status: "failed" },
  ]);
  assert.equal(state.working, false);
  assert.equal(state.activity, null);
  assert.equal(state.screenTone, null);
  assert.notEqual(state.blocked, null, "a 拒绝 from this run stays visible after it ends");
});

test("deltas and unknown events never invent activity — no timer-theatre", () => {
  const { state } = fold([
    { type: "session_start", sessionId: "1" },
    { type: "text_delta", text: "想想" },
    { type: "thinking_delta", text: "…" },
    { type: "unknown", rawType: "mystery", payload: {} },
  ]);
  assert.equal(state.working, true);
  assert.equal(state.activity, null);
});
