/**
 * duty runtime — 上下班状态机接到 store 与 run-manager 上的那层接线 (ticket 09).
 *
 * 纯判定在 duty/schedule.mjs（注入时钟、可单测）；这里只干三件事：
 *  1. 每个 tick（默认 1s，循环可关）：读每公司的 配置行/override/相位，
 *     advanceDuty 算出转移，把 clock_in / pause_runs 落成真实动作并把相位写回
 *     store（落盘 = 重启后视图不说谎、相位不丢）。
 *  2. applyOverride：手动上班/下班的「立即生效」路径（验收 2）。写的是
 *     duty_override 记录，配置行一个字节都不动。
 *  3. 查询：phaseForEmployee（派单闸门）、pauseAll（退出「直接退」先下班落盘）。
 *
 * 多公司并行（AGENTS 硬约束）：相位与 pause 都按公司隔离，A 下班不掐 B。
 */
import { advanceDuty, DEFAULT_SCHEDULE } from "./schedule.mjs";
import { appError } from "../../shared/apperror.mjs";

/**
 * @typedef {import("./schedule.mjs").DutySchedule} DutySchedule
 * @typedef {import("./schedule.mjs").DutyPhase} DutyPhase
 * @typedef {import("./schedule.mjs").DutyEffect} DutyEffect
 * @typedef {import("../store.mjs").ScheduleRow} ScheduleRow
 */

/**
 * @param {object} options
 * @param {ReturnType<import("../store.mjs").openStore>} options.store
 * @param {{ start(input: { employeeId: number, text: string, task?: { id: number } | null, resume?: boolean }): unknown, pause(input: { employeeId: number }): Promise<void>, activeRuns(): { id: number, employeeId: number }[] }} options.runManager
 * @param {() => number} [options.nowFn]
 * @param {number} [options.tickMs] 循环间隔；到点判定精度即此值（宽限界点本身按秒精确）
 * @param {(task: import("../store.mjs").TaskRow) => string} [options.taskPromptFor]
 *   续跑合同：默认用与派单同一份 taskPrompt（entry 注入 playbook 实现）。
 */
export function createDutyRuntime({ store, runManager, nowFn = () => Date.now(), tickMs = 1000, taskPromptFor }) {
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** Per-company last clock-in resume attempt (busy employees are retried). */
  /** @type {Map<number, number>} */
  const lastResumeAttempt = new Map();
  /** Companies whose clock_in/manual-on resume may still need a retry. */
  const resumePending = new Set();
  const RESUME_RETRY_MS = 30_000;

  /** @param {number} companyId @returns {DutySchedule} */
  function scheduleFor(companyId) {
    const row = store.getCompanySchedule(companyId);
    if (!row) return { workStart: DEFAULT_SCHEDULE.workStart, workEnd: DEFAULT_SCHEDULE.workEnd, graceSeconds: DEFAULT_SCHEDULE.graceSeconds };
    return { workStart: row.workStart, workEnd: row.workEnd, graceSeconds: row.graceSeconds };
  }

  /**
   * 把一条效果落成真实动作。clock_in / pause_runs 是仅有的两个副作用。
   *
   * @param {number} companyId
   * @param {DutyEffect} effect
   * @param {(reason: unknown) => void} complain
   */
  function applyEffect(companyId, effect, complain) {
    if (effect === "clock_in") {
      // Retry only failures of THIS transition (busy employee). A boot into an
      // already-on phase must not auto-resume tasks the boss paused by exiting
      // or by budget — the 30s reconciliation is not a fresh clock-in.
      resumePending.add(companyId);
      if (resumeCompany(companyId, complain) === 0) resumePending.delete(companyId);
      return;
    }
    if (effect === "pause_runs") {
      // 单个员工的 abort 收尾；调用方（tick 循环）不等它们 — 但 store 写入
      // 在每个 promise 里完成，「退出直接退」走 pauseAll 时才 await。
      for (const employeeId of activeEmployeesOfCompany(companyId)) {
        try {
          void runManager.pause({ employeeId }).catch((err) => {
            // The run settled between the iteration and the pause: nothing to
            // pause. Anything else is worth a log line.
            if (/** @type {{ code?: string }} */ (err ?? {}).code !== "no_active_run") complain(err);
          });
        } catch (err) {
          if (/** @type {{ code?: string }} */ (err ?? {}).code !== "no_active_run") complain(err);
        }
      }
    }
    // begin_grace：相位已落库，run 照常跑（宽限内新工具调用仍允许）— 无动作。
  }

  /**
   * 上班激活：该公司「有未完成任务」的员工各续跑一次。
   *  - 进行中 + 最近一轮 paused → resume 通道（五状态不动，追加会话）；
   *  - 进行中 + 最近一轮 interrupted（续跑后崩溃，开库自愈把会话落回
   *    interrupted 但带 paused 历史的任务留在进行中）→ 也走 resume；
   *  - 待办 + 最近一轮 interrupted/paused（崩溃自愈回待办的形状）→ 普通
   *    开工（open→running 合法转移）；
   *  - 待办 + 没有会话 = 老板还没派过单 — 不擅自开工（诚实边界）。
   *
   * @param {number} companyId
   * @param {(reason: unknown) => void} complain
   * @param {{ includeInterrupted?: boolean }} [options]
   * @returns {number} how many tasks this pass tried to start
   */
  function resumeCompany(companyId, complain, { includeInterrupted = true } = {}) {
    const promptFor = taskPromptFor ?? ((/** @type {any} */ task) => `继续完成任务：${task.title}`);
    let attempted = 0;
    for (const task of store.listTasksForCompany({ companyId })) {
      const latest = task.latestSessionStatus ?? null;
      // A crash-interrupted task is NOT silently resumed by the 30s
      // reconciliation below: ticket 10 gives the boss the three-choice door.
      // It may still be picked up at a real clock_in / manual 上班 boundary.
      //
      // A budget-paused task is not a 下班 pause either: ticket 12's soft gate
      // owns it, and the only way forward is 「+50% 继续」. Auto-resuming it
      // would start → trip → pause → start again forever.
      if (latest === "paused") {
        const summary = store.taskTokenSummary(task.id);
        if (summary.measured === true && summary.total >= task.tokenBudget) continue;
      }
      const resume =
        task.status === "running" &&
        (latest === "paused" || (includeInterrupted && latest === "interrupted"));
      const revived =
        task.status === "open" &&
        (latest === "paused" || (includeInterrupted && latest === "interrupted"));
      if (!resume && !revived) continue;
      attempted += 1;
      try {
        runManager.start({ employeeId: task.employeeId, text: promptFor(task), task: { id: task.id }, resume: resume || undefined });
      } catch (err) {
        // employee_busy（别的组也在跑/聊天中）不是错误，下一轮再试；
        // 其它失败（引擎未准入等）记日志，仍然下一轮重试。
        if (/** @type {{ code?: string }} */ (err ?? {}).code !== "employee_busy") complain(err);
      }
    }
    return attempted;
  }

  /** @param {number} companyId @returns {number[]} */
  function activeEmployeesOfCompany(companyId) {
    const ids = [];
    for (const run of runManager.activeRuns()) {
      const employee = store.employeeById(run.employeeId);
      if (employee && employee.companyId === companyId) ids.push(run.employeeId);
    }
    return ids;
  }

  /**
   * 一步 tick（循环与测试都走这里）。每公司独立：读现状 → advanceDuty →
   * 落相位 / 清过期 override → 放效果。
   */
  function tick() {
    const now = nowFn();
    // Just ids: officeSnapshot would run two full token aggregations every
    // second for data the tick never reads.
    for (const companyId of store.companyIds()) {
      tickCompany(companyId, now);
    }
  }

  /**
   * @param {number} companyId
   * @param {number} now
   */
  function tickCompany(companyId, now) {
    const statusRow = store.getDutyStatus(companyId);
    const phase = statusRow
      ? { phase: statusRow.phase, phaseSince: statusRow.phaseSince, graceUntil: statusRow.graceUntil }
      : null;
    const override = store.getDutyOverride(companyId);
    const result = advanceDuty({ phase, schedule: scheduleFor(companyId), override, now });

    if (result.clearOverride) store.clearDutyOverride(companyId);
    const changed =
      phase === null ||
      phase.phase !== result.phase.phase ||
      phase.graceUntil !== result.phase.graceUntil;
    if (changed) {
      store.setDutyStatus({
        companyId,
        phase: result.phase.phase,
        phaseSince: result.phase.phaseSince,
        graceUntil: result.phase.graceUntil,
      });
    }
    for (const effect of result.effects) {
      applyEffect(companyId, effect, (err) => logDuty(companyId, err));
    }

    // Reconciliation, not just edges:
    //  - phase is off but a run is still active (the earlier pause was
    //    fire-and-forget or its abort hung) → pause again, idempotently;
    //  - phase is on and the clock_in resume found the employee busy → retry
    //    on a slow cadence, otherwise a chat at 09:00 would keep the paused
    //    task parked until the next shift.
    const pausedByEffect = result.effects.includes("pause_runs");
    if (result.phase.phase === "off" && !pausedByEffect) {
      for (const employeeId of activeEmployeesOfCompany(companyId)) {
        try {
          void runManager.pause({ employeeId }).catch((err) => {
            if (/** @type {{ code?: string }} */ (err ?? {}).code !== "no_active_run") logDuty(companyId, err);
          });
        } catch (err) {
          if (/** @type {{ code?: string }} */ (err ?? {}).code !== "no_active_run") logDuty(companyId, err);
        }
      }
    }
    if (result.phase.phase === "on" && !result.effects.includes("clock_in") && resumePending.has(companyId)) {
      const last = lastResumeAttempt.get(companyId) ?? 0;
      if (last === 0) {
        // First observation of this phase is not a retry: seeding the clock
        // here avoids resuming every paused task the instant the app boots.
        lastResumeAttempt.set(companyId, now);
      } else if (now - last >= RESUME_RETRY_MS) {
        lastResumeAttempt.set(companyId, now);
        if (resumeCompany(companyId, (err) => logDuty(companyId, err), { includeInterrupted: false }) === 0) {
          resumePending.delete(companyId);
        }
      }
    }
  }

  /**
   * 手动上班/下班（验收 2：立即生效、不改时间表）。写 override 记录后立刻
   * 走一遍状态机 — 「立即」不靠下一个 tick。
   *
   * @param {number} companyId
   * @param {"on" | "off"} mode
   * @returns {{ phase: DutyPhase["phase"] }}
   */
  function applyOverride(companyId, mode) {
    if (mode !== "on" && mode !== "off") throw appError("invalid_payload", "duty override mode must be on/off");
    const exists = store.companyExists(companyId);
    if (!exists) throw appError("unknown_company", `no company with id ${companyId}`);
    const now = nowFn();
    store.setDutyOverride({ companyId, mode, at: now });
    // 「立即上班」= 立刻续跑，不依赖当前相位是不是已经 on（重启后相位可能
    // 还是 on，没有 clock_in 边沿可等）。tickCompany 仍负责落相位。
    if (mode === "on") {
      lastResumeAttempt.delete(companyId);
      resumePending.add(companyId);
      if (resumeCompany(companyId, (err) => logDuty(companyId, err)) === 0) resumePending.delete(companyId);
    }
    tickCompany(companyId, now);
    const status = /** @type {NonNullable<ReturnType<typeof store.getDutyStatus>>} */ (store.getDutyStatus(companyId));
    return { phase: status.phase };
  }

  /**
   * 退出「直接退」：先把所有在跑的 run 下班落盘（paused），等每家公司都
   * 合上再返回 — main 进程据此才 kill host。
   *
   * @returns {Promise<number>} 落盘的 run 数
   */
  async function pauseAll() {
    const targets = runManager.activeRuns().map((run) => run.employeeId);
    const results = await Promise.allSettled(targets.map((employeeId) => runManager.pause({ employeeId })));
    // Count what actually landed, not what we asked for: a failed abort is not
    // a persisted pause.
    return results.filter((result) => result.status === "fulfilled").length;
  }

  /**
   * 派单闸门的查询：员工所属公司现在的相位。查不到的员工（未知 id、还没
   * 公司）保守按 on — 闸门只拦明确「下班中」的。
   *
   * @param {number} employeeId
   * @returns {DutyPhase["phase"]}
   */
  function phaseForEmployee(employeeId) {
    const employee = store.employeeById(employeeId);
    if (!employee) return "on";
    const status = store.getDutyStatus(employee.companyId);
    return status?.phase ?? "on";
  }

  function start() {
    if (timer !== null) return;
    tick(); // 开机先落一次相位（首次观测不造事件）
    timer = setInterval(tick, tickMs);
    // 上下班滴答不该把宿主进程钉住
    timer.unref?.();
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { tick, start, stop, applyOverride, pauseAll, phaseForEmployee };
}

/**
 * duty 动作失败不掀翻循环：写进 host stderr（main 会 tee 到 agenthost.log）。
 *
 * @param {number} companyId
 * @param {unknown} err
 */
function logDuty(companyId, err) {
  const code = /** @type {{ code?: string }} */ (err ?? {}).code ?? "duty_error";
  process.stderr.write(`duty(company=${companyId}) skipped an action: ${code}\n`);
}
