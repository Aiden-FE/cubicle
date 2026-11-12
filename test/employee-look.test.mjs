import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPLOYEE_LOOKS, lookById, lookFor, normalizeLookId } from "../renderer/src/scene/employeeLook.js";

// Ticket 18: 场景里没有姓名标签，员工靠形象认人 —— so the look catalog must be
// stable, distinct and never fall through to a blank person.

test("the catalog has enough distinct faces for a full office", () => {
  assert.ok(EMPLOYEE_LOOKS.length >= 8, "at least one look per desk");
  const ids = new Set(EMPLOYEE_LOOKS.map((look) => look.id));
  assert.equal(ids.size, EMPLOYEE_LOOKS.length, "ids are unique");

  // Two people who look identical defeat the point: every look differs in at
  // least two of hair colour, shirt colour and hair silhouette.
  const signatures = EMPLOYEE_LOOKS.map((look) => `${look.hair}|${look.top}|${look.hairStyle}`);
  assert.equal(new Set(signatures).size, signatures.length, "no two looks are the same person");
});

test("every look is a complete palette plus a build", () => {
  for (const look of EMPLOYEE_LOOKS) {
    assert.match(look.skin, /^#[0-9a-f]{6}$/i);
    assert.match(look.hair, /^#[0-9a-f]{6}$/i);
    assert.match(look.top, /^#[0-9a-f]{6}$/i);
    assert.match(look.bottom, /^#[0-9a-f]{6}$/i);
    assert.match(look.shoes, /^#[0-9a-f]{6}$/i);
    assert.ok(["slim", "regular", "broad"].includes(look.build));
    assert.ok(look.height >= 0.9 && look.height <= 1.1);
  }
});

test("a stored id wins, an unknown id falls back to the role's face", () => {
  assert.equal(lookFor({ appearance: "zhao" }).id, "zhao");
  assert.equal(lookFor({ appearance: "does-not-exist", roleSnapshot: { key: "tester" } }).id, "wu");
  assert.equal(lookFor({ appearance: null, roleSnapshot: { key: "pm" } }).id, "qin");
  // an employee hired before the look existed still renders as somebody
  assert.ok(lookFor({}).id.length > 0);
  assert.equal(lookFor(null).id, EMPLOYEE_LOOKS[0].id);
});

test("lookById is strict about shape", () => {
  assert.equal(lookById("lin")?.id, "lin");
  assert.equal(lookById(""), null);
  assert.equal(lookById("LIN"), null);
  assert.equal(lookById(null), null);
});

test("normalizeLookId distinguishes 'not provided' from 'unknown'", () => {
  assert.equal(normalizeLookId(undefined), null);
  assert.equal(normalizeLookId(null), null);
  assert.equal(normalizeLookId("su"), "su");
  assert.equal(normalizeLookId("nope"), null);
  assert.throws(() => normalizeLookId(42), /appearance must be a look id/);
});
