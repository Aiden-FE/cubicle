import assert from "node:assert/strict";
import { test } from "node:test";

import { initialMotion, advanceMotion, motionOnWork, motionOnRelease, IDLE_THRESHOLDS } from "../renderer/src/scene/idleMotion.js";

// Ticket 07 acceptance: 空闲 9 秒摸鱼、45 秒去咖啡并返回工位 — the one
// animation layer that IS allowed to run on the clock. All expectations are
// literals at a fake clock; transitions must land exactly at the ticket's
// thresholds (the defaults themselves are asserted, they are the spec).

test("thresholds are the ticket's words: 9s 摸鱼, 45s 咖啡", () => {
  assert.equal(IDLE_THRESHOLDS.slackAtMs, 9_000);
  assert.equal(IDLE_THRESHOLDS.coffeeAtMs, 45_000);
});

test("a seated worker idles normally for the first 9 seconds", () => {
  let m = initialMotion(0);
  assert.deepEqual({ posture: m.posture, position: m.position }, { posture: "idle", position: "desk" });
  m = advanceMotion(m, 8_999);
  assert.equal(m.posture, "idle");
});

test("9 秒空闲 → 摸鱼（still at the desk）", () => {
  const m = advanceMotion(initialMotion(0), 9_000);
  assert.deepEqual({ posture: m.posture, position: m.position }, { posture: "slack", position: "desk" });
});

test("45 秒空闲 → 起身去咖啡（离座）", () => {
  const m = advanceMotion(initialMotion(0), 45_000);
  assert.deepEqual({ posture: m.posture, position: m.position }, { posture: "coffee", position: "away" });
});

test("coffee is a trip, not an exit: the employee returns to the desk", () => {
  const away = advanceMotion(initialMotion(0), 45_000);
  assert.equal(advanceMotion(away, 45_000 + IDLE_THRESHOLDS.coffeeReturnMs - 1).position, "away");
  const back = advanceMotion(away, 45_000 + IDLE_THRESHOLDS.coffeeReturnMs);
  assert.deepEqual({ posture: back.posture, position: back.position }, { posture: "idle", position: "desk" });
  // a fresh idle cycle starts from the return, not from the original anchor
  assert.equal(advanceMotion(back, back.anchor + 9_000).posture, "slack");
  assert.equal(advanceMotion(back, back.anchor + IDLE_THRESHOLDS.coffeeAtMs).posture, "coffee");
});

test("work freezes the idle clock — busy desks never 摸鱼 mid-run", () => {
  let m = motionOnWork(advanceMotion(initialMotion(0), 10_000), 10_000);
  assert.equal(m.posture, "work");
  m = advanceMotion(m, 100_000); // deep into both thresholds: still working
  assert.equal(m.posture, "work");
  assert.equal(m.position, "desk");
});

test("a sentence mid-coffee brings the employee straight back, working", () => {
  const away = advanceMotion(initialMotion(0), 45_000);
  const working = motionOnWork(away, 50_000);
  assert.deepEqual({ posture: working.posture, position: working.position }, { posture: "work", position: "desk" });
});

test("agent_end release restarts the idle cycle from that moment", () => {
  const released = motionOnRelease(motionOnWork(initialMotion(0), 5_000), 21_000);
  assert.equal(released.posture, "idle");
  assert.equal(advanceMotion(released, 29_999).posture, "idle");
  assert.equal(advanceMotion(released, 30_000).posture, "slack");
});

test("advance is idempotent — ticking twice at the same instant changes nothing", () => {
  const once = advanceMotion(initialMotion(0), 9_500);
  assert.deepEqual(advanceMotion(once, 9_500), once);
});
