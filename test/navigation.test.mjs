import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DESK_LAYOUT,
  ROOM,
  insideChair,
  insideDeskFootprint,
  nearestCorridorProbe,
  pointAlongRoute,
  sampleRoute,
  walkDurationMs,
  walkRouteFor,
} from "../renderer/src/scene/navigation.js";

// Ticket 18: 员工去咖啡机/饮水机要走走道，不能穿工位。
// The aisle graph is pure, so this is a geometric proof rather than a
// screenshot: every sampled step of every route is outside every desk and
// every chair that is not the one the employee just stood up from.

const TARGETS = /** @type {const} */ (["coffee", "water"]);

test("every bay reaches both break spots", () => {
  for (let index = 0; index < DESK_LAYOUT.length; index += 1) {
    for (const target of TARGETS) {
      const route = walkRouteFor(index, target);
      assert.ok(route.points.length >= 3, `desk ${index} → ${target} has a route`);
      assert.ok(route.length > 0.5, `desk ${index} → ${target} is a real walk`);
      const end = route.points[route.points.length - 1];
      const stand = target === "coffee" ? ROOM.coffeeStand : ROOM.waterStand;
      assert.equal(end.x, stand.x);
      assert.equal(end.z, stand.z);
    }
  }
});

test("no route crosses a desk top", () => {
  for (let index = 0; index < DESK_LAYOUT.length; index += 1) {
    for (const target of TARGETS) {
      const route = walkRouteFor(index, target);
      for (const point of sampleRoute(route, 120)) {
        assert.equal(
          insideDeskFootprint(point, -0.02),
          false,
          `desk ${index} → ${target} walks through a desk at ${JSON.stringify(point)}`,
        );
      }
    }
  }
});

test("no route walks through anyone else's chair", () => {
  for (let index = 0; index < DESK_LAYOUT.length; index += 1) {
    for (const target of TARGETS) {
      const route = walkRouteFor(index, target);
      for (const point of sampleRoute(route, 120)) {
        for (let other = 0; other < DESK_LAYOUT.length; other += 1) {
          if (other === index) continue;
          assert.equal(
            insideChair(point, other, -0.02),
            false,
            `desk ${index} → ${target} clips chair ${other} at ${JSON.stringify(point)}`,
          );
        }
      }
    }
  }
});

test("a row crossing happens through a column gap, never between desks", () => {
  // Back-row desks must pass a corridor to reach the front aisle.
  const backRoute = walkRouteFor(0, "coffee");
  const corridorX = backRoute.points.map((point) => point.x).find((x) => ROOM.corridorsX.includes(x));
  assert.equal(typeof corridorX, "number", "the route uses a corridor");
  if (corridorX === undefined) return;
  assert.equal(insideDeskFootprint({ x: corridorX, z: ROOM.middleAisleZ }, 0), false);
  assert.equal(insideDeskFootprint({ x: corridorX, z: ROOM.frontAisleZ }, 0), false);
});

test("the walk time scales with the route but stays readable", () => {
  for (let index = 0; index < DESK_LAYOUT.length; index += 1) {
    for (const target of TARGETS) {
      const ms = walkDurationMs(index, target);
      assert.ok(ms >= ROOM.walkMinMs && ms <= ROOM.walkMaxMs, `desk ${index} → ${target} = ${ms}ms`);
    }
  }
  const route = walkRouteFor(0, "coffee");
  const expected = Math.round((route.length / ROOM.walkSpeed) * 1000);
  assert.equal(walkDurationMs(0, "coffee"), Math.min(ROOM.walkMaxMs, Math.max(ROOM.walkMinMs, expected)));
});

test("pointAlongRoute walks the polyline and faces down the path", () => {
  const route = walkRouteFor(4, "coffee");
  const start = pointAlongRoute(route, 0);
  assert.equal(start.x, DESK_LAYOUT[4].x);
  assert.equal(start.z, DESK_LAYOUT[4].z + ROOM.chairZ);
  const end = pointAlongRoute(route, 1);
  assert.equal(end.x, ROOM.coffeeStand.x);
  assert.equal(end.z, ROOM.coffeeStand.z);
  // leaving the chair is a step backwards (+z): the rig must face +z there
  const leaving = pointAlongRoute(route, 0.02);
  assert.ok(Math.abs(leaving.facing) > Math.PI / 2, "faces the aisle behind the chair");

  // monotone progress along the route: distance from the start never shrinks
  let previous = -1;
  for (let i = 0; i <= 40; i += 1) {
    const point = pointAlongRoute(route, i / 40);
    const travelled = Math.hypot(point.x - start.x, point.z - start.z);
    assert.ok(travelled >= previous - 1e-6, "route progress never doubles back");
    previous = travelled;
  }
});

test("clamping keeps out-of-range t inside the route", () => {
  const route = walkRouteFor(0, "water");
  assert.deepEqual(pointAlongRoute(route, -3), pointAlongRoute(route, 0));
  assert.deepEqual(pointAlongRoute(route, 4), pointAlongRoute(route, 1));
});

test("nearestCorridorProbe is unused but exported for debugging", () => {
  assert.equal(nearestCorridorProbe(-2.1), -2.3);
  assert.equal(nearestCorridorProbe(0.2), 0);
});
