/**
 * Shared model-catalog vocabulary (host + renderer). No secrets, no I/O: both
 * sides agree on protocols, reasoning levels and engine compatibility.
 */

/** @typedef {"openai-responses" | "openai-completions"} ModelProtocol */

export const MODEL_PROTOCOLS = /** @type {const} */ (["openai-responses", "openai-completions"]);

export const PROTOCOL_LABELS = /** @type {Record<string, string>} */ ({
  "openai-responses": "OpenAI Responses",
  "openai-completions": "OpenAI Chat Completions",
});

/** pi / DSH's fixed thinking levels, in display order. */
export const REASONING_LEVELS = /** @type {const} */ ([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** The four rows the reasoning switch starts with (Q24 B). */
export const INITIAL_REASONING_LEVELS = ["off", "low", "medium", "high"];

/** Which wire protocols each engine can consume. */
export const ENGINE_PROTOCOLS = /** @type {Record<string, readonly ModelProtocol[]>} */ ({
  pi: ["openai-responses", "openai-completions"],
  codex: ["openai-responses"],
  dsh: ["openai-responses", "openai-completions"],
});

export const ENGINE_LABELS = /** @type {Record<string, string>} */ ({
  pi: "pi",
  codex: "codex",
  dsh: "DSH Desktop",
});

/** @param {string} engine @returns {readonly ModelProtocol[]} */
export function protocolsForEngine(engine) {
  return ENGINE_PROTOCOLS[engine] ?? [];
}

/**
 * @param {string} engine
 * @param {string} protocol
 * @returns {boolean}
 */
export function engineSupportsProtocol(engine, protocol) {
  return protocolsForEngine(engine).includes(/** @type {ModelProtocol} */ (protocol));
}

/** The default reasoning map: off + the three common levels. */
export function defaultReasoningLevels() {
  return {
    off: null,
    low: "low",
    medium: "medium",
    high: "high",
  };
}

/** @param {unknown} level */
export function isReasoningLevel(level) {
  return typeof level === "string" && REASONING_LEVELS.includes(/** @type {any} */ (level));
}

/**
 * Show a key without ever returning the secret itself.
 * @param {unknown} key
 * @returns {string}
 */
export function maskApiKey(key) {
  if (typeof key !== "string" || key.length === 0) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/** @param {string} providerKey @param {string} modelId */
export function modelRef(providerKey, modelId) {
  return `${providerKey}/${modelId}`;
}
