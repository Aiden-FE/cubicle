/**
 * Policy verdict bridge — the loopback channel between an injected codex
 * PreToolUse hook and the AgentHost (ticket 11: codex 卡口必须复用宿主策略).
 *
 * The hook runs inside the codex CLI process tree, so it has to ask the host
 * for a decision instead of evaluating a local rule table: the agent owns the
 * engine directory and could edit a copied policy.mjs. `/decide` is the gate
 * (fail-closed when the host cannot answer), `/verdict` carries the deny back
 * for telemetry / the policy_blocked event. 127.0.0.1 only, one-shot token,
 * bounded request bodies.
 *
 * The listener never keeps the event loop alive (unref) — the host can
 * idle without an open engine and tests never hang on a lingering port.
 *
 * @typedef {{ session_id: string, tool_use_id?: string, tool_name?: string, verdict: "allow" | "deny", rule?: string, reason?: string }} PolicyVerdict
 * @typedef {{ session_id: string, tool_name?: string, tool_input?: unknown }} PolicyQuestion
 * @typedef {{ verdict: "allow" | "deny", rule?: string, reason?: string }} PolicyDecision
 * @typedef {object} PolicyBridge
 * @property {string} url
 * @property {string} token
 * @property {() => Promise<void>} close
 */
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

/** A verdict/decision body is tiny; anything bigger is abuse or a bug. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * @param {((verdict: PolicyVerdict) => void) | { onVerdict: (verdict: PolicyVerdict) => void, decide?: (question: PolicyQuestion) => PolicyDecision }} options
 * @param {(question: PolicyQuestion) => PolicyDecision} [legacyDecide]
 * @returns {Promise<PolicyBridge>}
 */
export async function startPolicyBridge(options, legacyDecide) {
  const onVerdict = typeof options === "function" ? options : options.onVerdict;
  const decide = typeof options === "function" ? legacyDecide : options.decide;
  const token = randomBytes(16).toString("hex");

  const sameToken = (/** @type {unknown} */ candidate) => {
    if (typeof candidate !== "string" || candidate.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
  };

  const server = createServer((req, res) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (req.method !== "POST" || (pathname !== "/verdict" && pathname !== "/decide")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (!sameToken(req.headers["x-cubicle-token"])) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad token" }));
      return;
    }
    let body = "";
    let bytes = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      bytes += Buffer.byteLength(String(chunk));
      if (bytes > MAX_BODY_BYTES) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "body too large" }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (bytes > MAX_BODY_BYTES) return;
      /** @type {unknown} */
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      if (pathname === "/decide") {
        // Fail closed: no decider, malformed question, or a throwing decider
        // all land as deny. The hook also denies on transport failure.
        /** @type {PolicyDecision} */
        let decision = { verdict: "deny", rule: "host-unavailable", reason: "宿主策略无法判定这次调用" };
        try {
          if (decide && parsed && typeof parsed === "object") {
            const question = /** @type {PolicyQuestion} */ (parsed);
            const result = decide(question);
            if (result && result.verdict === "allow") decision = { verdict: "allow" };
            else if (result && result.verdict === "deny") decision = result;
          }
        } catch {
          // keep the deny default
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(decision));
        return;
      }
      if (parsed && typeof parsed === "object" && typeof (/** @type {any} */ (parsed).session_id) === "string") {
        onVerdict(/** @type {PolicyVerdict} */ (parsed));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("policy bridge did not bind a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
      }),
  };
}
