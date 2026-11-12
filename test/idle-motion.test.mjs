import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialMotion,
  advanceMotion,
  motionOnWork,
  motionOnRelease,
  pickSlackKind,
  IDLE_THRESHOLDS,
} from "../renderer/src/scene/idleMotion.js";

// Ticket 17 acceptance: 9s idle → one random slacking state among
// phone / minesweeper / coffee. Coffee is a real trip: 2.5s walk, 5s at the
// machine, 2.5s back, then 10s seated with a cup. All expectations are
// literals at a fake clock and an injected RNG; the defaults are the spec.

const phone = () => 0.1;
const minesweeper = () => 0.5;
const coffee = () => 0.9;

test("thresholds: 9s idle, 5s at the coffee machine, full coffee beat", () => {
  assert.equal(IDLE_THRESHOLDS.slackAtMs, 9_000);
  assert.equal(IDLE_THRESHOLDS.coffeeWalkMs, 2_500);
  assert.equal(IDLE_THRESHOLDS.coffeeMachineMs, 5_000);
  assert.equal(IDLE_THRESHOLDS.coffeeSipMs, 10_000);
  assert.equal(IDLE_THRESHOLDS.phoneMs, 12_000);
  assert.equal(IDLE_THRESHOLDS.minesweeperMs, 12_000);
});

test("random slack kind is evenly bucketed and injectable", () => {
  assert.equal(pickSlackKind(0), "phone");
  assert.equal(pickSlackKind(0.32), "phone");
  assert.equal(pickSlackKind(0.34), "minesweeper");
  assert.equal(pickSlackKind(0.67), "coffee");
  assert.equal(pickSlackKind(0.99), "coffee");
});

test("a seated worker idles normally for the first 9 seconds", () => {
  let m = initialMotion(0);
  assert.deepEqual({ posture: m.posture, position: m.position }, { posture: "idle", position: "desk" });
  m = advanceMotion(m, 8_999, undefined, coffee);
  assert.equal(m.posture, "idle");
  assert.equal(m.coffeePhase, null);
});

test("9s idle rolls one of phone / minesweeper / coffee", () => {
  const p = advanceMotion(initialMotion(0), 9_000, undefined, phone);
  assert.deepEqual({ posture: p.posture, position: p.position }, { posture: "phone", position: "desk" });
  assert.equal(p.coffeePhase, null);

  const m = advanceMotion(initialMotion(0), 9_000, undefined, minesweeper);
  assert.deepEqual({ posture: m.posture, position: m.position }, { posture: "minesweeper", position: "desk" });

  const c = advanceMotion(initialMotion(0), 9_000, undefined, coffee);
  assert.deepEqual({ posture: c.posture, position: c.position }, { posture: "coffee", position: "away" });
  assert.equal(c.coffeePhase, "to-machine");
});

test("phone / minesweeper stay at the desk for 12s, then idle restarts", () => {
  /** @type {Array<[() => number, "phone" | "minesweeper"]>} */
  const cases = [[phone, "phone"], [minesweeper, "minesweeper"]];
  for (const [random, posture] of cases) {
    const slack = advanceMotion(initialMotion(0), 9_000, undefined, random);
    assert.equal(slack.posture, posture);
    assert.equal(advanceMotion(slack, 20_999).posture, posture);
    const idle = advanceMotion(slack, 21_000);
    assert.deepEqual({ posture: idle.posture, position: idle.position }, { posture: "idle", position: "desk" });
    assert.equal(idle.anchor, 21_000);
  }
});

test("coffee phases: walk → 5s machine → walk back → seated cup → idle", () => {
  let m = advanceMotion(initialMotion(0), 9_000, undefined, coffee);
  assert.equal(m.coffeePhase, "to-machine");
  assert.equal(m.position, "away");

  m = advanceMotion(m, 11_499);
  assert.equal(m.coffeePhase, "to-machine");
  m = advanceMotion(m, 11_500);
  assert.equal(m.coffeePhase, "at-machine");
  assert.equal(m.position, "away");

  // the explicit 5 seconds at the machine, not a moment less
  m = advanceMotion(m, 16_499);
  assert.equal(m.coffeePhase, "at-machine");
  m = advanceMotion(m, 16_500);
  assert.equal(m.coffeePhase, "returning");

  m = advanceMotion(m, 18_999);
  assert.equal(m.coffeePhase, "returning");
  m = advanceMotion(m, 19_000);
  assert.equal(m.coffeePhase, "sipping");
  assert.equal(m.position, "desk");

  m = advanceMotion(m, 28_999);
  assert.equal(m.coffeePhase, "sipping");
  const idle = advanceMotion(m, 29_000);
  assert.deepEqual({ posture: idle.posture, position: idle.position }, { posture: "idle", position: "desk" });
  assert.equal(idle.anchor, 29_000);
});

test("the RNG is consulted exactly once per idle→slack transition", () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return 0.1;
  };
  const first = advanceMotion(initialMotion(0), 9_000, undefined, random);
  assert.equal(calls, 1);
  advanceMotion(first, 10_000, undefined, random);
  assert.equal(calls, 1);
});

test("work freezes the idle clock — busy desks never slack mid-run", () => {
  let m = motionOnWork(advanceMotion(initialMotion(0), 10_000, undefined, phone), 10_000);
  assert.equal(m.posture, "work");
  assert.equal(m.coffeePhase, null);
  m = advanceMotion(m, 100_000);
  assert.equal(m.posture, "work");
  assert.equal(m.position, "desk");
});

test("a sentence mid-coffee brings the employee straight back, working", () => {
  const away = advanceMotion(initialMotion(0), 9_000, undefined, coffee);
  const working = motionOnWork(away, 12_000);
  assert.deepEqual({ posture: working.posture, position: working.position }, { posture: "work", position: "desk" });
  assert.equal(working.coffeePhase, null);
});

test("agent_end release restarts the idle cycle from that moment", () => {
  const released = motionOnRelease(motionOnWork(initialMotion(0), 5_000), 21_000);
  assert.equal(released.posture, "idle");
  assert.equal(advanceMotion(released, 29_999).posture, "idle");
  assert.equal(advanceMotion(released, 30_000, undefined, phone).posture, "phone");
});

test("advance is idempotent — ticking twice at the same instant changes nothing", () => {
  const once = advanceMotion(initialMotion(0), 9_500, undefined, coffee);
  assert.deepEqual(advanceMotion(once, 9_500, undefined, phone), once);
  const atMachine = advanceMotion(once, 12_000);
  assert.deepEqual(advanceMotion(atMachine, 12_000), atMachine);
});
