/**
 * Small shared error factory: errors that cross the service boundary carry a
 * stable `code` so handlers can answer without sniffing messages.
 */

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
export function appError(code, message) {
  const err = /** @type {Error & { code: string }} */ (new Error(`${code}: ${message}`));
  err.code = code;
  return err;
}
