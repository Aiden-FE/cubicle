/**
 * Secret redaction for anything that leaves the engine and lands in the DB,
 * the UI, or a log: command output, stderr tails, failure sentences.
 *
 * The real fix for BYOK keys is not giving them to the engine's shell at all
 * (codex's shell_environment_policy excludes CUBICLE_CODEX_KEY). This module is
 * the damage-control layer for the paths we cannot fully control: a provider
 * echoing a key, a command printing its environment, an error message that
 * quotes a request.
 */

/** @type {readonly RegExp[]} */
const PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["']?[^\s"',]{8,}/gi,
  /\bCUBICLE_(?:CODEX_KEY|POLICY_TOKEN)\s*[:=]\s*[^\s"']+/gi,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g,
];

/**
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  let out = String(text ?? "");
  for (const pattern of PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}
