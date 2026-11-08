/**
 * Cubicle PreToolUse hook — the codex-side half of ticket 11's 卡口.
 *
 * codex-cli 0.163.0 executes model-emitted shell commands itself, so the
 * host's only real choke point is the engine's own PreToolUse hook. This
 * script deliberately does NOT contain the rules: it asks the AgentHost over
 * the loopback bridge (`/decide`) and fails closed if the host cannot answer.
 * A copied rule table in the engine directory would be editable by the same
 * agent it is supposed to constrain.
 *
 * Contract (verified against codex 0.163.0 in the ticket-11 spike):
 *   stdin  : Claude-compatible hook JSON — { session_id, tool_name,
 *            tool_input: { command }, tool_use_id, ... }
 *   stdout : { hookSpecificOutput: { hookEventName: "PreToolUse",
 *            permissionDecision: "allow"|"deny", permissionDecisionReason } }
 */
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", async () => {
  /** @type {any} */
  let input = null;
  try {
    input = JSON.parse(raw);
  } catch {
    // Fail closed: an undecidable call is not an allow.
    writeDecision({ decision: "deny", reason: "策略拦截：hook 输入无法解析" });
    return;
  }

  const decision = await askHost(input);
  if (decision.decision === "deny") {
    postVerdict({
      session_id: input?.session_id,
      tool_use_id: input?.tool_use_id,
      tool_name: input?.tool_name,
      verdict: "deny",
      rule: decision.rule,
      reason: decision.reason,
    });
  }
  writeDecision(decision);
});

/**
 * Ask the host. No bridge = deny (the engine must not run ungoverned just
 * because the host is restarting).
 *
 * @param {any} input
 * @returns {Promise<{ decision: "allow" | "deny", rule?: string, reason?: string }>}
 */
async function askHost(input) {
  const url = process.env.CUBICLE_POLICY_BRIDGE_URL;
  const token = process.env.CUBICLE_POLICY_TOKEN;
  if (!url || !token) {
    return { decision: "deny", reason: "策略拦截：宿主策略桥不可用（没有连接信息）" };
  }
  try {
    const response = await fetch(`${url}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cubicle-token": token },
      body: JSON.stringify({
        session_id: input?.session_id,
        tool_name: input?.tool_name,
        tool_input: input?.tool_input,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { decision: "deny", reason: `策略拦截：宿主策略桥返回 ${response.status}` };
    }
    const body = /** @type {any} */ (await response.json());
    if (body?.verdict === "allow") return { decision: "allow" };
    return {
      decision: "deny",
      rule: typeof body?.rule === "string" ? body.rule : "host-deny",
      reason: typeof body?.reason === "string" ? body.reason : "宿主策略拒绝了这次调用",
    };
  } catch {
    return { decision: "deny", reason: "策略拦截：宿主策略桥超时或不可达" };
  }
}

/** @param {{ decision: "allow" | "deny", rule?: string, reason?: string } | undefined} decision */
function writeDecision(decision) {
  const deny = decision?.decision === "deny";
  const reason = deny
    ? decision?.rule
      ? `策略拦截（${decision.rule}）：${decision.reason ?? "宿主策略拒绝了这次调用"}`
      : decision?.reason ?? "宿主策略拒绝了这次调用"
    : undefined;
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: deny ? "deny" : "allow",
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  };
  process.stdout.write(JSON.stringify(out));
}

/** @param {Record<string, unknown>} verdict */
async function postVerdict(verdict) {
  const url = process.env.CUBICLE_POLICY_BRIDGE_URL;
  const token = process.env.CUBICLE_POLICY_TOKEN;
  if (!url || !token) return; // the decision above already blocks
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
