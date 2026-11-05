import test from "node:test";
import assert from "node:assert/strict";

import {
  createInvoke,
  createReply,
  createErrorReply,
  createEvent,
  parseEnvelope,
} from "../src/shared/envelope.mjs";

test("invoke envelope carries version, id, method, payload and timestamp", () => {
  const env = createInvoke("req-1", "office.get", { groupId: 2 });
  assert.equal(env.v, 1);
  assert.equal(env.kind, "invoke");
  assert.equal(env.id, "req-1");
  assert.equal(env.method, "office.get");
  assert.deepEqual(env.payload, { groupId: 2 });
  assert.equal(typeof env.ts, "number");
});

test("reply envelope reuses the request id and marks success", () => {
  const req = createInvoke("req-2", "company.create", { name: "远岸软件" });
  const reply = createReply(req, { id: 7, name: "远岸软件" });
  assert.equal(reply.kind, "reply");
  assert.equal(reply.id, "req-2");
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.payload, { id: 7, name: "远岸软件" });
});

test("error reply reuses the request id and carries code and message", () => {
  const req = createInvoke("req-3", "company.create", {});
  const reply = createErrorReply(req, { code: "invalid_payload", message: "name is required" });
  assert.equal(reply.kind, "reply");
  assert.equal(reply.id, "req-3");
  assert.equal(reply.ok, false);
  assert.deepEqual(reply.error, { code: "invalid_payload", message: "name is required" });
});

test("event envelope has a topic, an auto id and a payload", () => {
  const event = createEvent("domain.changed", { reason: "company.create" });
  assert.equal(event.v, 1);
  assert.equal(event.kind, "event");
  assert.equal(event.topic, "domain.changed");
  assert.deepEqual(event.payload, { reason: "company.create" });
  assert.equal(typeof event.id, "string");
  assert.ok(event.id.length > 0);
});

test("parseEnvelope round-trips every envelope it builds", () => {
  const invoke = createInvoke("req-4", "office.get", {});
  const reply = createReply(invoke, { desks: 4 });
  const failure = createErrorReply(invoke, { code: "unknown_method", message: "nope" });
  const event = createEvent("host.status", { state: "online" });
  for (const env of [invoke, reply, failure, event]) {
    const wire = JSON.parse(JSON.stringify(env));
    assert.deepEqual(parseEnvelope(wire), wire);
  }
});

test("parseEnvelope rejects non-envelopes", () => {
  const bad = [
    null,
    undefined,
    "office.get",
    42,
    [],
    {},
    { v: 2, kind: "invoke", id: "x", method: "m" },
    { v: 1, kind: "shout", id: "x", method: "m" },
    { v: 1, kind: "invoke", method: "m" },
    { v: 1, kind: "invoke", id: "x" },
    { v: 1, kind: "event", id: "x" },
    { v: 1, kind: "reply", id: "x" },
  ];
  for (const value of bad) {
    assert.equal(parseEnvelope(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

test("parseEnvelope accepts a reply without payload when ok", () => {
  const wire = { v: 1, kind: "reply", id: "x", ok: true, ts: 1 };
  const parsed = parseEnvelope(wire);
  assert.ok(parsed && parsed.kind === "reply");
  assert.equal(parsed.ok, true);
});
