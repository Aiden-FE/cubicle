import test from "node:test";
import assert from "node:assert/strict";

import { createEventCoalescer } from "../src/main/coalescer.mjs";
import { createEvent } from "../src/shared/envelope.mjs";

function fakeTimers() {
  /** @type {{ id: number, ms: number, fn: () => void }[]} */
  const pending = [];
  let nextId = 1;
  return {
    setTimeoutFn(/** @type {() => void} */ fn, /** @type {number} */ ms) {
      const id = nextId++;
      pending.push({ id, ms, fn });
      return id;
    },
    runDue() {
      const due = pending.splice(0, pending.length);
      for (const entry of due) entry.fn();
    },
    scheduled: () => pending.map((entry) => entry.ms),
  };
}

test("events inside one frame flush as a single batch after 16ms", () => {
  const timers = fakeTimers();
  /** @type {unknown[][]} */
  const sent = [];
  const coalescer = createEventCoalescer({ send: (batch) => sent.push(batch), setTimeoutFn: timers.setTimeoutFn });

  coalescer.push(createEvent("domain.changed", { reason: "first" }));
  coalescer.push(createEvent("host.status", { state: "starting" }));

  assert.deepEqual(timers.scheduled(), [16]);
  assert.equal(sent.length, 0);
  timers.runDue();

  assert.equal(sent.length, 1);
  assert.deepEqual(
    sent[0].map((env) => /** @type {{ topic: string }} */ (env).topic),
    ["domain.changed", "host.status"],
  );
});

test("idempotent status topics collapse to the newest within a frame", () => {
  const timers = fakeTimers();
  /** @type {unknown[][]} */
  const sent = [];
  const coalescer = createEventCoalescer({ send: (batch) => sent.push(batch), setTimeoutFn: timers.setTimeoutFn });

  coalescer.push(createEvent("host.status", { state: "online", pid: 1 }));
  coalescer.push(createEvent("host.status", { state: "offline", pid: null }));
  timers.runDue();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 1);
  assert.deepEqual(
    /** @type {{ payload: { state: string } }} */ (sent[0][0]).payload,
    { state: "offline", pid: null },
  );
});

test("domain events never collapse: each survives its frame in order", () => {
  const timers = fakeTimers();
  /** @type {unknown[][]} */
  const sent = [];
  const coalescer = createEventCoalescer({ send: (batch) => sent.push(batch), setTimeoutFn: timers.setTimeoutFn });

  coalescer.push(createEvent("domain.changed", { n: 1 }));
  coalescer.push(createEvent("domain.changed", { n: 2 }));
  coalescer.push(createEvent("host.status", { state: "starting" }));
  timers.runDue();

  assert.equal(sent.length, 1);
  const topics = sent[0].map((env) => /** @type {{ topic: string }} */ (env).topic);
  assert.deepEqual(topics, ["domain.changed", "domain.changed", "host.status"]);
  assert.deepEqual(
    /** @type {{ payload: { n: number } }} */ (sent[0][0]).payload,
    { n: 1 },
  );
  assert.deepEqual(
    /** @type {{ payload: { n: number } }} */ (sent[0][1]).payload,
    { n: 2 },
  );
});

test("an empty frame sends nothing", () => {
  const timers = fakeTimers();
  /** @type {unknown[][]} */
  const sent = [];
  const coalescer = createEventCoalescer({ send: (batch) => sent.push(batch), setTimeoutFn: timers.setTimeoutFn });
  timers.runDue();
  assert.deepEqual(sent, []);
  assert.deepEqual(timers.scheduled(), []);
});

test("frameMs is configurable", () => {
  const timers = fakeTimers();
  const coalescer = createEventCoalescer({
    send: () => {},
    frameMs: 33,
    setTimeoutFn: timers.setTimeoutFn,
  });
  coalescer.push(createEvent("host.status", { state: "online" }));
  assert.deepEqual(timers.scheduled(), [33]);
});
