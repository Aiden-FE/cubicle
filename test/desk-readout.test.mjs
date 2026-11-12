import assert from "node:assert/strict";
import { test } from "node:test";

import { initialDeskActivity, reduceDeskActivity } from "../renderer/src/scene/deskActivity.js";
import { initialMotion, advanceMotion, motionOnWork } from "../renderer/src/scene/idleMotion.js";
import { deskSignals } from "../renderer/src/scene/deskReadout.js";

// Ticket 07/17 acceptance: 名牌可开关；状态不靠文字，靠动作/屏幕/常亮状态灯.
// The seam: signals are derived from state alone — no text preference exists.

const WORKING = motionOnWork(initialMotion(0), 0);
const BUSY = reduceDeskActivity(initialDeskActivity(), { type: "session_start", sessionId: "1" }, 0);
const phone = () => 0.1;
const minesweeper = () => 0.5;
const coffee = () => 0.9;

test("busy/idle signals are derived from state, never from text prefs", () => {
  assert.deepEqual(deskSignals(BUSY, WORKING), { busy: true, light: "working" });
  assert.deepEqual(deskSignals(initialDeskActivity(), initialMotion(0)), { busy: false, light: "idle" });
});

test("the three idle postures stay readable without any label: 手机 / 扫雷 / 咖啡", () => {
  assert.equal(deskSignals(initialDeskActivity(), advanceMotion(initialMotion(0), 9_000, undefined, phone)).light, "slack");
  assert.equal(deskSignals(initialDeskActivity(), advanceMotion(initialMotion(0), 9_000, undefined, minesweeper)).light, "slack");
  assert.equal(deskSignals(initialDeskActivity(), advanceMotion(initialMotion(0), 9_000, undefined, coffee)).light, "coffee");
});

test("an unresolved 拒绝 outranks idle postures on the always-on light", () => {
  const blocked = reduceDeskActivity(initialDeskActivity(), { type: "policy_blocked", toolCallId: "x", toolName: "bash", rule: "r", reason: "x" }, 0);
  assert.deepEqual(deskSignals(blocked, initialMotion(0)), { busy: false, light: "blocked" });
});
