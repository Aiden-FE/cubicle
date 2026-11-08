import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startPolicyBridge } from "../src/host/engine/codex/bridge.mjs";
import { decideToolAccess } from "../src/host/engine/policy.mjs";

const hookSource = new URL("../src/host/engine/codex/policy-hook.mjs", import.meta.url);

/** Copy the thin hook like the adapter does, then run it for one stdin JSON. */
async function runHook(/** @type {string} */ stdinJson, extraEnv = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cubicle-hook-"));
  try {
    copyFileSync(hookSource, path.join(dir, "policy-hook.mjs"));
    const child = spawn(process.execPath, [path.join(dir, "policy-hook.mjs")], {
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.end(stdinJson);
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    const code = await new Promise((resolve) => child.on("close", resolve));
    return { code, output: JSON.parse(stdout || "{}") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A bridge whose decision is the real host policy, pinned to a test workspace. */
async function policyBridge(/** @type {(verdict: any) => void} */ onVerdict = () => {}) {
  return startPolicyBridge({
    onVerdict,
    decide: (question) =>
      decideToolAccess({
        toolName: question.tool_name,
        args: question.tool_input,
        workspaceDir: path.join(os.tmpdir(), "cubicle-hook-workspace"),
      }),
  });
}

test("the hook asks the host and returns its deny in codex wire format", async () => {
  const bridge = await policyBridge();
  try {
    const { output } = await runHook(
      JSON.stringify({
        session_id: "s1",
        tool_name: "Bash",
        tool_use_id: "call_1",
        tool_input: { command: "Remove-Item -Recurse -Force notes" },
      }),
      { CUBICLE_POLICY_BRIDGE_URL: bridge.url, CUBICLE_POLICY_TOKEN: bridge.token },
    );
    assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /策略拦截（recursive-force-delete）/);
  } finally {
    await bridge.close();
  }
});

test("ordinary calls pass with an explicit allow from the host", async () => {
  const bridge = await policyBridge();
  try {
    const { output } = await runHook(
      JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_use_id: "c", tool_input: { command: "echo hi" } }),
      { CUBICLE_POLICY_BRIDGE_URL: bridge.url, CUBICLE_POLICY_TOKEN: bridge.token },
    );
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
  } finally {
    await bridge.close();
  }
});

test("deny verdicts are reported to the bridge alongside the block", async () => {
  /** @type {any[]} */
  const received = [];
  const bridge = await policyBridge((v) => received.push(v));
  try {
    await runHook(
      JSON.stringify({
        session_id: "s1",
        tool_name: "Bash",
        tool_use_id: "call_rm",
        tool_input: { command: "rm -rf /somewhere" },
      }),
      { CUBICLE_POLICY_BRIDGE_URL: bridge.url, CUBICLE_POLICY_TOKEN: bridge.token },
    );
    // let the hook's fire-and-forget POST land before reading
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(received.length, 1);
    assert.equal(received[0].verdict, "deny");
    assert.equal(received[0].rule, "recursive-force-delete");
    assert.equal(received[0].session_id, "s1");
  } finally {
    await bridge.close();
  }
});

test("a file write outside the workspace is denied by the host, not by a copy of the rules", async () => {
  const bridge = await policyBridge();
  try {
    const { output } = await runHook(
      JSON.stringify({
        session_id: "s1",
        tool_name: "Write",
        tool_use_id: "call_write",
        tool_input: { path: "..\\..\\Windows\\System32\\evil.txt" },
      }),
      { CUBICLE_POLICY_BRIDGE_URL: bridge.url, CUBICLE_POLICY_TOKEN: bridge.token },
    );
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /outside-workspace/);
  } finally {
    await bridge.close();
  }
});

test("without a bridge the gate fails closed", async () => {
  const { output } = await runHook(
    JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_use_id: "c", tool_input: { command: "format c:" } }),
  );
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /策略桥不可用/);
});

test("a malformed stdin fails closed", async () => {
  const { output } = await runHook("this is not json");
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /无法解析/);
});
