import assert from "node:assert/strict";
import { test } from "node:test";

import { MAIN_ONLY_METHODS, RENDERER_METHODS } from "../src/shared/ipc-methods.mjs";

test("renderer allow-list covers the UI verbs but never the lifecycle doors", () => {
  for (const method of ["office.get", "run.start", "task.create", "task.detail", "schedule.get", "duty.override", "academy.snapshot", "academy.install", "academy.dispatch"]) {
    assert.ok(RENDERER_METHODS.has(method), `${method} must stay reachable from the view`);
  }
  for (const forbidden of ["host.shutdown", "host.pauseAll", "host.awaitQuiet"]) {
    assert.equal(RENDERER_METHODS.has(forbidden), false, `${forbidden} is main-process only`);
  }
});

test("main-only and renderer methods never overlap", () => {
  for (const method of MAIN_ONLY_METHODS) {
    assert.equal(RENDERER_METHODS.has(method), false, `${method} appears in both lists`);
  }
});
