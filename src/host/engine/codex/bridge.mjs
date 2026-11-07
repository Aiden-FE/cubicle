/**
 * Policy verdict bridge — the loopback channel between an injected codex
 * PreToolUse hook and the AgentHost (ticket 11: codex 卡口必须复用
 * decideToolAccess 并发同一个 policy_blocked 事件).
 *
 * The hook runs inside the codex CLI process tree, so the verdict has to
 * travel back to the host that owns the run's normalized event stream. This
 * is a 127.0.0.1-only HTTP endpoint guarded by a one-shot token; allow
 * verdicts are recorded for probe telemetry, deny verdicts become
 * `policy_blocked` events at the adapter.
 *
 * The listener never keeps the event loop alive (unref) — the host can
 * idle without an open engine and tests never hang on a lingering port.
 *
 * @typedef {{ session_id: string, tool_use_id?: string, tool_name?: string, verdict: "allow" | "deny", rule?: string, reason?: string }} PolicyVerdict
 * @typedef {object} PolicyBridge
 * @property {string} url
 * @property {string} token
 * @property {() => Promise<void>} close
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

/**
 * @param {(verdict: PolicyVerdict) => void} onVerdict
 * @returns {Promise<PolicyBridge>}
 */
export async function startPolicyBridge(onVerdict) {
  const token = randomBytes(16).toString("hex");

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/verdict")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (req.headers["x-cubicle-token"] !== token) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad token" }));
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      /** @type {PolicyVerdict | null} */
      let verdict = null;
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === "object" && typeof parsed.session_id === "string") {
          verdict = /** @type {PolicyVerdict} */ (parsed);
        }
      } catch {
        // malformed verdicts are dropped below
      }
      if (verdict) onVerdict(verdict);
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
