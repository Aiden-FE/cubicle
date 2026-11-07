/**
 * 上下班时间表 — 纯状态机 (ticket 09: 时间可测).
 *
 * 到点判定全部走注入时钟：调用方把 now (epoch ms) 递进来，这里不做任何
 * 副作用 — 只算出「相位怎么变 + 该产生哪些效果」。宿主 (duty/runtime.mjs)
 * 负责把 clock_in / begin_grace / pause_runs 落成真实动作（续跑 / 落库）。
 *
 * 两条独立状态（验收 2 的地基）：
 *  - schedule（配置行）：每公司 workStart / workEnd / graceSeconds；
 *  - override（当前态记录）：手动上班/下班，立即生效，绝不写回时间表；
 *    越过下一个排班界点（上班点或下班点）后自动失效，回到时间表。
 *
 * 硬约束（AGENTS）：定时下班 = 90 秒宽限（可配）+ 落盘 + 可恢复。宽限从
 * 下班界点起算，不是从「发现时刻」起算 — host 打盹不会白送更多干活时间。
 */

/**
 * @typedef {{ workStart: string, workEnd: string, graceSeconds: number }} DutySchedule
 * @typedef {{ mode: "on" | "off", at: number }} DutyOverride
 * @typedef {{ phase: "on" | "grace" | "off", phaseSince: number, graceUntil: number | null }} DutyPhase
 * @typedef {"clock_in" | "begin_grace" | "pause_runs"} DutyEffect
 */

/** v1 默认班表：90 秒宽限是 AGENTS 硬约束里的默认值（可配）。 */
export const DEFAULT_SCHEDULE = Object.freeze({ workStart: "09:00", workEnd: "18:00", graceSeconds: 90 });

/**
 * "HH:MM" 或 "HH:MM:SS" → 当日秒数；任何其它写法都是 null。
 * 秒级精度是给票 09 验收留的口子：e2e 能把下班配成「几秒后」真实等待。
 *
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseClock(text) {
  if (typeof text !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s ?? "0");
}

/**
 * 时间表合法性：两端都能解析、下班晚于上班（v1 不跨夜）、宽限是非负整数秒。
 *
 * @param {{ workStart: unknown, workEnd: unknown, graceSeconds: unknown }} candidate
 * @returns {{ ok: true, schedule: DutySchedule } | { ok: false, reason: string }}
 */
export function validateSchedule(candidate) {
  const start = parseClock(candidate.workStart);
  const end = parseClock(candidate.workEnd);
  if (start === null || end === null) {
    return { ok: false, reason: "上下班时刻必须是 HH:MM 或 HH:MM:SS（本地时间）" };
  }
  if (start >= end) {
    return { ok: false, reason: "下班时刻必须晚于上班时刻（v1 不跨夜）" };
  }
  const grace = candidate.graceSeconds;
  if (typeof grace !== "number" || !Number.isInteger(grace) || grace < 0 || grace > 86_400) {
    return { ok: false, reason: "宽限必须是 0–86400 之间的整数秒" };
  }
  return { ok: true, schedule: { workStart: String(candidate.workStart), workEnd: String(candidate.workEnd), graceSeconds: grace } };
}

/**
 * 当日（以 now 所在本地日为准）的上班界点与下班界点（epoch ms）。
 * 非法时间表按「不在班」处理：界点视为不存在，不猜班表。
 *
 * @param {DutySchedule} schedule
 * @param {number} nowMs
 * @returns {{ startMs: number, endMs: number } | null}
 */
function dayWindow(schedule, nowMs) {
  const start = parseClock(schedule.workStart);
  const end = parseClock(schedule.workEnd);
  if (start === null || end === null || start >= end) return null;
  const local = new Date(nowMs);
  const midnight = new Date(local.getFullYear(), local.getMonth(), local.getDate()).getTime();
  return { startMs: midnight + start * 1000, endMs: midnight + end * 1000 };
}

/**
 * 现在是否在班上：[workStart, workEnd)（上班点含、下班点不含）。
 *
 * @param {DutySchedule} schedule
 * @param {number} nowMs
 * @returns {boolean}
 */
export function scheduleOnDuty(schedule, nowMs) {
  const window = dayWindow(schedule, nowMs);
  if (!window) return false;
  return nowMs >= window.startMs && nowMs < window.endMs;
}

/**
 * 排班界点（上班点 + 下班点）在 (at, now] 区间里是否被越过。
 * override 的失效判据：「越过下一个排班界点」— 不是简单比较两端相位，
 * 那样会漏掉「其间进出过班次」的界点。
 *
 * @param {DutySchedule} schedule
 * @param {number} at
 * @param {number} now
 * @returns {boolean}
 */
function crossedScheduleBoundary(schedule, at, now) {
  if (!(at < now)) return false;
  for (const anchor of [at, now]) {
    const window = dayWindow(schedule, anchor);
    if (!window) continue;
    if (window.startMs > at && window.startMs <= now) return true;
    if (window.endMs > at && window.endMs <= now) return true;
  }
  return false;
}

/**
 * 一步 tick：给定当前相位 + 时间表 + override + 时钟，产出新相位与效果。
 *
 * 相位转移（每次 tick 至多一个界点动作）：
 *   on ──到下班点──▶ grace（宽限从界点起算；发现时已过期则直接 off）
 *   grace ──宽限到期──▶ off + pause_runs
 *   off ──到上班点──▶ on + clock_in
 *   * ──override──▶ 立即生效：on 拨到 on（clock_in 由调用方触发一次），
 *     off 拨到 off + pause_runs（无宽限 = 「立即」）
 *   相位未知（首次观测 / 重启）→ 只落位，不放 effects：重启不伪造上班。
 *
 * @param {{ phase: DutyPhase | null, schedule: DutySchedule, override: DutyOverride | null, now: number }} input
 * @returns {{ phase: DutyPhase, effects: DutyEffect[], clearOverride: boolean }}
 */
export function advanceDuty({ phase, schedule, override, now }) {
  let clearOverride = false;
  let active = override;
  if (active && crossedScheduleBoundary(schedule, active.at, now)) {
    clearOverride = true;
    active = null;
  }

  const scheduleNow = scheduleOnDuty(schedule, now);
  const desired = active ? active.mode : scheduleNow ? "on" : "off";

  // 首次观测：落位不造事件（到点上班才是事件；重启不是到点）。
  if (phase === null) {
    return { phase: { phase: desired, phaseSince: now, graceUntil: null }, effects: [], clearOverride };
  }

  if (desired === "on") {
    if (phase.phase === "off") {
      return { phase: { phase: "on", phaseSince: now, graceUntil: null }, effects: ["clock_in"], clearOverride };
    }
    if (phase.phase === "grace") {
      // 宽限中被手动拨回上班：撤销宽限，不再 pause。
      return { phase: { phase: "on", phaseSince: now, graceUntil: null }, effects: [], clearOverride };
    }
    return { phase, effects: [], clearOverride };
  }

  // desired === "off"
  if (phase.phase === "on") {
    if (active?.mode === "off") {
      // 手动下班：立即落盘，没有宽限（验收 2「立即生效」）。
      return { phase: { phase: "off", phaseSince: now, graceUntil: null }, effects: ["pause_runs"], clearOverride };
    }
    const window = dayWindow(schedule, now);
    const graceUntil = window ? window.endMs + schedule.graceSeconds * 1000 : now;
    if (schedule.graceSeconds > 0 && graceUntil > now) {
      return { phase: { phase: "grace", phaseSince: now, graceUntil }, effects: ["begin_grace"], clearOverride };
    }
    // 宽限为 0，或发现时宽限已过期：诚实直接 pause，不补假宽限。
    return { phase: { phase: "off", phaseSince: now, graceUntil: null }, effects: ["pause_runs"], clearOverride };
  }

  if (phase.phase === "grace") {
    // 宽限只在「现在确实下班了」时才会到期落盘；班表反悔（改回上班）走 desired===on 分支。
    if (!scheduleNow) {
      if (phase.graceUntil !== null && now >= phase.graceUntil) {
        return { phase: { phase: "off", phaseSince: now, graceUntil: null }, effects: ["pause_runs"], clearOverride };
      }
      return { phase, effects: [], clearOverride };
    }
    return { phase, effects: [], clearOverride };
  }

  // off：无事可做（上班转移在上面）
  return { phase, effects: [], clearOverride };
}
