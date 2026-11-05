/**
 * Renderer bridge (sandboxed preload).
 *
 * Exposes just two verbs over the typed envelope protocol:
 *   invoke(method, payload) → Promise  (correlated reply)
 *   onEvents(handler)       → unsubscribe  (coalesced host event batches)
 */
const { contextBridge, ipcRenderer } = require("electron");

/** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void }>} */
const pending = new Map();
/** @type {Set<(events: unknown[]) => void>} */
const listeners = new Set();
let seq = 0;

ipcRenderer.on("cubicle:reply", (_event, envelope) => {
  const waiter = pending.get(envelope?.id);
  if (!waiter) return;
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
  for (const listener of listeners) listener(batch);
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
      pending.set(id, { resolve, reject });
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
   * @param {(events: unknown[]) => void} handler
   * @returns {() => void}
   */
  onEvents(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  },
});
