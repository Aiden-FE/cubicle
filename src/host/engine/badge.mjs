/**
 * Engine badge derivation (ticket 11: 徽章三态 已登录 / 待配 key / 未装).
 *
 * The badge answers "could this engine work on this machine right now" —
 * separate from admission (probe passed / risk-enabled), which the engine
 * card renders on its own. Kept pure so the card, the service, and the
 * tests all read one truth.
 *
 * @typedef {"logged_in" | "needs_key" | "not_installed"} EngineBadge
 */

/**
 * @param {{ installed: boolean | null, configured: boolean }} facts  installed null = 尚未探测
 * @returns {EngineBadge}
 */
export function deriveEngineBadge({ installed, configured }) {
  // Absent until proven present: an engine we have not detected (or failed
  // to detect) must not claim a key/login state.
  if (installed !== true) return "not_installed";
  if (configured) return "logged_in";
  return "needs_key";
}

/** What a 未装 engine card tells the human to do (per engine key). */
/** @type {Record<string, string>} */
export const INSTALL_GUIDES = {
  codex: "未安装：装官方 Codex CLI（npm install -g @openai/codex，0.163 以上），或在引擎中心指定其路径后重试。",
  pi: "pi 引擎随 Cubicle 打包，不需要单独安装。",
  dsh: "未安装：装 DeepSeek Harness desktop（0.2.x），或设置 CUBICLE_DSH_EXE / CUBICLE_DSH_ENTRY 指向安装位置。",
};

/** @param {string} engine @returns {string} */
export function installGuide(engine) {
  return INSTALL_GUIDES[engine] ?? "未安装：参考该引擎的官方文档安装后，重开引擎中心重试。";
}
