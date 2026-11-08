/**
 * Engine child-process ledger — crash hygiene for CLI hosts (ticket 10).
 *
 * A hard kill (taskkill /F on the app, or a power loss) never runs ANY of
 * our exit hooks: the AgentHost's `exit` listener, the codex adapter's
 * killChildrenSync — none of it fires, and codex (plus its shell tree) is
 * orphaned under a dead parent. Process hooks cannot promise what the OS
 * will not deliver, so the app keeps a FILE: every spawned engine child is
 * recorded in <dataDir>/engines/<engine>/children.json the moment it exists
 * and removed the moment it settles. The next launch reads the ledger BEFORE
 * starting anything: an entry with a live, identically-named,
 * right-age process is an orphan from the crash — kill the tree; anything
 * else (dead pid, recycled pid under another name, wrong-age twin) is only
 * cleaned from the ledger. Then the ledger is reset — it describes exactly
 * one crash scene.
 *
 * The same ledger mechanism covers the AgentHost utility process itself
 * (recorded by the main-process supervisor): if the app was force-killed,
 * the orphaned utility process is still a live SQLite writer — the next
 * launch must kill it before spawning a new host, or two writers share one
 * WAL. Identity guards keep that safe: pid alone is never trusted.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * @typedef {object} LedgerEntry
 * @property {number} pid
 * @property {string} name  executable name recorded at spawn (extension-lenient: "codex" matches codex.exe)
 * @property {string} startedAt ISO timestamp — recorded at spawn; the identity guard's age check
 * @property {string} [commandLineHint] an argv substring unique to this process family (workspace dir, service name)
 * @property {string} [note]
 *
 * @typedef {{ name: string, createdAt: string | null, commandLine?: string | null }} ProcessIdentity
 */

/** How far a probed CreationDate may sit from the recorded startedAt and
 *  still count as the same process. Generous on purpose (slow boots under AV)
 *  but far below "an unrelated process started an hour later". */
const IDENTITY_AGE_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * A tiny, dependency-free JSON ledger. Writes are synchronous (tiny files,
 * correctness first: a write racing a crash must land before the child does
 * any work) and atomic (tmp + rename, so a crash mid-write never leaves a
 * half-written file the next launch has to parse).
 *
 * @param {{ file: string }} options
 */
export function createPidLedger({ file }) {
  const save = (/** @type {LedgerEntry[]} */ entries) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 1), "utf8");
    try {
      renameSync(tmp, file);
    } catch {
      // Windows: the target can briefly be held by a just-killed reader.
      // The tmp file stays valid; the next write retries the swap.
      try {
        renameSync(tmp, file);
      } catch {
        // best-effort: losing one ledger write costs one missed sweep entry
      }
    }
  };

  return {
    /** @returns {LedgerEntry[]} corrupt files read as empty — never a crash */
    read() {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((entry) => typeof entry?.pid === "number" && Number.isInteger(entry.pid) && entry.pid > 0)
          .map((entry) => ({
            pid: entry.pid,
            name: String(entry.name ?? ""),
            startedAt: String(entry.startedAt ?? ""),
            ...(entry.commandLineHint ? { commandLineHint: String(entry.commandLineHint) } : {}),
            ...(entry.note ? { note: String(entry.note) } : {}),
          }));
      } catch {
        return [];
      }
    },

    /** @param {LedgerEntry & { pid: number }} entry */
    record(entry) {
      const entries = this.read().filter((e) => e.pid !== entry.pid);
      entries.push({
        pid: entry.pid,
        name: entry.name,
        startedAt: entry.startedAt,
        ...(entry.commandLineHint ? { commandLineHint: entry.commandLineHint } : {}),
        ...(entry.note ? { note: entry.note } : {}),
      });
      save(entries);
    },

    /** @param {number} pid */
    forget(pid) {
      const entries = this.read();
      const kept = entries.filter((e) => e.pid !== pid);
      if (kept.length !== entries.length) save(kept);
    },

    clear() {
      save([]);
    },
  };
}

/**
 * Identity guard (pure, table-tested): a ledger entry and a live process are
 * the same process when the executable name matches (case-insensitive, the
 * ledger may record it with or without ".exe") AND the creation time is
 * within tolerance of the recorded spawn time. A probe without a creation
 * time passes on the name match (documented conservatism: the pid+name+no-age
 * case only arises on probe implementations without CreationDate).
 *
 * @param {LedgerEntry} entry
 * @param {ProcessIdentity | null} probed
 * @returns {boolean}
 */
export function identityMatches(entry, probed) {
  if (!probed) return false;
  const want = String(entry.name ?? "").toLowerCase();
  const got = String(probed.name ?? "").toLowerCase();
  if (got.length === 0 || want.length === 0) return false;
  if (got !== want && got !== `${want}.exe`) return false;
  if (entry.startedAt && probed.createdAt) {
    const recorded = Date.parse(entry.startedAt);
    const born = Date.parse(probed.createdAt);
    if (!Number.isFinite(recorded) || !Number.isFinite(born)) return false;
    if (Math.abs(born - recorded) > IDENTITY_AGE_TOLERANCE_MS) return false;
  }
  // A process whose argv does not contain the recorded unique substring is a
  // recycled pid / another instance — do not touch it. Probes that cannot
  // read a command line stay conservative (name + age only).
  if (entry.commandLineHint && probed.commandLine && !probed.commandLine.includes(entry.commandLineHint)) {
    return false;
  }
  return true;
}

/**
 * Read one pid's identity through WMI (Get-CimInstance). tasklist is
 * unreliable on this machine; CIM is the proven sampler. Empty output = the
 * pid is not alive (or never was).
 *
 * @param {number} pid
 * @returns {Promise<ProcessIdentity | null>}
 */
export function defaultProbeProcess(pid) {
  return new Promise((resolve) => {
    spawnProbe(pid, (err, stdout) => {
      if (err) {
        resolve(null); // probe failure reads as "not confirmed alive" — nothing gets killed
        return;
      }
      const line = String(stdout).trim();
      if (line.length === 0) {
        resolve(null);
        return;
      }
      // "name|createdAt|commandLine…" — split from the front; the command
      // line itself may contain '|', so only the first two fields are parsed.
      const first = line.indexOf("|");
      const second = line.indexOf("|", first + 1);
      if (first === -1) {
        resolve({ name: line, createdAt: null });
        return;
      }
      const name = line.slice(0, first).trim();
      const createdAt = second === -1 ? line.slice(first + 1).trim() : line.slice(first + 1, second).trim();
      const commandLine = second === -1 ? null : line.slice(second + 1);
      resolve({ name, createdAt: createdAt.length > 0 ? createdAt : null, commandLine });
    });
  });
}

/** @param {number} pid @param {(err: Error | null, stdout: string) => void} cb */
function spawnProbe(pid, cb) {
  // A hung PowerShell must not hang app boot: the probe has a hard timeout.
  let settled = false;
  /** @param {Error | null} err @param {string} stdout */
  const finish = (err, stdout) => {
    if (settled) return;
    settled = true;
    cb(err, stdout);
  };
  // ProcessId is an integer literal — the pid came from our own ledger, and
  // the filter string keeps it out of any shell quoting games.
  const ps = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}" | ForEach-Object { '{0}|{1:o}|{2}' -f $_.Name, $_.CreationDate, $_.CommandLine }`,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  let stdout = "";
  const timer = setTimeout(() => {
    try {
      ps.kill();
    } catch {
      // already gone
    }
    finish(new Error("probe timeout"), stdout);
  }, 3000);
  timer.unref?.();
  ps.stdout?.setEncoding?.("utf8");
  ps.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  ps.on("error", () => {
    clearTimeout(timer);
    finish(new Error("powershell spawn failed"), "");
  });
  ps.on("close", (code) => {
    clearTimeout(timer);
    finish(code === 0 ? null : new Error(`probe exit ${code}`), stdout);
  });
}

/**
 * Kill a process tree hard (taskkill /T /F — the same tool the CLI-host
 * abort path already trusts on this machine).
 *
 * @param {number} pid
 * @returns {Promise<void>}
 */
export function defaultKillProcess(pid) {
  return new Promise((resolve, reject) => {
    const killer = spawn("taskkill", ["/pid", String(Math.trunc(pid)), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", (err) => reject(err));
    const timer = setTimeout(() => {
      try {
        killer.kill();
      } catch {
        // already gone
      }
      reject(new Error("taskkill timeout"));
    }, 5000);
    timer.unref?.();
    killer.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`taskkill exited ${code ?? "?"}`));
    });
  });
}

/**
 * List the direct children of a pid (CIM; the app's own taskkill /T needs a
 * LIVE parent — a DEAD ledger pid's orphans must be enumerated and killed one
 * by one). Creation time rides along so the sweep can refuse an orphan that
 * predates the crash window.
 *
 * @param {number} pid
 * @returns {Promise<{ pid: number, name: string, createdAt?: string | null }[]>}
 */
export function defaultListChildProcesses(pid) {
  return new Promise((resolve) => {
    let settled = false;
    /** @param {{ pid: number, name: string, createdAt?: string | null }[]} kids */
    const done = (kids) => {
      if (settled) return;
      settled = true;
      resolve(kids);
    };
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Math.trunc(pid)}" | ForEach-Object { '{0}|{1}|{2:o}' -f $_.Name, $_.ProcessId, $_.CreationDate }`,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    const timer = setTimeout(() => {
      try {
        ps.kill();
      } catch {
        // already gone
      }
      done([]);
    }, 3000);
    timer.unref?.();
    ps.stdout?.setEncoding?.("utf8");
    ps.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    ps.on("error", () => {
      clearTimeout(timer);
      done([]);
    });
    ps.on("close", () => {
      clearTimeout(timer);
      const kids = [];
      for (const line of String(stdout).split(/\r?\n/)) {
        const first = line.indexOf("|");
        const second = line.indexOf("|", first + 1);
        if (first === -1) continue;
        const name = line.slice(0, first).trim();
        const childPid = Number(line.slice(first + 1, second === -1 ? undefined : second).trim());
        const createdAt = second === -1 ? null : line.slice(second + 1).trim() || null;
        if (name.length > 0 && Number.isInteger(childPid) && childPid > 0) kids.push({ pid: childPid, name, createdAt });
      }
      done(kids);
    });
  });
}

/**
 * Sweep one ledger: probe each entry, kill identity-CONFIRMED survivors, and
 * when an entry's process is already DEAD, sweep the orphans it left behind
 * (its still-live direct children — a dead pid cannot be taskkill /T'd, the
 * children would otherwise outlive the sweep). A recycled pid (identity
 * mismatch while alive) is NEVER touched — not the pid, not its children.
 * Then the ledger resets. A failing kill does not stop the sweep.
 *
 * @param {{
 *   file: string,
 *   probeProcess?: (pid: number) => Promise<ProcessIdentity | null>,
 *   killProcess?: (pid: number) => Promise<void>,
 *   listChildren?: (pid: number) => Promise<{ pid: number, name: string, createdAt?: string | null }[]>,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<{ checked: number, killed: number, orphanChildren: number, stale: number }>}
 */
export async function sweepPidLedger({
  file,
  probeProcess = defaultProbeProcess,
  killProcess = defaultKillProcess,
  listChildren = defaultListChildProcesses,
  log,
}) {
  const ledger = createPidLedger({ file });
  const entries = ledger.read();
  const outcome = { checked: 0, killed: 0, orphanChildren: 0, stale: 0 };
  const sweptPids = /** @type {number[]} */ ([]);
  for (const entry of entries) {
    outcome.checked += 1;
    sweptPids.push(entry.pid);
    let probed = null;
    try {
      probed = await probeProcess(entry.pid);
    } catch (err) {
      log?.(`ledger probe failed pid=${entry.pid}: ${err instanceof Error ? err.message : err}`);
    }
    if (identityMatches(entry, probed)) {
      try {
        await killProcess(entry.pid);
        outcome.killed += 1;
        log?.(`swept orphan pid=${entry.pid} (${probed?.name ?? "?"})`);
      } catch (err) {
        // a refused kill is still a ledger-cleared entry: the next launch must
        // not inherit this crash scene forever; the log says what happened.
        outcome.stale += 1;
        log?.(`ledger kill failed pid=${entry.pid}: ${err instanceof Error ? err.message : err}`);
      }
      continue;
    }
    // Identity did not match. Two very different cases:
    outcome.stale += 1;
    if (probed !== null) {
      // pid reused by ANOTHER live process: hands off — its children are
      // that other process's business, not our crash scene.
      continue;
    }
    // The ledger pid itself died (killed by the OS/job, or by an earlier
    // sweep): its direct children, if any still live, are true orphans of the
    // crash — kill them tree-by-tree. (Windows keeps ParentProcessId of dead
    // parents queryable, so the enumeration finds exactly the leftovers.)
    try {
      const kids = await listChildren(entry.pid);
      const entryBorn = Date.parse(entry.startedAt);
      for (const kid of kids) {
        // A child that predates the crash window cannot be this crash's
        // orphan; killing it by ParentProcessId alone would be pid-reuse
        // roulette with an unrelated process tree.
        const kidBorn = kid.createdAt ? Date.parse(kid.createdAt) : NaN;
        if (Number.isFinite(entryBorn) && Number.isFinite(kidBorn) && kidBorn < entryBorn - 60_000) {
          log?.(`skipped old child pid=${kid.pid} (${kid.name}) of dead ledger pid=${entry.pid}`);
          continue;
        }
        try {
          await killProcess(kid.pid);
          outcome.orphanChildren += 1;
          log?.(`swept orphan child pid=${kid.pid} (${kid.name}) of dead ledger pid=${entry.pid}`);
        } catch (err) {
          log?.(`ledger child kill failed pid=${kid.pid}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      log?.(`ledger child list failed pid=${entry.pid}: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Forget only the entries this sweep processed: the snapshot was taken at
  // sweep start, and a host boot-sweep can overlap a FRESH spawn (recorded
  // mid-sweep) — a whole-file clear() would erase that live entry and hand
  // its orphan back to nobody. Per-pid forget keeps the fresh line intact.
  for (const pid of sweptPids) ledger.forget(pid);
  return outcome;
}

/** The conventional ledger file for one engine inside a data dir. */
export function engineLedgerFile(/** @type {string} */ dataDir, /** @type {string} */ engine) {
  return path.join(dataDir, "engines", engine, "children.json");
}
