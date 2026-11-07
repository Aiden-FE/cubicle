/**
 * Desk readout — what the workstation shows, split by preference-proofness
 * (ticket 07: 名牌与气泡可开关；关掉后仍能看出「在忙/在闲」).
 *
 * deskSignals() is the ALWAYS-ON layer: the status light and the busy flag
 * read from state only — the nameplate/bubble preference cannot reach this
 * function, so "busy or idle" survives every toggle by construction.
 * bubbleTextFor() is the switchable text layer.
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
        : motion.posture === "slack"
          ? "slack"
          : "idle";
  return { busy: activity.working, light };
}

/**
 * The switchable 气泡 text — human words for the same state, null means
 * "no bubble" (a normally-seated idle desk has nothing to say).
 *
 * @param {DeskActivityState} activity
 * @param {IdleMotionState} motion
 * @returns {string | null}
 */
export function bubbleTextFor(activity, motion) {
  if (activity.blocked !== null) return "被策略拦下";
  if (activity.working) {
    if (activity.activity === "test" && activity.screenTone === "pass") return "测试通过了";
    if (activity.activity === "test" && activity.screenTone === "fail") return "测试挂了";
    switch (activity.activity) {
      case "read":
        return "在看资料";
      case "write":
        return "在写东西";
      case "exec":
        return "在跑命令";
      case "test":
        return "在跑测试";
      case "work":
        return "在干活";
      default:
        return "在想事情";
    }
  }
  if (motion.posture === "slack") return "摸鱼中…";
  if (motion.posture === "coffee") return "去倒咖啡了";
  return null;
}
