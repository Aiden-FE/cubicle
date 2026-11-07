/**
 * --no-sandbox 降级决策 (ticket 13: 打包启动路径保留 start.mjs 的降级语义).
 *
 * 本机安全策略起不来 Electron 的 Chromium 进程沙箱：进程在任何 JS 跑起来
 * 之前就带 0x80000003（STATUS_BREAKPOINT；GUI 子系统下还静默）退出（见
 * AGENTS.md「M1 骨架环境坑」）。首跑撞上这个签名就带 --no-sandbox 重试
 * 恰好一次；用户显式带过 flag 就不擅自加。
 *
 * start.mjs（dev）import 这个模块；打包形态的 Start-Cubicle.ps1 镜像同
 * 一份判据（PowerShell 无法 import ESM —— 两处判据必须逐字对应，e2e-13
 * 现场跑真 launcher 证明镜像没漂）。
 */

/**
 * Breakpoint before JS runs: the Chromium process sandbox cannot come up
 * under this machine's policy. (STATUS_BREAKPOINT / STATUS_ACCESS_VIOLATION;
 * Node may report these as signed or unsigned 32-bit, so normalize.)
 *
 * @param {number} code
 * @returns {boolean}
 */
export function isSandboxCrash(code) {
  const normalized = code < 0 ? code >>> 0 : code;
  return normalized === 0x80000003 || normalized === 0xc0000005;
}

/**
 * @param {{ code: number, attempt: number, extraArgs: string[] }} launch
 * @returns {"success" | "retry-no-sandbox" | "failed"}
 */
export function decideLaunchOutcome({ code, attempt, extraArgs }) {
  if (code === 0) return "success";
  if (attempt === 0 && extraArgs.length === 0 && isSandboxCrash(code)) return "retry-no-sandbox";
  return "failed";
}
