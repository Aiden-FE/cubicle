/**
 * Idle motion — the desk's clock-driven posture layer (ticket 07).
 *
 * The one animation the calendar is allowed to drive: a工位 with no live
 * run 闲了 9 秒 starts 摸鱼; 闲满 45 秒 gets up 去倒咖啡 and comes 回工位.
 * Everything else about the desk (busy, screen, 拒绝) is engine-event driven
 * (deskActivity.js) — this module only ever runs while nothing is running,
 * and any engine work event yanks the person back to the desk.
 *
 * Pure over an injected clock: the view ticks it, tests fake it.
 *
 * @typedef {"idle" | "slack" | "coffee" | "work"} DeskPosture
 * @typedef {"desk" | "away"} DeskPosition
 * @typedef {{ posture: DeskPosture, position: DeskPosition, anchor: number }} IdleMotionState
 * @typedef {{ slackAtMs: number, coffeeAtMs: number, coffeeReturnMs: number }} IdleThresholds
 */

/** The ticket's numbers, in one reviewable row. */
export const IDLE_THRESHOLDS = {
  slackAtMs: 9_000,
  coffeeAtMs: 45_000,
  // 倒咖啡是一趟脚程，不是一去不回：多久走回工位
  coffeeReturnMs: 12_000,
};

/** @param {number} now @returns {IdleMotionState} */
export function initialMotion(now) {
  return { posture: "idle", position: "desk", anchor: now };
}

/**
 * A run started (session_start): the employee is at the desk working —
 * even mid-coffee-trip they come straight back. Freezes idle timers.
 *
 * @param {IdleMotionState} state @param {number} now @returns {IdleMotionState}
 */
export function motionOnWork(state, now) {
  if (state.posture === "work" && state.position === "desk") return state;
  return { posture: "work", position: "desk", anchor: now };
}

/**
 * The run ended (agent_end): idle time restarts from this moment.
 *
 * @param {IdleMotionState} state @param {number} now @returns {IdleMotionState}
 */
export function motionOnRelease(state, now) {
  return { posture: "idle", position: "desk", anchor: now };
}

/**
 * Clock tick (idempotent at a given instant).
 *
 * @param {IdleMotionState} state
 * @param {number} now
 * @param {IdleThresholds} [thresholds]
 * @returns {IdleMotionState}
 */
export function advanceMotion(state, now, thresholds = IDLE_THRESHOLDS) {
  switch (state.posture) {
    case "work":
      return state;

    case "coffee": {
      if (now - state.anchor < thresholds.coffeeReturnMs) return state;
      // 回到工位：一个新的空闲周期从归位这一刻起算
      return { posture: "idle", position: "desk", anchor: now };
    }

    case "idle":
    case "slack": {
      const idleFor = now - state.anchor;
      if (idleFor >= thresholds.coffeeAtMs) return { posture: "coffee", position: "away", anchor: now };
      if (idleFor >= thresholds.slackAtMs) return state.posture === "slack" ? state : { ...state, posture: "slack" };
      return state;
    }

    default:
      return state;
  }
}
