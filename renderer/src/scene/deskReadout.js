/**
 * Desk readout — what the workstation shows without naming the state
 * (ticket 07 + 17: 状态靠动作/屏幕，不靠状态文字).
 *
 * deskSignals() is the ALWAYS-ON layer: the status light and the busy flag
 * read from state only — no label or text can be switched on to explain it.
 *
 * @typedef {import("./deskActivity.js").DeskActivityState} DeskActivityState
 * @typedef {import("./idleMotion.js").IdleMotionState} IdleMotionState
 * @typedef {{ busy: boolean, light: "working" | "blocked" | "coffee" | "slack" | "idle" }} DeskSignals
 */

/**
 * Always-on signals (status light + busy flag). Preference cannot switch
 * these off — see the module header.
 *
 * @param {DeskActivityState} activity
 * @param {IdleMotionState} motion
 * @returns {DeskSignals}
 */
export function deskSignals(activity, motion) {
  const light = activity.working
    ? "working"
    : activity.blocked !== null
      ? "blocked"
      : motion.posture === "coffee"
        ? "coffee"
        : motion.posture === "phone" || motion.posture === "minesweeper"
          ? "slack"
          : "idle";
  return { busy: activity.working, light };
}
