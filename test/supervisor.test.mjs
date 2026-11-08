import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { createHostSupervisor } from "../src/main/supervisor.mjs";

/**
 * Test double for the utilityProcess handle.
 *
 * @param {number} pid
 */
function fakeChild(pid) {
  const emitter = new EventEmitter();
  const child = {
    pid,
    killed: false,
    /** @type {unknown[]} */
    sent: [],
    /** @param {unknown} message */
    postMessage(message) {
      child.sent.push(message);
    },
    kill() {
      child.killed = true;
    },
    /** @type {(event: string, listener: (...args: any[]) => void) => unknown} */
    on: (event, listener) => emitter.on(event, listener),
    /** @type {(event: string, ...args: any[]) => boolean} */
    emit: (event, ...args) => emitter.emit(event, ...args),
  };
  return child;
}

/** Manual scheduler so timer behaviour is deterministic. */
function fakeTimers() {
  /** @type {{ id: number, ms: number, fn: () => void }[]} */
  const pending = [];
  let nextId = 1;
  return {
    /** @type {Map<number, () => void>} */
    pending: new Map(
      pending.map((entry) => [entry.id, entry.fn]),
    ),
    setTimeoutFn(/** @type {() => void} */ fn, /** @type {number} */ ms) {
      const id = nextId++;
      pending.push({ id, ms, fn });
      return id;
    },
    clearTimeoutFn(/** @type {unknown} */ id) {
      const index = pending.findIndex((entry) => entry.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
    /** Runs every timer callback scheduled since the last run. */
    runDue() {
      const due = pending.splice(0, pending.length);
      for (const entry of due) entry.fn();
    },
    pendingCount() {
      return pending.length;
    },
    nextDelay() {
      return pending[0]?.ms ?? null;
    },
  };
}

function setup(options = {}) {
  const timers = fakeTimers();
  /** @type {{ path: string, options: Record<string, unknown> }[]} */
  const forks = [];
  /** @type {{ child: ReturnType<typeof fakeChild> }[]} */
  const children = [];
  /** @type {unknown[]} */
  const statusLog = [];

  const supervisor = createHostSupervisor({
    fork: (/** @type {string} */ path, /** @type {Record<string, unknown>} */ options) => {
      forks.push({ path, options });
      const child = fakeChild(1000 + forks.length);
      children.push({ child });
      return child;
    },
    restartDelayMs: 1000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    ...options,
  });
  supervisor.subscribe((/** @type {unknown} */ status) => statusLog.push(status));
  return { supervisor, forks, children, timers, statusLog };
}

test("start forks the AgentHost entry and reports starting", () => {
  const { supervisor, forks, statusLog } = setup();
  supervisor.start();
  assert.equal(forks.length, 1);
  assert.equal(supervisor.state, "starting");
  assert.deepEqual(statusLog.at(-1), { state: "starting", pid: 1001 });
});

test("the first message from the AgentHost flips the state to online", () => {
  const { supervisor, children, statusLog } = setup();
  supervisor.start();
  children[0].child.emit("message", { topic: "host.status" });
  assert.equal(supervisor.state, "online");
  assert.deepEqual(statusLog.at(-1), { state: "online", pid: 1001 });
});

test("an unexpected exit marks offline and forks a replacement after the delay", () => {
  const { supervisor, forks, children, timers } = setup();
  supervisor.start();
  children[0].child.emit("message", {});
  children[0].child.emit("exit", 1);
  assert.equal(supervisor.state, "offline");
  assert.equal(forks.length, 1);
  timers.runDue();
  assert.equal(forks.length, 2);
  assert.equal(supervisor.state, "starting");
  assert.equal(supervisor.pid, 1002);
});

test("stop() asks the host to reclaim engine children, then exits cleanly without kill or restart", () => {
  const { supervisor, forks, children, timers } = setup();
  supervisor.start();
  supervisor.stop();
  // the shutdown handshake is offered before any kill (票 04 CLI-host reclamation)
  assert.deepEqual(children[0].child.sent.map((/** @type {any} */ m) => m.method), ["host.shutdown"]);
  // the host exits within the grace window → its exit clears the kill timer
  children[0].child.emit("exit", 0);
  assert.equal(supervisor.state, "stopped");
  assert.equal(children[0].child.killed, false, "graceful exit means no kill");
  assert.equal(timers.pendingCount(), 0);
  timers.runDue();
  assert.equal(forks.length, 1);
});

test("stop() kills the host after the grace window if it never exits", () => {
  const { supervisor, children, timers } = setup();
  supervisor.start();
  supervisor.stop();
  assert.equal(children[0].child.killed, false, "not killed before the grace window");
  timers.runDue(); // grace elapses with no exit event
  assert.equal(children[0].child.killed, true, "uncooperative host is killed after grace");
});

test("a crash loop backs off exponentially instead of respawning every second", () => {
  const { supervisor, children, timers } = setup();
  supervisor.start();
  children[0].child.emit("exit", 1);
  assert.equal(timers.nextDelay(), 1000, "first crash: base delay");
  timers.runDue();
  children[1].child.emit("exit", 1);
  assert.equal(timers.nextDelay(), 2000, "second crash in a row: doubled");
  timers.runDue();
  children[2].child.emit("exit", 1);
  assert.equal(timers.nextDelay(), 4000, "third crash: doubled again");
  timers.runDue();
  children[3].child.emit("message", {});
  children[3].child.emit("exit", 1);
  assert.equal(timers.nextDelay(), 1000, "a healthy host resets the attempt counter");
});

test("onExit fires when the host dies (pending main→host calls can be rejected)", () => {
  let exits = 0;
  const { supervisor, children } = setup({ onExit: () => (exits += 1) });
  supervisor.start();
  children[0].child.emit("exit", 1);
  assert.equal(exits, 1);
});

test("stop() resolves only after the host is gone", async () => {
  const { supervisor, children, timers } = setup();
  supervisor.start();
  let resolved = false;
  const stopping = supervisor.stop().then(() => {
    resolved = true;
  });
  assert.equal(resolved, false, "stop is awaiting the host");
  children[0].child.emit("exit", 0);
  await stopping;
  assert.equal(resolved, true);
  assert.equal(timers.pendingCount(), 0, "grace timer cleared by the exit");
});

test("a healthy restart cycle reports starting then online again", () => {
  const { supervisor, children, timers, statusLog } = setup();
  supervisor.start();
  children[0].child.emit("message", {});
  children[0].child.emit("exit", 7);
  timers.runDue();
  children[1].child.emit("message", {});
  assert.equal(supervisor.state, "online");
  assert.deepEqual(
    statusLog.map((s) => /** @type {{ state: string }} */ (s).state),
    ["starting", "online", "offline", "starting", "online"],
  );
});

test("a silent host is killed after the startup window and restarted", () => {
  const timers = fakeTimers();
  /** @type {ReturnType<typeof fakeChild>[]} */
  const children = [];
  /** @type {ReturnType<typeof fakeChild>[]} */
  const forks = [];
  const supervisor = createHostSupervisor({
    fork: () => {
      const child = fakeChild(1000 + forks.length + 1);
      forks.push(child);
      children.push(child);
      return child;
    },
    restartDelayMs: 1000,
    startupTimeoutMs: 6000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: () => {},
  });
  supervisor.start();
  assert.equal(supervisor.state, "starting");
  assert.equal(forks.length, 1);

  // Nothing arrives from the host; the watchdog must act.
  timers.runDue();
  assert.equal(forks[0].killed, true, "silent host should be killed after the startup window");

  // Its exit flows through the normal offline → restart path.
  forks[0].emit("exit", 1);
  assert.equal(supervisor.state, "offline");
  timers.runDue();
  assert.equal(forks.length, 2);
  assert.equal(supervisor.state, "starting");
});

test("a host that answers in time never gets killed", () => {
  const timers = fakeTimers();
  /** @type {ReturnType<typeof fakeChild>[]} */
  const children = [];
  /** @type {ReturnType<typeof fakeChild>[]} */
  const forks = [];
  const supervisor = createHostSupervisor({
    fork: () => {
      const child = fakeChild(1000 + forks.length + 1);
      forks.push(child);
      children.push(child);
      return child;
    },
    startupTimeoutMs: 6000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  supervisor.start();
  forks[0].emit("message", {});
  timers.runDue();
  assert.equal(supervisor.state, "online");
  assert.equal(forks[0].killed, false);
});

