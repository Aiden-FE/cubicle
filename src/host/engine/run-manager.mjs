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
import { explainRunFailure } from "./failure.mjs";
import { budgetState } from "../cost/budget.mjs";

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
 * @property {boolean} paused      票 09: 下班落盘 — 收尾写 paused 而非 aborted
 * @property {boolean} finished
 * @property {LiveSession | null} live        opened engine session for this run
 * @property {Promise<LiveSession> | null} opening in-flight adapter.open()
 * @property {Promise<void> | null} completion the runFlow promise: cancel waits for it to drain
 * @property {import("./events.mjs").Usage} usage running fold of every turn_end usage (票 06)
 * @property {boolean} usageReported 票 12: 引擎报过 usage（哪怕全是 0）— 与「未计量」严格区分
 * @property {boolean} budgetWarned  票 12: 80% 黄点只报一次
 * @property {boolean} budgetTripped 票 12: 100% 自动暂停只触发一次
 * @property {() => void} [clearWatchdog] run-level timeout cleanup
 */

/**
 * @typedef {object} TaskRunFinished
 * @property {RunRow} run
 * @property {"completed" | "aborted" | "failed" | "paused"} status
 * @property {{ at: number, event: NormalizedEvent }[]} events the full run tail
 */

/**
 * @param {object} options
 * @param {ReturnType<import("../store.mjs").openStore>} options.store
 * @param {(engine: string) => {
 *   open(input: { employee: unknown, session: EmployeeSessionRow, onEvent: (event: NormalizedEvent) => void }): Promise<LiveSession>,
 *   configFingerprint?(): string | null,
 * } | null} options.getAdapter
 * @param {(payload: { runId: number, employeeId: number, sessionId: number, at: number, event: NormalizedEvent }) => void} options.emit
 * @param {(finished: TaskRunFinished) => void | Promise<void>} [options.onTaskRunFinished] task-runs-only hook (ticket 05 artifact collection)
 * @param {(taskId: number) => void} [options.onTaskArtifactsReady] after an async artifact hook settles (UI refresh)
 * @param {number} [options.drainTimeoutMs] cancel/abort waits this long for the engine's own settle before forcing the end
 * @param {number} [options.runTimeoutMs] a run that never settles is force-cancelled after this long
 */
export function createRunManager({
  store,
  getAdapter,
  emit,
  onTaskRunFinished,
  onTaskArtifactsReady,
  drainTimeoutMs = 4000,
  runTimeoutMs = 30 * 60_000,
}) {
  /** @type {Map<number, ActiveRun>} */
  const active = new Map();
  /** live engine sessions keyed by employeeSessionId — ticket 11 widened
   *  sessions to one-per-engine, so the handle cache follows the session
   *  entity, not just the employee. */
  /** @type {Map<number, LiveSession>} */
  const liveSessions = new Map();
  /** models.json fingerprint that produced each live session. */
  /** @type {Map<number, string | null>} */
  const sessionFingerprints = new Map();
  /** Event epoch per employee session: events from retired handles are dropped. */
  /** @type {Map<number, number>} */
  const sessionEpochs = new Map();
  /** @type {Map<number, { runId: number, events: { at: number, event: NormalizedEvent }[] }>} */
  const lastRunEvents = new Map();
  /** @type {Array<(value?: unknown) => void>} */
  let quietWaiters = [];
  /** Artifact/status writes that outlive the run event (async git): whenQuiet waits for them. */
  /** @type {Set<Promise<unknown>>} */
  const pendingSideEffects = new Set();
  /** wire listeners (the admission probe rides the same topic the UI does) */
  /** @type {Set<(payload: { runId: number, employeeId: number, sessionId: number, at: number, event: NormalizedEvent }) => void>} */
  const listeners = new Set();

  /** Resolves when no run is active and every artifact/status side effect landed. */
  function whenQuiet() {
    if (active.size === 0 && pendingSideEffects.size === 0) return Promise.resolve();
    return new Promise((resolve) => quietWaiters.push(resolve));
  }

  /** @returns {import("./events.mjs").Usage} */
  function zeroUsage() {
    return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  }

  /**
   * Token accounting rides the event stream itself (票 06: token 来自 run 的
   * usage): every `turn_end` usage the engine reports is folded into the
   * run's running total — never invented when the engine stays silent.
   *
   * @param {import("./events.mjs").Usage} total
   * @param {import("./events.mjs").Usage | undefined} usage
   */
  function foldUsage(total, usage) {
    if (!usage) return;
    total.input += usage.input;
    total.cachedInput += usage.cachedInput;
    total.cacheWrite += usage.cacheWrite;
    total.output += usage.output;
    total.reasoning += usage.reasoning;
  }

  function signalQuiet() {
    if (active.size !== 0 || pendingSideEffects.size !== 0) return;
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
      // 票 12: 任务侧边栏要在事件流上认出「这是哪张工单」的预算信号。
      taskId: runRef.run.taskId,
      at: Date.now(),
      event,
    };
    if (event.type === "turn_end") foldUsage(runRef.usage, event.usage);
    if (event.type === "turn_end" && event.usage) runRef.usageReported = true;
    const buffer = lastRunEvents.get(runRef.run.employeeId);
    if (buffer && buffer.runId === runRef.run.id) {
      buffer.events.push({ at: payload.at, event });
      if (buffer.events.length > HISTORY_CAP) buffer.events.splice(0, 1);
    }
    emit(payload);
    for (const listener of listeners) listener(payload);
    // 票 12: 用量一落地就查预算（黄点/自动暂停的判定在 cost/budget 纯函数），
    // 在引发它的 turn_end 之后才上流 — 信号顺序与因果一致。
    if (event.type === "turn_end") checkBudget(runRef);
  }

  /**
   * 票 12 验收 4 — the per-task soft gate, judged on every usage fold:
   *  - 80%: one `budget_warning` on the run stream (UI 黄点) — the run keeps running;
   *  - 100%: one `budget_exhausted`, then pause the run through 票 09 的
   *    settleCancel(paused) door — run/task_session land 'paused', the task
   *    stays 进行中 (no sixth task state), and the engine abort means no new
   *    tool call can follow the cap. 「+50%」 (service) raises THIS task's
   *    budget and resumes by appending a session (06/09 同构).
   *
   * @param {ActiveRun} runRef
   */
  function checkBudget(runRef) {
    if (runRef.run.taskId === null) return;
    if (runRef.finished || runRef.aborted || runRef.paused) return;
    const task = store.taskById(runRef.run.taskId);
    if (!task) return;
    const past = store.taskTokenSummary(runRef.run.taskId).total;
    const live = usageTotal(runRef.usage);
    const state = budgetState(past + live, task.tokenBudget);
    if (state === "warn" && !runRef.budgetWarned) {
      runRef.budgetWarned = true;
      pushEvent(runRef, { type: "budget_warning", tokens: past + live, budget: task.tokenBudget });
    } else if (state === "exhausted" && !runRef.budgetTripped) {
      runRef.budgetTripped = true;
      pushEvent(runRef, { type: "budget_exhausted", tokens: past + live, budget: task.tokenBudget });
      // The engine must stop NOW — same handshake as 下班, landing 'paused'.
      settleCancel(runRef.run.employeeId, true).catch(() => {
        // a failing engine abort still lands: endRunSynthetically closes the run
      });
    }
  }

  /**
   * @param {import("./events.mjs").Usage} usage
   * @returns {number}
   */
  function usageTotal(usage) {
    return usage.input + usage.cachedInput + usage.cacheWrite + usage.output + usage.reasoning;
  }

  /**
   * @param {ActiveRun} runRef
   * @param {AgentEndEvent} endEvent
   */
  function finishRun(runRef, endEvent) {
    if (runRef.finished) return;
    runRef.finished = true;
    runRef.clearWatchdog?.();
    const status = runRef.paused
      ? "paused"
      : runRef.aborted
        ? "aborted"
        : /** @type {"completed" | "failed"} */ (endEvent.status === "ok" ? "completed" : "failed");
    // "unknown" (the engine settled without an agent_end) is recorded as
    // 'failed' on purpose: the protocol says every run ends with agent_end,
    // so a silent settle never counts as a clean completion.
    // Each store write is independent: a failing pointer save must not skip
    // the task-session close (which would leave the session running forever).
    try {
      // 票 12: 引擎报过 usage 就存（全 0 也是「计量到 0」）；没报过才是 null（未计量）。
      store.finishRun({
        runId: runRef.run.id,
        status,
        usage: runRef.usageReported ? runRef.usage : null,
        // 票 12 验收 1: 把 error 事件 code + 引擎最后状态折叠成人话存起来（不是堆栈），
        // 任务侧边栏读它 + 给「重试」出口。
        failReason: explainRunFailure({ status, events: runTailEvents(runRef) }),
      });
    } catch (err) {
      process.stderr.write(`run finish failed (${runRef.run.id}): ${err instanceof Error ? err.message : err}\n`);
    }
    try {
      const pointer = runRef.live?.sessionFile() ?? null;
      if (pointer) {
        store.setEmployeeSessionFile({ employeeSessionId: runRef.run.employeeSessionId, sessionFile: pointer });
      }
    } catch (err) {
      process.stderr.write(`resume pointer save failed (${runRef.run.id}): ${err instanceof Error ? err.message : err}\n`);
    }
    try {
      // The task session follows its run's outcome — one owner (this manager)
      // so it can never disagree with the run row.
      if (runRef.run.taskSessionId !== null) {
        store.finishTaskSession({ taskSessionId: runRef.run.taskSessionId, status });
      }
    } catch (err) {
      process.stderr.write(`task session finish failed (${runRef.run.id}): ${err instanceof Error ? err.message : err}\n`);
    }
    if (runRef.run.taskId !== null && onTaskRunFinished) {
      const taskId = runRef.run.taskId;
      try {
        const buffer = lastRunEvents.get(runRef.run.employeeId);
        const outcome = onTaskRunFinished({
          run: runRef.run,
          status,
          events: buffer && buffer.runId === runRef.run.id ? buffer.events : [],
        });
        if (outcome && typeof (/** @type {Promise<void>} */ (outcome)).then === "function") {
          // Async artifact collection (git is async now): whenQuiet must wait
          // for it, otherwise tests/e2e read the task before the 四件套 land.
          const sideEffect = Promise.resolve(outcome)
            .catch((err) => {
              process.stderr.write(`task artifact hook failed: ${err instanceof Error ? err.stack : err}\n`);
            })
            .then(() => {
              if (status !== "paused") onTaskArtifactsReady?.(taskId);
            })
            .finally(() => {
              pendingSideEffects.delete(sideEffect);
              signalQuiet();
            });
          pendingSideEffects.add(sideEffect);
        } else if (status !== "paused") {
          onTaskArtifactsReady?.(taskId);
        }
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
   * The normalized events streamed for this run so far (its tail buffer) —
   * the witness explainRunFailure folds into the human failure reason.
   *
   * @param {ActiveRun} runRef
   * @returns {NormalizedEvent[]}
   */
  function runTailEvents(runRef) {
    const buffer = lastRunEvents.get(runRef.run.employeeId);
    return buffer && buffer.runId === runRef.run.id ? buffer.events.map((entry) => entry.event) : [];
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
   * @param {{ employeeId: number, text: string, task?: { id: number } | null, resume?: boolean, probe?: boolean }} input
   * @returns {{ run: RunRow, session: EmployeeSessionRow }}
   */
  function start({ employeeId, text, task, resume, probe = false }) {
    if (typeof employeeId !== "number" || !Number.isInteger(employeeId) || employeeId <= 0) {
      throw appError("invalid_payload", "employeeId must be a positive integer");
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      throw appError("invalid_payload", "text must be a non-empty string");
    }
    const employee = store.employeeById(employeeId);
    if (!employee) throw appError("unknown_employee", `no employee with id ${employeeId}`);
    if (active.has(employeeId)) throw appError("employee_busy", `employee ${employeeId} is already working`);

    // 票 09/10 resume legality and the task's open→running transition live in
    // store.beginTaskRun, in the SAME transaction as the task_session + run
    // rows. A rejected dispatch can therefore never leave the task 进行中 with
    // no run behind (the ticket-06 "no dangling rows" rule, made structural).
    // 票 a01: the engine is a top-level snapshot pin (openStore has already
    // upgraded any v1 snapshot by the time a run can start).
    const engine = employee.roleSnapshot.engine || "pi";

    // Ticket 11 admission gate: an engine must be enabled (probe passed, or
    // hand-enabled with the risk flag) before it may take REAL work. The
    // probe itself is the admission test, so its runs bypass the gate. Only
    // enforced when the store tracks the engine (legacy stores stay permissive).
    if (!probe && typeof store.engineState === "function") {
      const state = store.engineState(engine);
      if (state && !state.enabled) {
        throw appError("engine_not_admitted", `engine ${engine} 尚未准入（未通过探针且未手动启用）`);
      }
    }

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

    // A task's workspace is pinned on the task row. Old tasks may live in the
    // pre-fix per-engine directory; run them THERE so their recorded baseHead
    // still resolves, even though the employee's chat workspace is shared.
    const taskWorkspace = task ? (store.taskById(task.id)?.workspaceDir ?? null) : null;
    const runSession =
      taskWorkspace && taskWorkspace !== session.workspaceDir
        ? { ...session, workspaceDir: taskWorkspace }
        : session;
    if (runSession.workspaceDir) mkdirSync(runSession.workspaceDir, { recursive: true });

    /** @type {RunRow} */
    let run;
    if (task) {
      const started = store.beginTaskRun({
        taskId: task.id,
        employeeSessionId: session.id,
        engine,
        prompt: text.trim(),
        resume: resume === true,
      });
      run = started.run;
    } else {
      run = store.createRun({
        employeeId,
        employeeSessionId: session.id,
        engine,
        prompt: text.trim(),
        taskId: null,
        taskSessionId: null,
      });
    }

    /** @type {ActiveRun} */
    const runRef = {
      run,
      aborted: false,
      paused: false,
      finished: false,
      live: liveSessions.get(session.id) ?? null,
      opening: null,
      completion: null,
      usage: zeroUsage(),
      usageReported: false,
      budgetWarned: false,
      budgetTripped: false,
    };
    active.set(employeeId, runRef);
    lastRunEvents.set(employeeId, { runId: run.id, events: [] });
    // Run-level watchdog: an engine that never settles must not keep the
    // employee busy forever (whenQuiet / 等完成 would hang for 30 minutes).
    if (runTimeoutMs > 0) {
      const watchdog = setTimeout(() => {
        if (runRef.finished) return;
        pushEvent(runRef, {
          type: "error",
          code: "run_timeout",
          message: `本轮超过 ${Math.round(runTimeoutMs / 60_000)} 分钟没有收尾，已强制结束`,
        });
        void settleCancel(employeeId, false).catch(() => {});
      }, runTimeoutMs);
      watchdog.unref?.();
      runRef.clearWatchdog = () => clearTimeout(watchdog);
    }
    // The first event lands synchronously: the UI always sees life on the
    // wire, even while a cold engine session is still coming up.
    pushEvent(runRef, { type: "session_start", sessionId: String(session.id) });
    runRef.completion = runFlow(runRef, employee, runSession, adapter);
    void runRef.completion.catch(() => {
      // runFlow owns its error path; this only prevents an unhandled rejection
      // if a future edit ever lets one escape.
    });
    return { run, session };
  }

  /**
   * @param {ActiveRun} runRef
   * @param {unknown} employee
   * @param {EmployeeSessionRow} session
   * @param {{ open(input: { employee: unknown, session: EmployeeSessionRow, onEvent: (event: NormalizedEvent) => void }): Promise<LiveSession>, configFingerprint?(): string | null }} adapter
   */
  async function runFlow(runRef, employee, session, adapter) {
    // 票 10: the resume pointer must survive a crash. finishRun-only persistence
    // loses it exactly when recovery needs it (a run killed mid-flight never
    // finishes), so the manager saves it once it exists — right after the
    // engine session opens, and again when a CLI host names its thread mid-run.
    let pointerSaved = false;
    const savePointerOnce = () => {
      if (pointerSaved) return;
      const pointer = runRef.live?.sessionFile?.() ?? null;
      if (!pointer) return;
      pointerSaved = true;
      try {
        store.setEmployeeSessionFile({ employeeSessionId: session.id, sessionFile: pointer });
      } catch {
        // store closing under a live run: finishRun's own save is the backstop
      }
    };
    try {
      const fingerprint =
        typeof adapter.configFingerprint === "function" ? adapter.configFingerprint() : null;
      let handle = liveSessions.get(session.id) ?? null;
      if (handle && (sessionFingerprints.get(session.id) ?? null) !== fingerprint) {
        // BYOK config changed since this engine session was opened. Retire the
        // handle; bump the epoch first so the old session's abort events can
        // never be attributed to the run that is starting now.
        sessionEpochs.set(session.id, (sessionEpochs.get(session.id) ?? 0) + 1);
        try {
          await handle.abort?.();
        } catch {
          // a dead session is still retired
        }
        liveSessions.delete(session.id);
        sessionFingerprints.delete(session.id);
        handle = null;
      }
      if (!handle) {
        const epoch = (sessionEpochs.get(session.id) ?? 0) + 1;
        sessionEpochs.set(session.id, epoch);
        const opening = adapter.open({
          employee,
          session,
          onEvent: (event) => {
            // Ignore events from a retired engine session (config reload,
            // abort, late child close).
            if (sessionEpochs.get(session.id) !== epoch) return;
            const current = active.get(session.employeeId);
            if (!current || current.finished) return;
            pushEvent(current, event);
            savePointerOnce();
            if (event.type === "agent_end") finishRun(current, event);
          },
        });
        runRef.opening = opening;
        try {
          handle = await opening;
        } finally {
          runRef.opening = null;
        }
        liveSessions.set(session.id, handle);
        sessionFingerprints.set(session.id, fingerprint);
      }
      runRef.live = handle;
      savePointerOnce();
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
   * `pause` (票 09) is the same handshake with a different landing status:
   * the engine aborts, the run closes as 'paused' — and because the prompt
   * is aborted, NO new tool call can follow the pause.
   *
   * @param {{ employeeId: number }} input
   * @returns {Promise<void>}
   */
  function abort({ employeeId }) {
    return settleCancel(employeeId, false);
  }

  /**
   * @param {{ employeeId: number }} input
   * @returns {Promise<void>}
   */
  function pause({ employeeId }) {
    return settleCancel(employeeId, true);
  }

  /**
   * @param {number} employeeId
   * @param {boolean} paused
   * @returns {Promise<void>}
   */
  function settleCancel(employeeId, paused) {
    const runRef = active.get(employeeId);
    if (!runRef) throw appError("no_active_run", `employee ${employeeId} has no running job`);
    if (paused) runRef.paused = true;
    else runRef.aborted = true;
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
      // Drain: the engine's abort() may resolve before its process/stream is
      // actually closed. Ending the run and releasing the employee here would
      // let a NEW run start while the OLD child is still emitting — and its
      // late agent_end/agent_settled would land on the new run (ticket-10
      // review: cancel → redispatch could mark a fresh task completed). Wait
      // for runFlow to settle (or a bounded drain) before releasing the slot.
      if (runRef.completion) {
        await Promise.race([
          runRef.completion.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, drainTimeoutMs)),
        ]);
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

  /**
   * Live runs right now — the iteration door 下班 (pause per company) and
   * host.pauseAll walk. Callers only ever read the returned RunRows.
   *
   * @returns {RunRow[]}
   */
  function activeRuns() {
    return Array.from(active.values(), (runRef) => runRef.run);
  }

  /**
   * Ride every run event (the same payload the transport emits) from inside
   * the host — used by the admission probe to observe its own runs without
   * touching the UI topic.
   *
   * @param {(payload: { runId: number, employeeId: number, sessionId: number, at: number, event: NormalizedEvent }) => void} listener
   * @returns {() => void} unsubscribe
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { start, abort, pause, history, whenQuiet, activeRuns, subscribe };
}
