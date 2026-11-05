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
    clearTimeoutFn() {},
    runDue() {
      const due = pending.splice(0, pending.length);
      for (const entry of due) entry.fn();
    },
    scheduled: () => pending.map((entry) => entry.ms),
  };
}

test("events pushed inside one frame flush as a single batch after 16ms", () => {
  const timers = fakeTimers();
  /** @type {unknown[][]} */
  const sent = [];
  const coalescer = createEventCoalescer({ send: (batch) => sent.push(batch), setTimeoutFn: timers.setTimeoutFn });

  coalescer.push(createEvent("domain.changed", { reason: "first" }));
  coalescer.push(createEvent("host.status", { state: "online" }));
  coalescer.push(createEvent("domain.changed", { reason: "second" }));

  assert.deepEqual(timers.scheduled(), [16]);
  assert.equal(sent.length, 0);
  timers.runDue();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 2);
  assert.deepEqual(
    sent[0].map((env) => /** @type {{ topic: string }} */ (env).topic),
    ["domain.changed", "host.status"],
  );
  assert.deepEqual(
    /** @type {{ payload: { reason: string } }} */ (sent[0][0]).payload,
    { reason: "second" },
  );
});

test("each frame sends at most one batch and a new frame opens after a flush", () => {
  const timers = fakeTimers();
  /** @type {unknown[][]} */
  const sent = [];
  const coalescer = createEventCoalescer({ send: (batch) => sent.push(batch), setTimeoutFn: timers.setTimeoutFn });

  coalescer.push(createEvent("domain.changed", { n: 1 }));
  coalescer.push(createEvent("domain.changed", { n: 2 }));
  timers.runDue();
  coalescer.push(createEvent("domain.changed", { n: 3 }));
  timers.runDue();

  assert.equal(sent.length, 2);
  assert.equal(sent[0].length, 1);
  assert.deepEqual(
    /** @type {{ payload: { n: number } }} */ (sent[0][0]).payload,
    { n: 2 },
  );
  assert.equal(sent[1].length, 1);
  assert.deepEqual(
    /** @type {{ payload: { n: number } }} */ (sent[1][0]).payload,
    { n: 3 },
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
