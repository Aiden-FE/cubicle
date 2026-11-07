import assert from "node:assert/strict";
import { test } from "node:test";

import { decideToolAccess } from "../src/host/engine/policy.mjs";

// Ticket 07 acceptance: 被策略拒绝时工位有可见提示，不静默 — this module is
// the 拒绝 verdict itself (the pi adapter blocks the tool call on deny).
// Expected verdicts come from the starter policy's intent (工位上不许毁盘、
// 不许递归强删、不许写系统目录), expressed as literals.

test("ordinary work commands pass the gate", () => {
  assert.deepEqual(decideToolAccess({ toolName: "bash", args: { command: "echo building…" } }), { verdict: "allow" });
  assert.deepEqual(decideToolAccess({ toolName: "bash", args: { command: "rm notes.txt" } }), { verdict: "allow" });
  assert.deepEqual(decideToolAccess({ toolName: "write", args: { path: "notes.md" } }), { verdict: "allow" });
});

test("recursive force-deletes are denied with a visible reason", () => {
  for (const command of ["rm -rf important.txt", "rm -fr ./src", "rd /s /q workspace", "del /s /q *.txt", "Remove-Item -Recurse -Force ."]) {
    const verdict = decideToolAccess({ toolName: "bash", args: { command } });
    assert.equal(verdict.verdict, "deny", `expected deny for: ${command}`);
    assert.ok(typeof verdict.rule === "string" && verdict.rule.length > 0);
    assert.ok(typeof verdict.reason === "string" && verdict.reason.length > 0, "reason must be human-visible, not silent");
  }
});

test("disk-wrecking commands are denied", () => {
  for (const command of ["format C:", "diskpart", "mkfs.ext4 /dev/sda1"]) {
    assert.equal(decideToolAccess({ toolName: "bash", args: { command } }).verdict, "deny", `expected deny for: ${command}`);
  }
});

test("writes aimed at system paths are denied", () => {
  assert.equal(decideToolAccess({ toolName: "write", args: { path: "C:\\Windows\\System32\\drivers\\evil.sys" } }).verdict, "deny");
  assert.equal(decideToolAccess({ toolName: "edit", args: { path: "/etc/passwd" } }).verdict, "deny");
  assert.equal(decideToolAccess({ toolName: "write", args: { path: "C:\\Program Files\\Cubicle\\config.json" } }).verdict, "deny");
});

test("unparseable args are allowed, not phantom-blocked", () => {
  assert.deepEqual(decideToolAccess({ toolName: "bash", args: undefined }), { verdict: "allow" });
  assert.deepEqual(decideToolAccess({ toolName: "mystery", args: { whatever: true } }), { verdict: "allow" });
});
