/**
 * Renderer bridge (sandboxed preload).
 *
 * Exposes two verbs over the typed envelope protocol:
 *   invoke(method, payload)        → Promise (correlated reply, times out)
 *   subscribe(topic, handler)      → unsubscribe (per-topic event delivery)
 * Topic filtering happens here, at the boundary — the view never sniffs
 * batches it did not ask for.
 */
const { contextBridge, ipcRenderer } = require("electron");

const INVOKE_TIMEOUT_MS = 8000;

/** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: { code: string, message: string }) => void, timer: NodeJS.Timeout }>} */
const pending = new Map();
/** @type {Map<string, Set<(event: any) => void>>} */
const topicHandlers = new Map();
let seq = 0;

ipcRenderer.on("cubicle:reply", (_event, envelope) => {
  const waiter = pending.get(envelope?.id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  pending.delete(envelope.id);
  if (envelope.ok) {
    waiter.resolve(envelope.payload);
  } else {
    // Reject with the plain wire-shaped error object — custom properties on
    // an Error (like .code) do NOT survive contextBridge's serializer, only
    // plain data does. Callers read { code, message }.
    waiter.reject({ code: envelope.error?.code ?? "host_error", message: envelope.error?.message ?? "host error" });
  }
});

ipcRenderer.on("cubicle:events", (_event, batch) => {
  if (!Array.isArray(batch)) return;
  for (const envelope of batch) {
    const handlers = topicHandlers.get(envelope?.topic);
    if (!handlers) continue;
    for (const handler of handlers) handler(envelope);
  }
});

contextBridge.exposeInMainWorld("cubicle", {
  /**
   * @param {string} method
   * @param {unknown} [payload]
   * @param {{ timeoutMs?: number }} [options] 票 a03: 长动作（学院装/下发要跑
   *   vendored CLI + npx）可显式放宽超时；默认仍是 8s，宿主失联照常快速暴露。
   * @returns {Promise<unknown>}
   */
  invoke(method, payload, options) {
    const timeoutMs = Number.isFinite(options?.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : INVOKE_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      seq += 1;
      const id = `r${seq}-${Date.now().toString(36)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject({ code: "host_timeout", message: `后台服务未在 ${Math.round(timeoutMs / 1000)} 秒内响应（${method}）` });
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ipcRenderer.send("cubicle:invoke", {
        v: 1,
        kind: "invoke",
        id,
        method,
        payload: payload ?? {},
        ts: Date.now(),
      });
    });
  },

  /**
   * @param {string} topic
   * @param {(event: any) => void} handler
   * @returns {() => void}
   */
  subscribe(topic, handler) {
    let handlers = topicHandlers.get(topic);
    if (!handlers) {
      handlers = new Set();
      topicHandlers.set(topic, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = topicHandlers.get(topic);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) topicHandlers.delete(topic);
    };
  },

  /**
   * 票 13: 关于页 — app metadata comes from main (window/preferences
   * business), not through the AgentHost envelope bus.
   * @returns {Promise<unknown>}
   */
  appInfo() {
    return ipcRenderer.invoke("cubicle:app-info");
  },

  /**
   * Open an employee's workspace folder. The main process derives the path
   * from the employee id; the renderer never supplies a path.
   * @param {number} employeeId
   * @returns {Promise<string>}
   */
  openWorkspace(employeeId) {
    return ipcRenderer.invoke("cubicle:open-workspace", employeeId);
  },

  /**
   * Open an engine's BYOK config directory. Main derives the path from dataDir
   * and the engine name; the renderer never supplies a path.
   * @param {string} engine
   * @returns {Promise<string>}
   */
  openEngineDir(engine) {
    return ipcRenderer.invoke("cubicle:open-engine-dir", engine);
  },
});
