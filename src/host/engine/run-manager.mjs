/**
 * Run manager — one employee sentence in, one engine run out.
 *
 * Owns the live engine sessions inside the AgentHost: it starts runs,
 * forwards every normalized engine event to the transport `emit` callback,
 * ends the run when the engine settles, and keeps one engine session per
 * employee so consecutive conversations continue the same session (ticket
 * 04: 同一员工连续两次对话复用同一会话).
 *
 * The engine itself is injected through `getAdapter` (decision 14 dual-host
 * protocol). An adapter is:
 *
 *   open({ employee, session, onEvent }) → Promise<LiveSession>
 *   LiveSession = {
 *     prompt(text): Promise<void>,  // resolves once the agent settles
 *     abort(): Promise<void>,       // protocol-mandatory cancel
 *     sessionFile(): string | null, // the adapter's resume pointer
 *   }
 *
 * and must end every prompt with exactly one `agent_end` event (adapters
 * synthesize one when the engine settles without it).
 */
import { mkdirSync } from "node:fs";

import { appError } from "../../shared/apperror.mjs";
import { enginePaths } from "./paths.mjs";

/** Cap for the in-memory tail of engine events kept per employee so a view
 *  reload can re-paint the last run (ticket 05 persists the real history). */
const HISTORY_CAP = 400;

/**
 * @typedef {import("./events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("./events.mjs").AgentEndEvent} AgentEndEvent
 * @typedef {import("../store.mjs").EmployeeSessionRow} EmployeeSessionRow
 * @typedef {import("../store.mjs").RunRow} RunRow
 *
 * @typedef {{ prompt(text: string): Promise<void>, abort(): Promise<void>, sessionFile(): string | null }} LiveSession
 *
 * @typedef {object} ActiveRun
 * @property {RunRow} run
 * @property {boolean} aborted
 * @property {boolean} finished
 * @property {LiveSession | null} live        opened engine session for this run
 * @property {Promise<LiveSession> | null} opening in-flight adapter.open()
 */

/**
 * @typedef {object} TaskRunFinished
 * @property {RunRow} run
 * @property {"completed" | "aborted" | "failed"} status
 * @property {{ at: number, event: NormalizedEvent }[]} events the full run tail
 */

/**
 * @param {object} options
 * @param {ReturnType<import("../store.mjs").openStore>} options.store
 * @param {(engine: string) => {
 *   open(input: { employee: unknown, session: EmployeeSessionRow, onEvent: (event: NormalizedEvent) => void }): Promise<LiveSession>,
 * } | null} options.getAdapter
 * @param {(payload: { runId: number, employeeId: number, sessionId: number, at: number, event: NormalizedEvent }) => void} options.emit
 * @param {(finished: TaskRunFinished) => void} [options.onTaskRunFinished] task-runs-only hook (ticket 05 artifact collection)
 */
export function createRunManager({ store, getAdapter, emit, onTaskRunFinished }) {
  /** @type {Map<number, ActiveRun>} */
  const active = new Map();
  /** @type {Map<number, LiveSession>} */
  const liveSessions = new Map();
  /** @type {Map<number, { runId: number, events: { at: number, event: NormalizedEvent }[] }>} */
  const lastRunEvents = new Map();
  /** @type {Array<(value?: unknown) => void>} */
  let quietWaiters = [];

  /** Resolves when no run is active — the seam's determinism handle. */
  function whenQuiet() {
    if (active.size === 0) return Promise.resolve();
    return new Promise((resolve) => quietWaiters.push(resolve));
  }

  function signalQuiet() {
    if (active.size !== 0) return;
    const waiters = quietWaiters;
    quietWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * @param {ActiveRun} runRef
   * @param {NormalizedEvent} event
   */
  function pushEvent(runRef, event) {
    const payload = {
      runId: runRef.run.id,
      employeeId: runRef.run.employeeId,
      sessionId: runRef.run.employeeSessionId,
      at: Date.now(),
      event,
    };
    const buffer = lastRunEvents.get(runRef.run.employeeId);
    if (buffer && buffer.runId === runRef.run.id) {
      buffer.events.push({ at: payload.at, event });
      if (buffer.events.length > HISTORY_CAP) buffer.events.splice(0, 1);
    }
    emit(payload);
  }

  /**
   * @param {ActiveRun} runRef
   * @param {AgentEndEvent} endEvent
   */
  function finishRun(runRef, endEvent) {
    if (runRef.finished) return;
    runRef.finished = true;
    const status = runRef.aborted
      ? "aborted"
      : /** @type {"completed" | "failed"} */ (endEvent.status === "ok" ? "completed" : "failed");
    // "unknown" (the engine settled without an agent_end) is recorded as
    // 'failed' on purpose: the protocol says every run ends with agent_end,
    // so a silent settle never counts as a clean completion.
    try {
      store.finishRun({ runId: runRef.run.id, status });
      const pointer = runRef.live?.sessionFile() ?? null;
      if (pointer) {
        store.setEmployeeSessionFile({ employeeSessionId: runRef.run.employeeSessionId, sessionFile: pointer });
      }
      // The task session follows its run's outcome — one owner (this
      // manager) so it can never disagree with the run row.
      if (runRef.run.taskSessionId !== null) {
        store.finishTaskSession({ taskSessionId: runRef.run.taskSessionId, status });
      }
    } catch {
      // the store closing under a settling run (host shutdown) must not throw
    }
    if (runRef.run.taskId !== null && onTaskRunFinished) {
      try {
        const buffer = lastRunEvents.get(runRef.run.employeeId);
        onTaskRunFinished({
          run: runRef.run,
          status,
          events: buffer && buffer.runId === runRef.run.id ? buffer.events : [],
        });
      } catch (err) {
        // artifact collection must never take the run loop down; stderr is
        // teed into <dataDir>/agenthost.log by the main process
        process.stderr.write(`task artifact hook failed: ${err instanceof Error ? err.stack : err}\n`);
      }
    }
    active.delete(runRef.run.employeeId);
    signalQuiet();
  }

  /**
   * Close a run whose engine never delivered its own agent_end. One entry
   * point so a run can never put two terminal events on the wire.
   *
   * @param {ActiveRun} runRef
   * @param {AgentEndEvent["status"]} status
   */
  function endRunSynthetically(runRef, status) {
    if (runRef.finished) return;
    const event = /** @type {AgentEndEvent} */ ({ type: "agent_end", status });
    pushEvent(runRef, event);
    finishRun(runRef, event);
  }

  /**
   * @param {{ employeeId: number, text: string, task?: { id: number } | null }} input
   * @returns {{ run: RunRow, session: EmployeeSessionRow }}
   */
  function start({ employeeId, text, task }) {
    if (typeof employeeId !== "number" || !Number.isInteger(employeeId) || employeeId <= 0) {
      throw appError("invalid_payload", "employeeId must be a positive integer");
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      throw appError("invalid_payload", "text must be a non-empty string");
    }
    const employee = store.employeeById(employeeId);
    if (!employee) throw appError("unknown_employee", `no employee with id ${employeeId}`);
    if (active.has(employeeId)) throw appError("employee_busy", `employee ${employeeId} is already working`);

    const engine = employee.roleSnapshot.manifest.engine || "pi";
    const adapter = getAdapter(engine);
    if (!adapter) throw appError("engine_unavailable", `engine ${engine} has no adapter in this build`);

    const dirs = enginePaths(store.dataDir, engine, employeeId);
    for (const dir of [dirs.root, dirs.agentDir, dirs.sessionsDir, dirs.workspaceDir]) {
      mkdirSync(dir, { recursive: true });
    }
    const session = store.getOrCreateEmployeeSession({
      employeeId,
      engine,
      agentDir: dirs.agentDir,
      sessionsDir: dirs.sessionsDir,
      workspaceDir: dirs.workspaceDir,
    });
    // A dispatched work order runs inside its own task session (GLOSSARY:
    // 会话挂在任务下，可多条 — retry gets a fresh one).
    const taskSession = task ? store.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine }) : null;
    if (task) store.setTaskStatus(task.id, "running");
    const run = store.createRun({
      employeeId,
      employeeSessionId: session.id,
      engine,
      prompt: text.trim(),
      taskId: task?.id ?? null,
      taskSessionId: taskSession?.id ?? null,
    });

    /** @type {ActiveRun} */
    const runRef = { run, aborted: false, finished: false, live: liveSessions.get(employeeId) ?? null, opening: null };
    active.set(employeeId, runRef);
    lastRunEvents.set(employeeId, { runId: run.id, events: [] });
    // The first event lands synchronously: the UI always sees life on the
    // wire, even while a cold engine session is still coming up.
    pushEvent(runRef, { type: "session_start", sessionId: String(session.id) });
    void runFlow(runRef, employee, session, adapter);
    return { run, session };
  }

  /**
   * @param {ActiveRun} runRef
   * @param {unknown} employee
   * @param {EmployeeSessionRow} session
   * @param {{ open(input: { employee: unknown, session: EmployeeSessionRow, onEvent: (event: NormalizedEvent) => void }): Promise<LiveSession> }} adapter
   */
  async function runFlow(runRef, employee, session, adapter) {
    try {
      let handle = liveSessions.get(session.employeeId);
      if (!handle) {
        const opening = adapter.open({
          employee,
          session,
          onEvent: (event) => {
            const current = active.get(session.employeeId);
            if (!current) return;
            pushEvent(current, event);
            if (event.type === "agent_end") finishRun(current, event);
          },
        });
        runRef.opening = opening;
        try {
          handle = await opening;
        } finally {
          runRef.opening = null;
        }
        liveSessions.set(session.employeeId, handle);
      }
      runRef.live = handle;
      if (runRef.finished) return;
      if (runRef.aborted) {
        // cancelled while the engine session was still opening
        endRunSynthetically(runRef, "failed");
        return;
      }
      await handle.prompt(runRef.run.prompt);
      if (!runRef.finished) {
        // The engine settled without emitting agent_end: close it honestly.
        endRunSynthetically(runRef, runRef.aborted ? "failed" : "unknown");
      }
    } catch (err) {
      if (runRef.finished) return;
      const code = /** @type {{ code?: string }} */ (err ?? {}).code ?? "engine_failed";
      const message = err instanceof Error ? err.message : String(err);
      pushEvent(runRef, { type: "error", code, message });
      endRunSynthetically(runRef, "failed");
    }
  }

  /**
   * Synchronous validation (the service answers error codes on the reply
   * envelope), then a promise for the cancel handshake with the engine.
   *
   * @param {{ employeeId: number }} input
   * @returns {Promise<void>}
   */
  function abort({ employeeId }) {
    const runRef = active.get(employeeId);
    if (!runRef) throw appError("no_active_run", `employee ${employeeId} has no running job`);
    runRef.aborted = true;
    return (async () => {
      if (runRef.opening) {
        // cancel arrives mid-open: wait for the session, then cancel that
        await runRef.opening.catch(() => {});
      }
      if (runRef.live) {
        try {
          await runRef.live.abort();
        } catch {
          // a failing cancel still cancels: fall through to the forced end
        }
      }
      // the engine returned from abort without settling — end the run here
      endRunSynthetically(runRef, "failed");
    })();
  }

  /**
   * @param {{ employeeId: number }} input
   * @returns {{ lastRun: RunRow | null, events: { at: number, event: NormalizedEvent }[] }}
   */
  function history({ employeeId }) {
    const lastRun = store.latestRunForEmployee(employeeId);
    const buffer = lastRunEvents.get(employeeId);
    const events = buffer && lastRun && buffer.runId === lastRun.id ? buffer.events : [];
    return { lastRun, events };
  }

  return { start, abort, history, whenQuiet };
}
