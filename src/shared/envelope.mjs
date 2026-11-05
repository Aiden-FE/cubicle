/**
 * Typed IPC envelope shared by main, AgentHost and the renderer bridge.
 *
 * One wire shape for every process hop:
 *   invoke  → someone asks for a method (renderer → main → AgentHost)
 *   reply   → the answer to an invoke, correlated by id
 *   event   → an unsolicited topic push (AgentHost → main → renderer)
 *
 * Large payloads are not part of the envelope itself; later tickets pass a
 * pointer in `payload` and ship bytes through the filesystem side-channel.
 */

export const ENVELOPE_VERSION = 1;

/** Shared topic names so the boundary stays one edit away from the semantics. */
export const TOPICS = {
  hostStatus: "host.status",
  domainChanged: "domain.changed",
};

/**
 * @typedef {"invoke" | "reply" | "event"} EnvelopeKind
 *
 * @typedef {object} InvokeEnvelope
 * @property {1} v
 * @property {"invoke"} kind
 * @property {string} id
 * @property {string} method
 * @property {unknown} payload
 * @property {number} ts
 *
 * @typedef {object} ReplyEnvelope
 * @property {1} v
 * @property {"reply"} kind
 * @property {string} id
 * @property {boolean} ok
 * @property {unknown} [payload]
 * @property {{ code: string, message: string }} [error]
 * @property {number} ts
 *
 * @typedef {object} EventEnvelope
 * @property {1} v
 * @property {"event"} kind
 * @property {string} id
 * @property {string} topic
 * @property {unknown} payload
 * @property {number} ts
 *
 * @typedef {InvokeEnvelope | ReplyEnvelope | EventEnvelope} Envelope
 */

/** @returns {string} */
function nextId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} id
 * @param {string} method
 * @param {unknown} [payload]
 * @returns {InvokeEnvelope}
 */
export function createInvoke(id, method, payload = {}) {
  return { v: ENVELOPE_VERSION, kind: "invoke", id, method, payload, ts: Date.now() };
}

/**
 * @param {InvokeEnvelope | { id: string }} request
 * @param {unknown} payload
 * @returns {ReplyEnvelope}
 */
export function createReply(request, payload) {
  return { v: ENVELOPE_VERSION, kind: "reply", id: request.id, ok: true, payload, ts: Date.now() };
}

/**
 * @param {InvokeEnvelope | { id: string }} request
 * @param {{ code: string, message: string }} error
 * @returns {ReplyEnvelope}
 */
export function createErrorReply(request, error) {
  return { v: ENVELOPE_VERSION, kind: "reply", id: request.id, ok: false, error, ts: Date.now() };
}

/**
 * @param {string} topic
 * @param {unknown} payload
 * @param {string} [id]
 * @returns {EventEnvelope}
 */
export function createEvent(topic, payload, id = nextId()) {
  return { v: ENVELOPE_VERSION, kind: "event", id, topic, payload, ts: Date.now() };
}

/**
 * Validates an untrusted value (anything crossing a process boundary) as an
 * envelope. Returns the value unchanged when it is well-formed, null otherwise.
 *
 * @param {unknown} value
 * @returns {Envelope | null}
 */
export function parseEnvelope(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const env = /** @type {Record<string, unknown>} */ (value);
  if (env.v !== ENVELOPE_VERSION) return null;
  if (typeof env.id !== "string" || env.id.length === 0) return null;
  if (typeof env.ts !== "number") return null;

  switch (env.kind) {
    case "invoke":
      if (typeof env.method !== "string" || env.method.length === 0) return null;
      return /** @type {Envelope} */ (value);
    case "reply":
      if (typeof env.ok !== "boolean") return null;
      if (!env.ok) {
        const error = /** @type {unknown} */ (env.error);
        if (typeof error !== "object" || error === null) return null;
        const { code, message } = /** @type {Record<string, unknown>} */ (error);
        if (typeof code !== "string" || typeof message !== "string") return null;
      }
      return /** @type {Envelope} */ (value);
    case "event":
      if (typeof env.topic !== "string" || env.topic.length === 0) return null;
      return /** @type {Envelope} */ (value);
    default:
      return null;
  }
}
