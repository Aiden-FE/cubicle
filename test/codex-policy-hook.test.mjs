import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startPolicyBridge } from "../src/host/engine/codex/bridge.mjs";

const hookSource = new URL("../src/host/engine/codex/policy-hook.mjs", import.meta.url);
const policySource = new URL("../src/host/engine/policy.mjs", import.meta.url);

/** Copy the hook + the live policy table like the adapter does, then run the hook for one stdin JSON. */
async function runHook(/** @type {string} */ stdinJson, extraEnv = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cubicle-hook-"));
  try {
    copyFileSync(hookSource, path.join(dir, "policy-hook.mjs"));
    copyFileSync(policySource, path.join(dir, "policy.mjs"));
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

test("the hook denies exactly what the host policy denies, in codex wire format", async () => {
  const { output } = await runHook(
    JSON.stringify({
      session_id: "s1",
      tool_name: "Bash",
      tool_use_id: "call_1",
      tool_input: { command: "Remove-Item -Recurse -Force notes" },
    }),
  );
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /策略拦截（recursive-force-delete）/);
});

test("ordinary calls pass with an explicit allow", async () => {
  const { output } = await runHook(
    JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_use_id: "c", tool_input: { command: "echo hi" } }),
  );
  assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
});

test("deny verdicts are reported to the bridge alongside the block", async () => {
  /** @type {any[]} */
  const received = [];
  const bridge = await startPolicyBridge((v) => received.push(v));
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

test("without a bridge the gate still blocks (defense in depth)", async () => {
  const { output } = await runHook(
    JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_use_id: "c", tool_input: { command: "format c:" } }),
  );
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /disk-destruction/);
});

test("a malformed stdin fails open, like the pi extension on parse trouble", async () => {
  const { output } = await runHook("this is not json");
  assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
});
