import assert from "node:assert/strict";
import { test } from "node:test";

import { activityForTool } from "../renderer/src/scene/toolActivity.js";

// Ticket 07 acceptance: 四类工具状态正确映射（读 / 写 / 执行 / 测试）。
// Expected values are literals from the ticket's four-category vocabulary,
// applied to shell-tool command shapes (powershell/bash both count as
// shell; the programmer seed role uses powershell on this Windows host,
// see src/host/store.mjs) — not recomputed from the implementation.

test("file-reading tools map to 读（read）", () => {
  assert.equal(activityForTool("read", { path: "hello.txt" }), "read");
  assert.equal(activityForTool("grep", { pattern: "TODO" }), "read");
  assert.equal(activityForTool("ls", {}), "read");
});

test("file-changing tools map to 写（write）", () => {
  assert.equal(activityForTool("write", { path: "notes.md", content: "hi" }), "write");
  assert.equal(activityForTool("edit", { path: "notes.md" }), "write");
});

test("shell commands map to 执行（exec）…", () => {
  assert.equal(activityForTool("bash", { command: "echo building…" }), "exec");
  assert.equal(activityForTool("powershell", { command: "Get-ChildItem" }), "exec");
});

test("…unless the command runs tests, which map to 测试（test）", () => {
  assert.equal(activityForTool("bash", { command: "npm test" }), "test");
  assert.equal(activityForTool("bash", { command: "npm run test:fail" }), "test");
  assert.equal(activityForTool("bash", { command: "node test_ok.mjs" }), "test");
  assert.equal(activityForTool("bash", { command: "npx vitest run" }), "test");
  assert.equal(activityForTool("bash", { command: "pytest -q" }), "test");
  assert.equal(activityForTool("bash", { command: "go test ./…" }), "test");
});

test("unknown tools still read as generic work, never invisible", () => {
  assert.equal(activityForTool("websearch", { q: "x" }), "work");
  assert.equal(activityForTool(undefined, undefined), "work");
});
