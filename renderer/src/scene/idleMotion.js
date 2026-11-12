/**
 * Idle motion — the desk's clock-driven posture layer (ticket 07 + 17 + 18).
 *
 * An occupied desk goes through one of four random breaks after 9s of no
 * live run:
 *   - phone:       seated, phone in hand;
 *   - minesweeper: seated, clicking at the computer;
 *   - coffee:      walk to the espresso bar, stay 5s, walk back, sip at the desk;
 *   - water:       the same trip to the water cooler, returning with a bottle.
 *
 * Every trip is split into explicit phases so the 3D layer can interpolate the
 * walk along the aisle route while the monitor stays on the Windows desktop.
 * The module is pure over an injected clock, RNG and walk-time function; the
 * view ticks it, tests fake all three.
 *
 * @typedef {"idle" | "work" | "phone" | "minesweeper" | "coffee" | "water"} DeskPosture
 * @typedef {"desk" | "away"} DeskPosition
 * @typedef {"coffee" | "water"} TripTarget
 * @typedef {"to-target" | "at-target" | "returning" | "sipping"} TripPhase
 * @typedef {object} IdleMotionState
 * @property {DeskPosture} posture
 * @property {DeskPosition} position
 * @property {TripTarget | null} destination
 * @property {TripPhase | null} tripPhase
 * @property {number} anchor        start of the current idle rest / posture
 * @property {number | null} phaseStartedAt
 *
 * @typedef {object} IdleThresholds
 * @property {number} slackAtMs
 * @property {number} phoneMs
 * @property {number} minesweeperMs
 * @property {number} dwellMs
 * @property {number} sipMs
 * @property {number} walkMs         fallback when no route is supplied
 */

/** The ticket's numbers, in one reviewable row (durations in ms). */
export const IDLE_THRESHOLDS = {
  slackAtMs: 9_000,
  phoneMs: 12_000,
  minesweeperMs: 12_000,
  // 5s at the machine is the explicit user requirement; the walk legs and the
  // seated break are the animation budget around it.
  dwellMs: 5_000,
  sipMs: 10_000,
  walkMs: 2_500,
};

/** @param {number} now @returns {IdleMotionState} */
export function initialMotion(now) {
  return {
    posture: "idle",
    position: "desk",
    destination: null,
    tripPhase: null,
    anchor: now,
    phaseStartedAt: null,
  };
}

/** @param {number} now @returns {IdleMotionState} */
function idleAt(now) {
  return initialMotion(now);
}

/**
 * Even buckets: phone / minesweeper / coffee / water.
 *
 * @param {number} [randomValue] 0 <= value < 1
 * @returns {"phone" | "minesweeper" | "coffee" | "water"}
 */
export function pickSlackKind(randomValue = Math.random()) {
  if (randomValue < 0.25) return "phone";
  if (randomValue < 0.5) return "minesweeper";
  if (randomValue < 0.75) return "coffee";
  return "water";
}

/**
 * A run started (session_start): the employee is at the desk working —
 * even mid-trip they come straight back. Freezes idle timers.
 *
 * @param {IdleMotionState} state @param {number} now @returns {IdleMotionState}
 */
export function motionOnWork(state, now) {
  if (state.posture === "work" && state.position === "desk") return state;
  return { posture: "work", position: "desk", destination: null, tripPhase: null, anchor: now, phaseStartedAt: null };
}

/**
 * The run ended (agent_end): idle time restarts from this moment.
 *
 * @param {IdleMotionState} state @param {number} now @returns {IdleMotionState}
 */
export function motionOnRelease(state, now) {
  return idleAt(now);
}

/** @param {DeskPosture} posture @returns {boolean} */
export function isTripPosture(posture) {
  return posture === "coffee" || posture === "water";
}

/**
 * Clock tick (idempotent at a given instant).
 *
 * @param {IdleMotionState} state
 * @param {number} now
 * @param {IdleThresholds} [thresholds]
 * @param {() => number} [random]
 * @param {(target: TripTarget) => number} [walkMsFor] per-destination walk time
 * @returns {IdleMotionState}
 */
export function advanceMotion(state, now, thresholds = IDLE_THRESHOLDS, random = Math.random, walkMsFor) {
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

    case "coffee":
    case "water": {
      const phase = state.tripPhase ?? "to-target";
      const started = state.phaseStartedAt ?? state.anchor;
      const elapsed = now - started;
      const target = state.destination ?? (state.posture === "water" ? "water" : "coffee");
      const walkMs = walkMsFor ? walkMsFor(target) : thresholds.walkMs;
      switch (phase) {
        case "to-target":
          if (elapsed < walkMs) return state;
          return { ...state, tripPhase: "at-target", phaseStartedAt: now };
        case "at-target":
          if (elapsed < thresholds.dwellMs) return state;
          return { ...state, tripPhase: "returning", phaseStartedAt: now };
        case "returning":
          if (elapsed < walkMs) return state;
          return { ...state, tripPhase: "sipping", phaseStartedAt: now, position: "desk" };
        case "sipping":
          if (elapsed < thresholds.sipMs) return state;
          return idleAt(now);
        default:
          return state;
      }
    }

    case "idle": {
      const idleFor = now - state.anchor;
      if (idleFor < thresholds.slackAtMs) return state;
      const kind = pickSlackKind(random());
      if (kind === "coffee" || kind === "water") {
        return {
          posture: kind,
          position: "away",
          destination: kind,
          tripPhase: "to-target",
          anchor: now,
          phaseStartedAt: now,
        };
      }
      return {
        posture: kind,
        position: "desk",
        destination: null,
        tripPhase: null,
        anchor: now,
        phaseStartedAt: now,
      };
    }

    default:
      return state;
  }
}
