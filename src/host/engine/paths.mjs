/**
 * Engine-owned directory layout, under the application's private data dir —
 * never the user's home (decision 14: `engines/<engine>/<employee-id>/…`).
 *
 * Each employee gets one folder per engine holding:
 *   agent/      the engine's private config (models.json, auth.json, skills)
 *   sessions/   the engine's session files (the adapter's resume story)
 *   workspace/  the cwd the employee works in
 */
import path from "node:path";

/**
 * The engine-level config folder inside the data dir (`engines/<engine>/`):
 * BYOK models.json / auth live here; per-employee folders hang under it.
 *
 * @param {string} dataDir the app data root
 * @param {string} engine engine key, e.g. "pi"
 * @returns {string}
 */
export function engineConfigDir(dataDir, engine) {
  return path.join(dataDir, "engines", engine);
}

/**
 * @param {string} dataDir the app data root
 * @param {string} engine engine key, e.g. "pi"
 * @param {number} employeeId
 * @returns {{ root: string, agentDir: string, sessionsDir: string, workspaceDir: string }}
 */
export function enginePaths(dataDir, engine, employeeId) {
  const root = path.join(engineConfigDir(dataDir, engine), `employee-${employeeId}`);
  return {
    root,
    agentDir: path.join(root, "agent"),
    sessionsDir: path.join(root, "sessions"),
    workspaceDir: path.join(root, "workspace"),
  };
}
