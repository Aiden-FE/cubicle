/**
 * Tool → workstation activity mapping (ticket 07: 四类工具状态读/写/执行/测试).
 *
 * The scene vocabulary the whole desk animation layer speaks: every tool
 * event from the normalized engine stream folds into one of these five
 * postures. Unknown tools land in the generic "work" posture — a new engine
 * tool must show *some* labour at the desk, never nothing.
 *
 * @typedef {"read" | "write" | "exec" | "test" | "work"} DeskActivityKind
 */

/** @type {ReadonlySet<string>} */
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);

/** @type {ReadonlySet<string>} */
const WRITE_TOOLS = new Set(["write", "edit"]);

/** @type {ReadonlySet<string>} */
const EXEC_TOOLS = new Set(["bash", "powershell", "exec", "shell"]);

/**
 * A shell command is a 测试 run when a test runner/test file appears as a
 * command token — patterns, not one catch-all substring (so `echo latest`
 * stays 执行).
 *
 * @type {readonly RegExp[]}
 */
const TEST_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|npx)\s+(?:run\s+)?test\b/i,
  /\b(?:vitest|jest|mocha|pytest|phpunit|ctest)\b/i,
  /\b(?:go|dotnet|cargo|mix|mvn|gradle)\s+test\b/i,
  /\btest[\w.-]*\.(?:mjs|cjs|js|ts|py)\b/i,
];

/**
 * @param {unknown} toolName
 * @param {unknown} args tool arguments (only `command` is inspected)
 * @returns {DeskActivityKind}
 */
export function activityForTool(toolName, args) {
  const name = typeof toolName === "string" ? toolName.toLowerCase() : "";
  if (WRITE_TOOLS.has(name)) return "write";
  if (READ_TOOLS.has(name)) return "read";
  if (EXEC_TOOLS.has(name)) return isTestCommand(args) ? "test" : "exec";
  return "work";
}

/** @param {unknown} args @returns {boolean} */
function isTestCommand(args) {
  const command =
    args !== null && typeof args === "object" && typeof /** @type {any} */ (args).command === "string"
      ? /** @type {any} */ (args).command
      : "";
  return TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
