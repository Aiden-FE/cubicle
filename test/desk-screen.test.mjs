import assert from "node:assert/strict";
import { test } from "node:test";

import { screenForDesk } from "../renderer/src/scene/deskScreen.js";

const programmer = { roleSnapshot: { key: "programmer" } };
const pm = { roleSnapshot: { key: "pm" } };

/** @param {string | null} activity @param {string | null} tone */
const running = (activity, tone = null) => /** @type {any} */ ({ working: true, activity, screenTone: tone });
const idle = /** @type {any} */ ({ working: false, activity: null, screenTone: null });

test("empty desks and off-duty companies get a black screen", () => {
  assert.equal(screenForDesk({ occupant: null, activity: idle }).kind, "black");
  assert.equal(screenForDesk({ occupant: null, offDuty: true, activity: running("write") }).kind, "black");
  assert.equal(screenForDesk({ occupant: programmer, offDuty: true, activity: running("write") }).kind, "black");
});

test("occupied but not running shows the Windows desktop — including all slack states", () => {
  assert.equal(screenForDesk({ occupant: programmer, activity: idle }).kind, "desktop");
  // screenForDesk is posture-agnostic: phone/minesweeper/coffee all still show desktop.
  assert.equal(screenForDesk({ occupant: programmer, activity: idle }).kind, "desktop");
});

test("programmer work maps to code, shell to terminal, tests to test states", () => {
  assert.equal(screenForDesk({ occupant: programmer, activity: running("read") }).kind, "code");
  assert.equal(screenForDesk({ occupant: programmer, activity: running("write") }).kind, "code");
  assert.equal(screenForDesk({ occupant: programmer, activity: running("work") }).kind, "code");
  assert.equal(screenForDesk({ occupant: programmer, activity: running(null) }).kind, "code");
  assert.equal(screenForDesk({ occupant: programmer, activity: running("exec") }).kind, "terminal");
  assert.equal(screenForDesk({ occupant: programmer, activity: running("test") }).kind, "test");
  assert.equal(screenForDesk({ occupant: programmer, activity: running("test", "pass") }).kind, "test-pass");
  assert.equal(screenForDesk({ occupant: programmer, activity: running("test", "fail") }).kind, "test-fail");
});

test("pm work maps to the office app; shell/tests keep their own surfaces", () => {
  assert.equal(screenForDesk({ occupant: pm, activity: running("write") }).kind, "office");
  assert.equal(screenForDesk({ occupant: pm, activity: running("read") }).kind, "office");
  assert.equal(screenForDesk({ occupant: pm, activity: running("work") }).kind, "office");
  assert.equal(screenForDesk({ occupant: pm, activity: running("exec") }).kind, "terminal");
  assert.equal(screenForDesk({ occupant: pm, activity: running("test", "pass") }).kind, "test-pass");
});
