const MINIMUM = [22, 19, 0];

/**
 * True when `version` is a stable semver at least 22.19.0.
 *
 * Electron reports versions such as `24.22.1`; prerelease or malformed
 * strings are rejected rather than coerced.
 *
 * @param {string} version
 * @returns {boolean}
 */
export function isNodeVersionSupported(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return false;
  }

  const parts = match.slice(1).map(Number);
  for (let index = 0; index < MINIMUM.length; index += 1) {
    if (parts[index] > MINIMUM[index]) return true;
    if (parts[index] < MINIMUM[index]) return false;
  }
  return true;
}
