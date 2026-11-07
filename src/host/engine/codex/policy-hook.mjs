/**
 * Cubicle PreToolUse hook — the codex-side half of ticket 11's 卡口.
 *
 * codex-cli 0.163.0 executes model-emitted shell commands itself, so the
 * host's only real choke point is the engine's own PreToolUse hook. This
 * script decides with **the host's own policy.mjs** (copied next to it by
 * the adapter — same code, no second implementation of the rules), blocks
 * the call in codex's wire format, and reports the verdict back over the
 * loopback bridge so the run's normalized stream carries `policy_blocked`
 * (the same event the pi adapter emits from its inline extension — the
 * 工位 animates and the timeline speaks one vocabulary for both engines).
 *
 * Contract (verified against codex 0.163.0 in the ticket-11 spike):
 *   stdin  : Claude-compatible hook JSON — { session_id, tool_name,
 *            tool_input: { command }, tool_use_id, ... }
 *   stdout : { hookSpecificOutput: { hookEventName: "PreToolUse",
 *            permissionDecision: "allow"|"deny", permissionDecisionReason } }
 *
 * Fail-open on parse trouble (an undecidable call is a malformed call — the
 * engine's own validation still runs; matching the pi extension, which also
 * never invents a denial out of a parse error).
 */
import { decideToolAccess } from "./policy.mjs";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", async () => {
  /** @type {any} */
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    writeDecision(undefined);
    return;
  }

  const verdict = decideToolAccess({
    toolName: input?.tool_name,
    args: input?.tool_input,
  });

  postVerdict({
    session_id: input?.session_id,
    tool_use_id: input?.tool_use_id,
    tool_name: input?.tool_name,
    verdict: verdict.verdict === "deny" ? "deny" : "allow",
    rule: verdict.verdict === "deny" ? verdict.rule : undefined,
    reason: verdict.verdict === "deny" ? verdict.reason : undefined,
  });

  writeDecision(
    verdict.verdict === "deny"
      ? { decision: "deny", reason: `策略拦截（${verdict.rule}）：${verdict.reason}` }
      : { decision: "allow" },
  );
});

/** @param {{ decision: "allow" | "deny", reason?: string } | undefined} decision */
function writeDecision(decision) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision?.decision ?? "allow",
      ...(decision?.reason ? { permissionDecisionReason: decision.reason } : {}),
    },
  };
  process.stdout.write(JSON.stringify(out));
}

/** @param {Record<string, unknown>} verdict */
async function postVerdict(verdict) {
  const url = process.env.CUBICLE_POLICY_BRIDGE_URL;
  const token = process.env.CUBICLE_POLICY_TOKEN;
  if (!url || !token) return; // bridge is best-effort telemetry; the decision above already blocks
  try {
    await fetch(`${url}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cubicle-token": token },
      body: JSON.stringify(verdict),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // the host may be gone; the block already happened inside codex
  }
}
