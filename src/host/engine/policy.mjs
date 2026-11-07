/**
 * Starter tool-access policy (ticket 07: 被策略拒绝时工位有可见提示).
 *
 * The host's runtime gate over engine tool calls — distinct from admission
 * (the role manifest's tool list picks WHICH tools a session has; this
 * decides whether a GIVEN call may run). The pi adapter enforces it through
 * the SDK's inline-extension `tool_call` hook (block: true), then rides the
 * verdict onto the normalized stream as a `policy_blocked` event so the desk
 * shows it — the拒绝 is never silent. CLI hosts (ticket 11) reuse this exact
 * decision function at their own choke point.
 *
 * v1 starter rules, deliberately small and reviewable: a工位 must not wreck
 * the machine — no recursive force-deletes, no disk destruction, no writes
 * into system paths. Everything else works.
 *
 * @typedef {{ verdict: "allow" }} AllowVerdict
 * @typedef {{ verdict: "deny", rule: string, reason: string }} DenyVerdict
 * @typedef {AllowVerdict | DenyVerdict} ToolAccessVerdict
 */

/** @type {ReadonlySet<string>} */
const SHELL_TOOLS = new Set(["bash", "powershell", "exec", "shell"]);

/** @type {ReadonlySet<string>} */
const PATH_TOOLS = new Set(["write", "edit"]);

/**
 * Command patterns → (rule id, human-visible reason). Table, not ladder:
 * adding a rule is adding one row.
 *
 * @type {readonly { rule: string, reason: string, patterns: readonly RegExp[] }[]}
 */
const SHELL_RULES = [
  {
    rule: "recursive-force-delete",
    reason: "工位上禁止递归强制删除（会连工作区一起毁掉）",
    patterns: [
      /\brm\s+(-{1,2}\w*r\w*f|-{1,2}\w*f\w*r|-r\s+-f|-f\s+-r)\b/i,
      /\b(?:rd|rmdir)\s+\/s\b/i,
      /\b(?:del|erase)\s+\/s\b/i,
      /\bremove-item\b[^\n]*-recurse/i,
    ],
  },
  {
    rule: "disk-destruction",
    reason: "工位上禁止格式化 / 分区 / 写裸设备级别的命令",
    patterns: [/\bformat\s+[a-z]:/i, /\bdiskpart\b/i, /\bmkfs(\.\w+)?\b/i, /\bdd\s+[^\n]*\bof=\/dev\//i],
  },
];

/** @type {readonly { rule: string, reason: string, patterns: readonly RegExp[] }[]} */
const PATH_RULES = [
  {
    rule: "system-path-write",
    reason: "工位只许写自己工作区里的文件，不许写系统目录",
    patterns: [/^[a-z]:\\windows\b/i, /^[a-z]:\\program files( \(x86\))?\\/i, /^[a-z]:\\programdata\b/i, /^\/etc\b/, /^\/boot\b/, /^\/usr\b/, /^\/bin\b/, /^\/sbin\b/, /^\/sys\b/, /^\/proc\b/, /^\/dev\b/],
  },
];

/**
 * @param {{ toolName: unknown, args: unknown }} call
 * @returns {ToolAccessVerdict}
 */
export function decideToolAccess({ toolName, args }) {
  const name = typeof toolName === "string" ? toolName.toLowerCase() : "";

  if (SHELL_TOOLS.has(name)) {
    const command = stringField(args, "command");
    if (command) {
      for (const rule of SHELL_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(command))) {
          return { verdict: "deny", rule: rule.rule, reason: rule.reason };
        }
      }
    }
  }

  if (PATH_TOOLS.has(name)) {
    const path = stringField(args, "path");
    if (path) {
      for (const rule of PATH_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(path))) {
          return { verdict: "deny", rule: rule.rule, reason: rule.reason };
        }
      }
    }
  }

  return { verdict: "allow" };
}

/** @param {unknown} args @param {string} key @returns {string} */
function stringField(args, key) {
  if (args === null || typeof args !== "object") return "";
  const value = /** @type {Record<string, unknown>} */ (args)[key];
  return typeof value === "string" ? value : "";
}
