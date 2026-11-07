/**
 * 单实例锁决策 (ticket 13: 重复启动不出现第二个窗口).
 *
 * Electron main 负责调用 app.requestSingleInstanceLock()；这里的 seam 把
 * 「拿到锁 = primary / 拿不到 = secondary」的决策与 second-instance 的窗口
 * 聚焦行为抽成纯逻辑，node:test 钉死语义（锁的真实行为由 e2e-13 现场验）。
 *
 * secondary 进程必须尽快退出（不开窗口、不建数据目录）：调用方拿到
 * role === "secondary" 就 app.exit(0)。primary 进程订阅
 * "second-instance" 事件，把既有窗口带到用户眼前。
 */

/**
 * @typedef {"primary" | "secondary"} InstanceRole
 *
 * @param {object} options
 * @param {() => boolean} options.requestSingleInstanceLock 真实宿主里是 app.requestSingleInstanceLock
 * @returns {{ role: InstanceRole }}
 */
export function createSingleInstanceGuard({ requestSingleInstanceLock }) {
  const gotLock = requestSingleInstanceLock();
  return { role: gotLock ? "primary" : "secondary" };
}

/**
 * second-instance 事件的窗口动作：还原（若最小化）→ 聚焦。
 * 窗口可能正在销毁（关闭竞态）或不存在（全关了）：诚实 no-op，绝不抛。
 *
 * @param {{ isDestroyed: () => boolean, isMinimized: () => boolean, restore: () => void, focus: () => void } | null | undefined} win
 */
export function focusMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}
