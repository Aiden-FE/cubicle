/**
 * AgentHost lifecycle supervisor, living in the main process.
 *
 * Owns one utilityProcess running the AgentHost entry and publishes a tiny
 * state machine to the UI: starting → online → offline → starting …
 * `stop()` marks a deliberate shutdown so no restart is scheduled.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createInvoke } from "../shared/envelope.mjs";

/**
 * @typedef {"idle" | "starting" | "online" | "offline" | "stopped"} HostState
 *
 * @typedef {object} HostStatus
 * @property {HostState} state
 * @property {number | null} pid
 *
 * @typedef {object} ForkedChild
 * @property {number | undefined} [pid]
 * @property {(event: any, listener: (...args: any[]) => void) => unknown} on
 * @property {() => void} kill
 * @property {(message: unknown) => void} [postMessage]
 */

const hostEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "host", "entry.cjs");

/**
 * @param {object} options
 * @param {(entryPath: string, options: Record<string, unknown>) => ForkedChild} options.fork
 * @param {string} [options.entryPath]
 * @param {number} [options.restartDelayMs]
 * @param {number} [options.startupTimeoutMs] kill a host that never sends anything
 * @param {number} [options.shutdownGraceMs] give a stopping host this long to reclaim engine children before kill
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimeoutFn]
 * @param {(id: unknown) => void} [options.clearTimeoutFn]
 * @param {(message: unknown) => void} [options.onMessage] passthrough for host traffic
 */
export function createHostSupervisor({
  fork,
  entryPath = hostEntry,
  restartDelayMs = 1000,
  startupTimeoutMs = 6000,
  shutdownGraceMs = 600,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (id) => clearTimeout(/** @type {NodeJS.Timeout} */ (id)),
  onMessage,
}) {
  /** @type {HostState} */
  let state = "idle";
  /** @type {ForkedChild | null} */
  let child = null;
  /** @type {unknown} */
  let restartTimer = null;
  /** @type {unknown} */
  let startupTimer = null;
  /** @type {unknown} */
  let shutdownTimer = null;
  /** @type {Set<(status: HostStatus) => void>} */
  const listeners = new Set();

  function notify() {
    const status = { state, pid: child?.pid ?? null };
    for (const listener of listeners) listener(status);
  }

  function spawn() {
    state = "starting";
    child = fork(entryPath, { serviceName: "cubicle-agent-host" });
    const born = child;
    if (startupTimeoutMs > 0) {
      startupTimer = setTimeoutFn(() => {
        startupTimer = null;
        if (state === "starting" && child === born) born.kill();
      }, startupTimeoutMs);
    }
    child.on("message", (message) => {
      if (startupTimer !== null) {
        clearTimeoutFn(startupTimer);
        startupTimer = null;
      }
      if (state !== "online") {
        state = "online";
        notify();
      }
      if (onMessage) onMessage(message);
    });
    child.on("exit", () => {
      child = null;
      if (startupTimer !== null) {
        clearTimeoutFn(startupTimer);
        startupTimer = null;
      }
      if (shutdownTimer !== null) {
        clearTimeoutFn(shutdownTimer);
        shutdownTimer = null;
      }
      if (state === "stopped") return;
      state = "offline";
      notify();
      restartTimer = setTimeoutFn(() => {
        restartTimer = null;
        spawn();
      }, restartDelayMs);
    });
    notify();
  }

  return {
    /** @returns {HostState} */
    get state() {
      return state;
    },
    /** @returns {number | null} */
    get pid() {
      return child?.pid ?? null;
    },

    start() {
      if (state !== "idle") return;
      spawn();
    },

    stop() {
      if (state === "stopped") return;
      state = "stopped";
      if (restartTimer !== null) {
        clearTimeoutFn(restartTimer);
        restartTimer = null;
      }
      if (startupTimer !== null) {
        clearTimeoutFn(startupTimer);
        startupTimer = null;
      }
      if (child) {
        const dying = child;
        child = null;
        // Ask the CLI host to reclaim engine children first, then kill after
        // a short grace so an uncooperative host still goes down. (票 04 duty.)
        if (typeof dying.postMessage === "function") {
          try {
            dying.postMessage(createInvoke("host-shutdown", "host.shutdown", {}));
          } catch {
            // postMessage on a dying channel is best-effort
          }
        }
        shutdownTimer = setTimeoutFn(() => {
          shutdownTimer = null;
          dying.kill();
        }, shutdownGraceMs);
      }
    },

    /**
     * Forward a message to the live host child, if any.
     *
     * @param {unknown} message
     * @returns {boolean} whether it was handed to the child
     */
    send(message) {
      if (!child || typeof child.postMessage !== "function") return false;
      child.postMessage(message);
      return true;
    },

    /**
     * @param {(status: HostStatus) => void} listener
     * @returns {() => void} unsubscribe
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
