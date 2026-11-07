import assert from "node:assert/strict";
import { test } from "node:test";

import { initialDeskActivity, reduceDeskActivity } from "../renderer/src/scene/deskActivity.js";
import { initialMotion, advanceMotion, motionOnWork } from "../renderer/src/scene/idleMotion.js";
import { deskSignals, bubbleTextFor } from "../renderer/src/scene/deskReadout.js";

// Ticket 07 acceptance: 名牌与气泡可开关；关掉后仍能看出「在忙/在闲」.
// The seam: signals are derived from state alone — nameplate/bubble
// preference cannot reach this function, so the always-on readout cannot be
// switched off by construction.

const WORKING = motionOnWork(initialMotion(0), 0);
const BUSY = reduceDeskActivity(initialDeskActivity(), { type: "session_start", sessionId: "1" }, 0);

test("busy/idle signals are derived from state, never from text prefs", () => {
  assert.deepEqual(deskSignals(BUSY, WORKING), { busy: true, light: "working" });
  assert.deepEqual(deskSignals(initialDeskActivity(), initialMotion(0)), { busy: false, light: "idle" });
});

test("the idle postures stay readable without any label: 摸鱼 / 咖啡", () => {
  assert.equal(deskSignals(initialDeskActivity(), advanceMotion(initialMotion(0), 9_000)).light, "slack");
  assert.equal(deskSignals(initialDeskActivity(), advanceMotion(initialMotion(0), 45_000)).light, "coffee");
});

test("an unresolved 拒绝 outranks idle postures on the always-on light", () => {
  const blocked = reduceDeskActivity(initialDeskActivity(), { type: "policy_blocked", toolCallId: "x", toolName: "bash", rule: "r", reason: "x" }, 0);
  assert.deepEqual(deskSignals(blocked, initialMotion(0)), { busy: false, light: "blocked" });
});

test("bubble text names what the desk is doing — every kind readable", () => {
  /** @param {string} toolName @param {Record<string, unknown>} args */
  const withTool = (toolName, args) =>
    reduceDeskActivity(BUSY, { type: "tool_execution_start", toolCallId: "t", toolName, args }, 0);
  assert.equal(bubbleTextFor(withTool("read", {}), WORKING), "在看资料");
  assert.equal(bubbleTextFor(withTool("write", {}), WORKING), "在写东西");
  assert.equal(bubbleTextFor(withTool("bash", { command: "echo hi" }), WORKING), "在跑命令");
  assert.equal(bubbleTextFor(withTool("bash", { command: "npm test" }), WORKING), "在跑测试");
  assert.equal(bubbleTextFor(BUSY, WORKING), "在想事情");
});

test("test result rides into the bubble: 绿=通过 / 红=挂了", () => {
  /** @param {boolean} isError */
  const ran = (isError) =>
    reduceDeskActivity(
      withTest(),
      { type: "tool_execution_end", toolCallId: "t", toolName: "bash", isError, result: "" },
      0,
    );
  assert.equal(bubbleTextFor(ran(false), WORKING), "测试通过了");
  assert.equal(bubbleTextFor(ran(true), WORKING), "测试挂了");
  function withTest() {
    return reduceDeskActivity(BUSY, { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { command: "npm test" } }, 0);
  }
});

test("bubble falls back to the idle posture, and off at a normal desk", () => {
  const blocked = reduceDeskActivity(initialDeskActivity(), { type: "policy_blocked", toolCallId: "x", toolName: "bash", rule: "r", reason: "工位不许递归强删" }, 0);
  assert.equal(bubbleTextFor(blocked, initialMotion(0)), "被策略拦下");
  assert.equal(bubbleTextFor(initialDeskActivity(), advanceMotion(initialMotion(0), 9_000)), "摸鱼中…");
  assert.equal(bubbleTextFor(initialDeskActivity(), advanceMotion(initialMotion(0), 45_000)), "去倒咖啡了");
  assert.equal(bubbleTextFor(initialDeskActivity(), initialMotion(0)), null);
});
