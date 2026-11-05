import assert from "node:assert/strict";
import { test } from "node:test";

import { isNodeVersionSupported } from "../spike/lib/versions.mjs";

test("Node 22.19.0 is the minimum supported version", () => {
  assert.equal(isNodeVersionSupported("22.18.9"), false);
  assert.equal(isNodeVersionSupported("22.19.0"), true);
  assert.equal(isNodeVersionSupported("22.20.0"), true);
  assert.equal(isNodeVersionSupported("24.22.1"), true);
  assert.equal(isNodeVersionSupported("20.0.0"), false);
});

test("prereleases of the minimum version do not silently pass", () => {
  assert.equal(isNodeVersionSupported("22.19.0-rc.1"), false);
});

test("malformed versions are rejected", () => {
  assert.equal(isNodeVersionSupported(""), false);
  assert.equal(isNodeVersionSupported("v22.19.0"), false);
  assert.equal(isNodeVersionSupported("22.19"), false);
});
