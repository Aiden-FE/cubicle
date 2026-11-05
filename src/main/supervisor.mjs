/**
 * AgentHost lifecycle supervisor, living in the main process.
 *
 * Owns one utilityProcess running the AgentHost entry and publishes a tiny
 * state machine to the UI: starting → online → offline → starting …
 * `stop()` marks a deliberate shutdown so no restart is scheduled.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimeoutFn]
 * @param {(id: unknown) => void} [options.clearTimeoutFn]
 * @param {(message: unknown) => void} [options.onMessage] passthrough for host traffic
 */
export function createHostSupervisor({
  fork,
  entryPath = hostEntry,
  restartDelayMs = 1000,
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
  /** @type {Set<(status: HostStatus) => void>} */
  const listeners = new Set();

  function notify() {
    const status = { state, pid: child?.pid ?? null };
    for (const listener of listeners) listener(status);
  }

  function spawn() {
    state = "starting";
    child = fork(entryPath, { serviceName: "cubicle-agent-host" });
    child.on("message", (message) => {
      if (state !== "online") {
        state = "online";
        notify();
      }
      if (onMessage) onMessage(message);
    });
    child.on("exit", () => {
      child = null;
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
      if (child) {
        const dying = child;
        child = null;
        dying.kill();
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
