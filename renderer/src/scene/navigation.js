/**
 * Office navigation — where people sit, stand and walk.
 *
 * Ticket 18: the old coffee walk went straight from a chair to the machine,
 * cutting through desks and chairs. This module owns the room's walkable
 * aisle graph so every trip is a polyline down the aisles, and it is pure so
 * the "never walks through a desk" promise is a unit test, not a screenshot.
 *
 * Coordinates are metres, matching scripts/blender/office-scene.py: x right,
 * z toward the camera, the floor at y = 0. A seated employee faces -z (the
 * monitor); their back is +z.
 *
 * @typedef {{ x: number, z: number }} Point
 * @typedef {"coffee" | "water"} TripTarget
 * @typedef {{ points: Point[], length: number, facing: number }} WalkRoute
 */

/** The eight bays, back row first (mirrors the DB desk order and office.glb). */
export const DESK_LAYOUT = [
  { x: -3.45, z: 1.55 },
  { x: -1.15, z: 1.55 },
  { x: 1.15, z: 1.55 },
  { x: 3.45, z: 1.55 },
  { x: -3.45, z: 3.45 },
  { x: -1.15, z: 3.45 },
  { x: 1.15, z: 3.45 },
  { x: 3.45, z: 3.45 },
];

/**
 * Room measurements taken from the Blender scene. Chairs sit behind a desk
 * (z + 0.38 … z + 0.81); the aisles run behind each row's chairs.
 */
export const ROOM = {
  /** Desk top half-width / half-depth (a 1.55 × 0.85 desk). */
  deskHalfWidth: 0.78,
  deskHalfDepth: 0.43,
  /** Where the chair meets the floor — the walking origin is just behind it. */
  chairZ: 0.62,
  chairClearZ: 0.86,
  /** Aisle behind the back row / in front of the front row. */
  middleAisleZ: 2.7,
  frontAisleZ: 4.55,
  /** Corridors between desk columns (the 0.75 m gaps). */
  corridorsX: [-2.3, 0, 2.3],
  /** Left aisle between the wall and the left desk column. */
  leftAisleX: -4.95,
  /** Standing spot in front of the espresso bar, facing -x. */
  coffeeStand: { x: -3.42, z: 4.95, facing: Math.PI / 2 },
  /** Standing spot in front of the water cooler, facing -z. */
  waterStand: { x: -4.28, z: 2.7, facing: 0 },
  /** Walking speed and the clamp that keeps a trip readable. */
  walkSpeed: 1.55,
  walkMinMs: 1_300,
  walkMaxMs: 3_600,
  /** Seconds spent at the machine / cooler before turning back. */
  dwellMs: 5_000,
  sipMs: 10_000,
};

/** @param {number} index @returns {"front" | "back"} */
export function rowOfDesk(index) {
  return index >= 4 ? "front" : "back";
}

/** @param {number} x @returns {number} */
function nearestCorridor(x) {
  let best = ROOM.corridorsX[0];
  for (const candidate of ROOM.corridorsX) {
    if (Math.abs(candidate - x) < Math.abs(best - x)) best = candidate;
  }
  return best;
}

/** @param {number} x @returns {number} */
export function nearestCorridorProbe(x) {
  return nearestCorridor(x);
}

/** @param {Point[]} points @returns {number} */
function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

/** @param {Point[]} points @returns {Point[]} */
function simplify(points) {
  /** @type {Point[]} */
  const out = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.z - point.z) < 1e-6) continue;
    out.push(point);
  }
  return out;
}

/**
 * The walk from a desk to a break destination. Always: leave the chair,
 * reach the row's aisle, follow the aisles (crossing a row only through a
 * column gap), then step into the standing spot.
 *
 * @param {number} deskIndex
 * @param {TripTarget} target
 * @returns {WalkRoute}
 */
export function walkRouteFor(deskIndex, target) {
  const desk = DESK_LAYOUT[deskIndex] ?? DESK_LAYOUT[0];
  const row = rowOfDesk(deskIndex);
  const stand = target === "coffee" ? ROOM.coffeeStand : ROOM.waterStand;
  const seatExitZ = desk.z + ROOM.chairClearZ;
  const rowAisleZ = row === "back" ? ROOM.middleAisleZ : ROOM.frontAisleZ;
  /** @type {Point[]} */
  const points = [
    { x: desk.x, z: desk.z + ROOM.chairZ },
    { x: desk.x, z: seatExitZ },
    { x: desk.x, z: rowAisleZ },
  ];

  if (target === "coffee") {
    if (row === "back") {
      const corridorX = nearestCorridor(desk.x);
      points.push({ x: corridorX, z: rowAisleZ });
      points.push({ x: corridorX, z: ROOM.frontAisleZ });
      points.push({ x: stand.x, z: ROOM.frontAisleZ });
    } else {
      points.push({ x: stand.x, z: ROOM.frontAisleZ });
    }
    points.push({ x: stand.x, z: stand.z });
  } else if (row === "back") {
    // Straight down the middle aisle to the cooler, no row crossing needed.
    points.push({ x: stand.x, z: rowAisleZ });
    points.push({ x: stand.x, z: stand.z });
  } else {
    const corridorX = nearestCorridor(desk.x);
    points.push({ x: corridorX, z: ROOM.frontAisleZ });
    points.push({ x: corridorX, z: ROOM.middleAisleZ });
    points.push({ x: stand.x, z: ROOM.middleAisleZ });
    points.push({ x: stand.x, z: stand.z });
  }

  const simplified = simplify(points);
  return {
    points: simplified,
    length: polylineLength(simplified),
    facing: stand.facing,
  };
}

/**
 * How long the walk takes: a real walking speed, clamped so a far bay does
 * not spend a minute in the aisle and a near one does not teleport.
 *
 * @param {number} deskIndex
 * @param {TripTarget} target
 * @returns {number}
 */
export function walkDurationMs(deskIndex, target) {
  const route = walkRouteFor(deskIndex, target);
  const raw = (route.length / ROOM.walkSpeed) * 1000;
  return Math.round(Math.min(ROOM.walkMaxMs, Math.max(ROOM.walkMinMs, raw)));
}

/**
 * Position and heading along a route at `t` (0..1 by arc length). Used both
 * for the outbound leg (t 0→1) and the return (t 1→0).
 *
 * @param {WalkRoute} route
 * @param {number} t
 * @returns {{ x: number, z: number, facing: number }}
 */
export function pointAlongRoute(route, t) {
  const points = route.points;
  if (points.length === 0) return { x: 0, z: 0, facing: 0 };
  if (points.length === 1) return { x: points[0].x, z: points[0].z, facing: 0 };
  const clamped = Math.min(1, Math.max(0, t));
  const wanted = route.length * clamped;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const segment = Math.hypot(to.x - from.x, to.z - from.z);
    if (segment <= 1e-6) continue;
    if (walked + segment >= wanted || i === points.length - 1) {
      const local = Math.min(1, Math.max(0, (wanted - walked) / segment));
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      return {
        x: from.x + dx * local,
        z: from.z + dz * local,
        // The rig faces -z at yaw 0; atan2(-dx, -dz) turns it down the path.
        facing: Math.atan2(-dx, -dz),
      };
    }
    walked += segment;
  }
  const last = points[points.length - 1];
  return { x: last.x, z: last.z, facing: 0 };
}

/**
 * True when a point sits inside a desk's solid footprint (its top projected
 * down). The route never crosses one, so this stays false on every sampled
 * step of every trip — that is the "nobody walks over a workstation" promise.
 *
 * @param {Point} point
 * @param {number} [padding]
 * @returns {boolean}
 */
export function insideDeskFootprint(point, padding = 0) {
  return DESK_LAYOUT.some(
    (desk) =>
      Math.abs(point.x - desk.x) <= ROOM.deskHalfWidth + padding &&
      Math.abs(point.z - desk.z) <= ROOM.deskHalfDepth + padding,
  );
}

/**
 * True when a point sits inside a desk's chair (the seat + backrest block).
 *
 * @param {Point} point
 * @param {number} deskIndex
 * @param {number} [padding]
 * @returns {boolean}
 */
export function insideChair(point, deskIndex, padding = 0) {
  const desk = DESK_LAYOUT[deskIndex] ?? DESK_LAYOUT[0];
  return (
    Math.abs(point.x - desk.x) <= 0.29 + padding &&
    point.z >= desk.z + 0.30 - padding &&
    point.z <= desk.z + 0.90 + padding
  );
}

/**
 * Sample a route into points so tests can check the whole path, not just the
 * waypoints (a straight segment between two waypoints can still cut a corner).
 *
 * @param {WalkRoute} route
 * @param {number} [steps]
 * @returns {Point[]}
 */
export function sampleRoute(route, steps = 60) {
  /** @type {Point[]} */
  const samples = [];
  for (let i = 0; i <= steps; i += 1) {
    const { x, z } = pointAlongRoute(route, i / steps);
    samples.push({ x, z });
  }
  return samples;
}
