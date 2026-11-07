/**
 * Desk activity — one employee's workstation state, folded from the
 * normalized engine event stream (ticket 07: 状态必须由真实引擎事件驱动).
 *
 * This is the scene's source of truth: no timers invent "busyness" here. The
 * ONLY things that make a desk busy are session_start/agent_end; the ONLY
 * things that switch the screen are tool events; the ONLY thing that raises
 * the 拒绝 marker is the host's policy_blocked event. The idle posture
 * (摸鱼/咖啡) lives in idleMotion.js and is allowed to run on the clock.
 */

import { activityForTool } from "./toolActivity.js";

/**
 * @typedef {import("./toolActivity.js").DeskActivityKind} DeskActivityKind
 * @typedef {import("../../../src/host/engine/events.mjs").NormalizedEvent} NormalizedEvent
 *
 * @typedef {object} DeskActivityState
 * @property {boolean} working                        在忙（run 进行中）
 * @property {DeskActivityKind | null} activity       屏幕画面模式（当前/最近一次工具）
 * @property {"pass" | "fail" | null} screenTone      测试结果：绿 / 红
 * @property {DeskBlocked | null} blocked             策略拒绝的可见提示（不静默）
 * @property {Record<string, DeskActivityKind>} running in-flight tool calls (id → kind)
 *
 * @typedef {{ toolName: string, rule: string, reason: string, at: number }} DeskBlocked
 */

/** How long a 拒绝 marker rides on after its event (then fades, but never silently mid-run). */
export const DESK_BLOCKED_TTL_MS = 15_000;

/** @returns {DeskActivityState} */
export function initialDeskActivity() {
  return { working: false, activity: null, screenTone: null, blocked: null, running: {} };
}

/**
 * Fold one normalized engine event into the desk state. Pure: the caller
 * supplies the clock (tests inject it, the app passes Date.now()).
 *
 * @param {DeskActivityState} state
 * @param {NormalizedEvent} event
 * @param {number} [now]
 * @returns {DeskActivityState}
 */
export function reduceDeskActivity(state, event, now = Date.now()) {
  switch (event?.type) {
    case "session_start":
      return { ...state, working: true, activity: null, screenTone: null, blocked: null, running: {} };

    case "tool_execution_start": {
      const kind = activityForTool(event.toolName, event.args);
      return {
        ...state,
        working: true,
        activity: kind,
        screenTone: null,
        running: { ...state.running, [callIdOf(event)]: kind },
      };
    }

    case "tool_execution_end": {
      const id = callIdOf(event);
      const kind = state.running[id] ?? null;
      const { [id]: _gone, ...rest } = state.running;
      const next = { ...state, running: rest };
      if (kind === "test") {
        // 票面：测试失败屏幕变红、通过变绿 — the screen tone rides until the
        // next tool or the run end; a fresh activity switches back to neutral.
        next.screenTone = event.isError === true ? "fail" : "pass";
      }
      return next;
    }

    case "policy_blocked":
      return {
        ...state,
        blocked: {
          toolName: String(event.toolName ?? "unknown"),
          rule: String(event.rule ?? "policy"),
          reason: String(event.reason ?? "这次操作被策略拦下"),
          at: now,
        },
      };

    case "error":
      return { ...state, screenTone: "fail" };

    case "agent_end": {
      // Home time: the run's screen goes dark; an unresolved 拒绝 stays up
      // until it expires or the next run clears it (不静默).
      return { ...state, working: false, activity: null, screenTone: null, running: {} };
    }

    default:
      // text/thinking deltas, turn boundaries, unknowns: the person is busy
      // (session_start said so) but no new workstation posture — never
      // fabricate one from the calendar.
      return state;
  }
}

/**
 * Fade an expired 拒绝 marker (called from the view's idle tick, not the
 * event path — so a quiet desk still clears its marker).
 *
 * @param {DeskActivityState} state
 * @param {number} now
 * @param {number} [ttlMs]
 * @returns {DeskActivityState}
 */
export function expireDeskBlocked(state, now, ttlMs = DESK_BLOCKED_TTL_MS) {
  if (state.blocked === null || now - state.blocked.at < ttlMs) return state;
  return { ...state, blocked: null };
}

/** @param {{ toolCallId?: unknown }} event @returns {string} */
function callIdOf(event) {
  return String(event?.toolCallId ?? "unknown");
}
