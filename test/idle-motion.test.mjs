import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialMotion,
  advanceMotion,
  motionOnWork,
  motionOnRelease,
  pickSlackKind,
  isTripPosture,
  IDLE_THRESHOLDS,
} from "../renderer/src/scene/idleMotion.js";

// Ticket 17 + 18 acceptance: 9s idle → one random break among phone /
// minesweeper / coffee / water. A trip = walk to the aisle-routed target,
// stay exactly 5s, walk back, sit with a cup/bottle. All expectations are
// literals at a fake clock with an injected RNG and walk time.

const phone = () => 0.1;
const minesweeper = () => 0.3;
const coffee = () => 0.6;
const water = () => 0.9;
const walk = () => 2_500;

/** advanceMotion keeps its positional shape for existing callers. */
const tick = (/** @type {any} */ state, /** @type {number} */ now, /** @type {() => number} */ random = coffee) =>
  advanceMotion(state, now, IDLE_THRESHOLDS, random, walk);

test("thresholds: 9s idle, 5s at the machine/cooler, 10s seated break", () => {
  assert.equal(IDLE_THRESHOLDS.slackAtMs, 9_000);
  assert.equal(IDLE_THRESHOLDS.dwellMs, 5_000);
  assert.equal(IDLE_THRESHOLDS.sipMs, 10_000);
  assert.equal(IDLE_THRESHOLDS.phoneMs, 12_000);
  assert.equal(IDLE_THRESHOLDS.minesweeperMs, 12_000);
});

test("random break is evenly bucketed across phone / minesweeper / coffee / water", () => {
  assert.equal(pickSlackKind(0), "phone");
  assert.equal(pickSlackKind(0.24), "phone");
  assert.equal(pickSlackKind(0.26), "minesweeper");
  assert.equal(pickSlackKind(0.49), "minesweeper");
  assert.equal(pickSlackKind(0.51), "coffee");
  assert.equal(pickSlackKind(0.74), "coffee");
  assert.equal(pickSlackKind(0.76), "water");
  assert.equal(pickSlackKind(0.99), "water");
});

test("a seated worker idles normally for the first 9 seconds", () => {
  let m = initialMotion(0);
  assert.deepEqual({ posture: m.posture, position: m.position }, { posture: "idle", position: "desk" });
  m = tick(m, 8_999, coffee);
  assert.equal(m.posture, "idle");
  assert.equal(m.tripPhase, null);
  assert.equal(m.destination, null);
});

test("9s idle rolls exactly one break; trips carry a destination", () => {
  const p = tick(initialMotion(0), 9_000, phone);
  assert.deepEqual({ posture: p.posture, position: p.position }, { posture: "phone", position: "desk" });
  assert.equal(p.destination, null);

  const m = tick(initialMotion(0), 9_000, minesweeper);
  assert.deepEqual({ posture: m.posture, position: m.position }, { posture: "minesweeper", position: "desk" });

  const c = tick(initialMotion(0), 9_000, coffee);
  assert.deepEqual({ posture: c.posture, position: c.position }, { posture: "coffee", position: "away" });
  assert.equal(c.destination, "coffee");
  assert.equal(c.tripPhase, "to-target");

  const w = tick(initialMotion(0), 9_000, water);
  assert.deepEqual({ posture: w.posture, position: w.position }, { posture: "water", position: "away" });
  assert.equal(w.destination, "water");
});

test("isTripPosture only matches the two walking breaks", () => {
  assert.equal(isTripPosture("coffee"), true);
  assert.equal(isTripPosture("water"), true);
  assert.equal(isTripPosture("phone"), false);
  assert.equal(isTripPosture("work"), false);
});

test("phone / minesweeper stay 12s at the desk, then idle restarts", () => {
  /** @type {Array<[() => number, "phone" | "minesweeper"]>} */
  const cases = [[phone, "phone"], [minesweeper, "minesweeper"]];
  for (const [random, posture] of cases) {
    const slack = tick(initialMotion(0), 9_000, random);
    assert.equal(slack.posture, posture);
    assert.equal(tick(slack, 20_999, random).posture, posture);
    const idle = tick(slack, 21_000, random);
    assert.deepEqual({ posture: idle.posture, position: idle.position }, { posture: "idle", position: "desk" });
    assert.equal(idle.anchor, 21_000);
  }
});

test("a trip walks, stays exactly 5s, walks back, then sits with the drink", () => {
  let m = tick(initialMotion(0), 9_000, coffee);
  assert.equal(m.tripPhase, "to-target");

  m = tick(m, 11_499);
  assert.equal(m.tripPhase, "to-target");
  m = tick(m, 11_500);
  assert.equal(m.tripPhase, "at-target");
  assert.equal(m.position, "away");

  // the explicit 5 seconds at the machine, not a moment less
  m = tick(m, 16_499);
  assert.equal(m.tripPhase, "at-target");
  m = tick(m, 16_500);
  assert.equal(m.tripPhase, "returning");

  m = tick(m, 18_999);
  assert.equal(m.tripPhase, "returning");
  m = tick(m, 19_000);
  assert.equal(m.tripPhase, "sipping");
  assert.equal(m.position, "desk");

  m = tick(m, 28_999);
  assert.equal(m.tripPhase, "sipping");
  const idle = tick(m, 29_000);
  assert.deepEqual({ posture: idle.posture, position: idle.position }, { posture: "idle", position: "desk" });
  assert.equal(idle.anchor, 29_000);
});

test("the walk length comes from the caller's route, not a global constant", () => {
  const far = advanceMotion(initialMotion(0), 9_000, IDLE_THRESHOLDS, water, () => 3_400);
  assert.equal(advanceMotion(far, 11_000, IDLE_THRESHOLDS, water, () => 3_400).tripPhase, "to-target");
  assert.equal(advanceMotion(far, 12_400, IDLE_THRESHOLDS, water, () => 3_400).tripPhase, "at-target");

  const near = advanceMotion(initialMotion(0), 9_000, IDLE_THRESHOLDS, water, () => 1_400);
  assert.equal(advanceMotion(near, 11_000, IDLE_THRESHOLDS, water, () => 1_400).tripPhase, "at-target");
});

test("the RNG is consulted exactly once per idle→break transition", () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return 0.1;
  };
  const first = tick(initialMotion(0), 9_000, random);
  assert.equal(calls, 1);
  tick(first, 10_000, random);
  assert.equal(calls, 1);
});

test("work freezes the idle clock — busy desks never slack mid-run", () => {
  let m = motionOnWork(tick(initialMotion(0), 10_000, phone), 10_000);
  assert.equal(m.posture, "work");
  assert.equal(m.tripPhase, null);
  m = tick(m, 100_000, phone);
  assert.equal(m.posture, "work");
  assert.equal(m.position, "desk");
});

test("a sentence mid-trip brings the employee straight back, working", () => {
  const away = tick(initialMotion(0), 9_000, coffee);
  const working = motionOnWork(away, 12_000);
  assert.deepEqual({ posture: working.posture, position: working.position }, { posture: "work", position: "desk" });
  assert.equal(working.tripPhase, null);
  assert.equal(working.destination, null);
});

test("agent_end release restarts the idle cycle from that moment", () => {
  const released = motionOnRelease(motionOnWork(initialMotion(0), 5_000), 21_000);
  assert.equal(released.posture, "idle");
  assert.equal(tick(released, 29_999, phone).posture, "idle");
  assert.equal(tick(released, 30_000, phone).posture, "phone");
});

test("advance is idempotent — ticking twice at the same instant changes nothing", () => {
  const once = tick(initialMotion(0), 9_500, coffee);
  assert.deepEqual(tick(once, 9_500, phone), once);
  const atMachine = tick(once, 12_000, coffee);
  assert.deepEqual(tick(atMachine, 12_000, coffee), atMachine);
});
