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

/** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
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
    const err = new Error(envelope.error?.message ?? "host error");
    // @ts-ignore — code rides along for callers that care.
    err.code = envelope.error?.code ?? "host_error";
    waiter.reject(err);
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
   * @returns {Promise<unknown>}
   */
  invoke(method, payload) {
    return new Promise((resolve, reject) => {
      seq += 1;
      const id = `r${seq}-${Date.now().toString(36)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        const err = new Error(`后台服务未在 ${INVOKE_TIMEOUT_MS / 1000} 秒内响应（${method}）`);
        // @ts-ignore — code rides along for callers that care.
        err.code = "host_timeout";
        reject(err);
      }, INVOKE_TIMEOUT_MS);
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
});
