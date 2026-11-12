/**
 * Idle motion — the desk's clock-driven posture layer (ticket 07 + 17).
 *
 * An occupied desk goes through one of three random slack states after 9s of
 * no live run:
 *   - phone:      seated, phone in hand;
 *   - minesweeper: seated, clicking at the computer;
 *   - coffee:     walk to the machine, stay 5s, walk back, then sip at the desk.
 *
 * Coffee is split into explicit phases so the 3D layer can animate the walk
 * and the monitor can stay on the Windows desktop throughout. The module is
 * pure over an injected clock and RNG; the view ticks it, tests fake both.
 *
 * @typedef {"idle" | "work" | "phone" | "minesweeper" | "coffee"} DeskPosture
 * @typedef {"desk" | "away"} DeskPosition
 * @typedef {"to-machine" | "at-machine" | "returning" | "sipping"} CoffeePhase
 * @typedef {object} IdleMotionState
 * @property {DeskPosture} posture
 * @property {DeskPosition} position
 * @property {number} anchor        start of the current idle rest / posture
 * @property {CoffeePhase | null} coffeePhase
 * @property {number | null} phaseStartedAt
 *
 * @typedef {object} IdleThresholds
 * @property {number} slackAtMs
 * @property {number} phoneMs
 * @property {number} minesweeperMs
 * @property {number} coffeeWalkMs
 * @property {number} coffeeMachineMs
 * @property {number} coffeeSipMs
 */

/** The ticket's numbers, in one reviewable row. */
export const IDLE_THRESHOLDS = {
  slackAtMs: 9_000,
  phoneMs: 12_000,
  minesweeperMs: 12_000,
  // 5s at the machine is the explicit user requirement; the walk legs and the
  // seated coffee beat are the animation budget around it.
  coffeeWalkMs: 2_500,
  coffeeMachineMs: 5_000,
  coffeeSipMs: 10_000,
};

/** @param {number} now @returns {IdleMotionState} */
export function initialMotion(now) {
  return { posture: "idle", position: "desk", anchor: now, coffeePhase: null, phaseStartedAt: null };
}

/** @param {number} now @returns {IdleMotionState} */
function idleAt(now) {
  return initialMotion(now);
}

/**
 * @param {number} [randomValue] 0 <= value < 1
 * @returns {"phone" | "minesweeper" | "coffee"}
 */
export function pickSlackKind(randomValue = Math.random()) {
  if (randomValue < 1 / 3) return "phone";
  if (randomValue < 2 / 3) return "minesweeper";
  return "coffee";
}

/**
 * A run started (session_start): the employee is at the desk working —
 * even mid-coffee-trip they come straight back. Freezes idle timers.
 *
 * @param {IdleMotionState} state @param {number} now @returns {IdleMotionState}
 */
export function motionOnWork(state, now) {
  if (state.posture === "work" && state.position === "desk") return state;
  return { posture: "work", position: "desk", anchor: now, coffeePhase: null, phaseStartedAt: null };
}

/**
 * The run ended (agent_end): idle time restarts from this moment.
 *
 * @param {IdleMotionState} state @param {number} now @returns {IdleMotionState}
 */
export function motionOnRelease(state, now) {
  return idleAt(now);
}

/**
 * Clock tick (idempotent at a given instant).
 *
 * @param {IdleMotionState} state
 * @param {number} now
 * @param {IdleThresholds} [thresholds]
 * @param {() => number} [random]
 * @returns {IdleMotionState}
 */
export function advanceMotion(state, now, thresholds = IDLE_THRESHOLDS, random = Math.random) {
  switch (state.posture) {
    case "work":
      return state;

    case "phone":
    case "minesweeper": {
      const started = state.phaseStartedAt ?? state.anchor;
      const duration = state.posture === "phone" ? thresholds.phoneMs : thresholds.minesweeperMs;
      if (now - started < duration) return state;
      return idleAt(now);
    }

    case "coffee": {
      const phase = state.coffeePhase ?? "to-machine";
      const started = state.phaseStartedAt ?? state.anchor;
      const elapsed = now - started;
      switch (phase) {
        case "to-machine":
          if (elapsed < thresholds.coffeeWalkMs) return state;
          return { ...state, coffeePhase: "at-machine", phaseStartedAt: now };
        case "at-machine":
          if (elapsed < thresholds.coffeeMachineMs) return state;
          return { ...state, coffeePhase: "returning", phaseStartedAt: now };
        case "returning":
          if (elapsed < thresholds.coffeeWalkMs) return state;
          return { ...state, coffeePhase: "sipping", phaseStartedAt: now, position: "desk" };
        case "sipping":
          if (elapsed < thresholds.coffeeSipMs) return state;
          return idleAt(now);
        default:
          return state;
      }
    }

    case "idle": {
      const idleFor = now - state.anchor;
      if (idleFor < thresholds.slackAtMs) return state;
      const kind = pickSlackKind(random());
      if (kind === "coffee") {
        return {
          posture: "coffee",
          position: "away",
          anchor: now,
          coffeePhase: "to-machine",
          phaseStartedAt: now,
        };
      }
      return { posture: kind, position: "desk", anchor: now, coffeePhase: null, phaseStartedAt: now };
    }

    default:
      return state;
  }
}
