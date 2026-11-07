/**
 * Crash-residue sweep — the main process's startup hygiene (ticket 10).
 *
 * A force kill (taskkill /F, Task Manager, power loss) runs nobody's exit
 * hooks: the AgentHost utility process survives as an orphan still holding
 * the SQLite WAL open, and codex (+ its shell tree) is orphaned under it.
 * Two writers on one WAL is a data-integrity story the app must not tell,
 * so BEFORE the first host spawns, the main process reads two ledgers:
 *
 *   <dataDir>/agenthost.pid.json          — the last host it spawned (supervisor records it)
 *   <dataDir>/engines/codex/children.json — every codex child the last host spawned
 *
 * Confirmed-alive entries with matching identity get taskkill /T /F; then
 * both ledgers reset. Dead / recycled / wrong-age entries are only cleared.
 * This is the ticket's 「崩溃与重启后不留孤儿进程」: the next launch proves
 * with CIM samples that the scene is zero.
 */
import path from "node:path";

import { sweepPidLedger, createPidLedger, engineLedgerFile } from "../host/engine/child-ledger.mjs";

/**
 * The ledger the supervisor keeps for the AgentHost itself.
 * @param {string} dataDir
 */
export function hostPidFile(dataDir) {
  return path.join(dataDir, "agenthost.pid.json");
}

/**
 * Record the current host right after fork — APPEND semantics: every host
 * generation (supervisor restarts included) stays on the ledger until the
 * next launch sweeps. Overwrite semantics would erase the crashed host's
 * entry when the supervisor restarts, and the orphans under THAT dead pid
 * (engine children, pi tool shells) would have no ledger to be swept by.
 *
 * @param {{ dataDir: string, pid: number | undefined, startedAt?: string }} input
 */
export function recordHostPid({ dataDir, pid, startedAt }) {
  if (!pid) return;
  createPidLedger({ file: hostPidFile(dataDir) }).record({
    pid,
    name: "electron", // utilityProcess is electron.exe; the identity guard's extension leniency matches it
    startedAt: startedAt ?? new Date().toISOString(),
  });
}

/**
 * Sweep both ledgers. Engine list: engines that keep child processes
 * (codex; SDK-hosted pi has no engine child of its own). Never throws —
 * residue cleanup failing must not brick the app; the ledgers stay for the
 * next launch.
 *
 * @param {{
 *   dataDir: string,
 *   probeProcess?: (pid: number) => Promise<import("../host/engine/child-ledger.mjs").ProcessIdentity | null>,
 *   killProcess?: (pid: number) => Promise<void>,
 *   listChildren?: (pid: number) => Promise<{ pid: number, name: string }[]>,
 *   log?: (message: string) => void,
 *   engines?: string[],
 * }} options
 * @returns {Promise<{ host: { checked: number, killed: number, orphanChildren: number, stale: number }, engines: Record<string, { checked: number, killed: number, orphanChildren: number, stale: number }> }>}
 */
export async function sweepCrashResidue({ dataDir, probeProcess, killProcess, listChildren, log, engines = ["codex"] }) {
  /** @type {Record<string, any>} */
  const engineOutcomes = {};
  // Engine orphans first: they parent shell trees of their own; taskkill /T
  // takes those with them. Then the host ledger (its children are already
  // gone if it is still alive, but its WAL handle must be released either way).
  for (const engine of engines) {
    try {
      engineOutcomes[engine] = await sweepPidLedger({ file: engineLedgerFile(dataDir, engine), probeProcess, killProcess, listChildren, log });
    } catch (err) {
      log?.(`engine residue sweep (${engine}) failed: ${err instanceof Error ? err.message : err}`);
      engineOutcomes[engine] = { checked: 0, killed: 0, orphanChildren: 0, stale: 0 };
    }
  }
  /** @type {{ checked: number, killed: number, orphanChildren: number, stale: number }} */
  let hostOutcome = { checked: 0, killed: 0, orphanChildren: 0, stale: 0 };
  try {
    hostOutcome = await sweepPidLedger({ file: hostPidFile(dataDir), probeProcess, killProcess, listChildren, log });
  } catch (err) {
    log?.(`host residue sweep failed: ${err instanceof Error ? err.message : err}`);
  }
  return { host: hostOutcome, engines: engineOutcomes };
}
