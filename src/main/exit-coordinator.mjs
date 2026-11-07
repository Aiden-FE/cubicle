/**
 * 退出三选协调器 (ticket 09: 退出时出现三选对话，直接退会先执行下班落盘).
 *
 * Electron main 只做窗口 — 这套决策逻辑抽成纯协作对象，node:test 可用假
 * dialog / 假 host 门钉死顺序与语义：
 *
 *   close 请求 → 三选对话框（直接退 / 等完成 / 取消）
 *   - 直接退：先发 host.pauseAll（下班落盘：所有在跑 run 收尾成 paused，
 *     AgentHost 回答时写入已经落库）→ 回答后才允许窗口销毁/进程退出。
 *   - 等完成：发 host.awaitQuiet（run 池安静才回答）→ 再退出。
 *   - 取消：什么都不发生，窗口照开。
 *
 * 对话框开着时再次点关闭：不叠第二个对话框（先让按钮数得清）。
 */

/**
 * @typedef {"quit" | "wait" | "cancel"} ExitChoice
 *
 * @param {object} options
 * @param {{ buttons: string[], detail: string }} [options.dialog] 对话框文案（三选，顺序固定）
 * @param {(dialog: { buttons: string[], detail: string }) => Promise<number>} options.showMessageBox 真实宿主里是 dialog.showMessageBox
 * @param {() => Promise<unknown>} options.pauseAll host.pauseAll — 下班落盘
 * @param {() => Promise<unknown>} options.awaitQuiet host.awaitQuiet — 等所有 run 收尾
 * @param {() => void} options.allowQuit 放行退出：置 bypass 后销毁窗口
 * @param {(note: string) => void} [options.onNote] 失败备注（host 不在等）
 */
export function createExitCoordinator({ dialog, showMessageBox, pauseAll, awaitQuiet, allowQuit, onNote = () => {} }) {
  const spec = dialog ?? {
    buttons: ["直接退", "等完成", "取消"],
    detail: "还有员工在干活。退出前会先「下班落盘」：进行中的任务暂停，下次上班自动续跑。",
  };
  let prompting = false;
  let exiting = false;

  /**
   * 窗口 close 事件的入口。返回 true = 已拦截（调用方要 preventDefault）。
   *
   * @returns {Promise<boolean>}
   */
  async function requestClose() {
    if (exiting) return false; // 已在退出流程：放行
    if (prompting) return true; // 对话框还开着：不叠第二个
    prompting = true;
    try {
      const choice = await showMessageBox(spec);
      if (choice === 0) {
        // 直接退：先下班落盘，等 AgentHost 把 paused 写进库才放行退出。
        try {
          await pauseAll();
        } catch (err) {
          // host 已经不在了也放行 — 没有 run 就没有可丢的东西
          onNote(`pauseAll 未成功（${String(err instanceof Error ? err.message : err)}），直接退出`);
        }
        exiting = true;
        allowQuit();
        return true;
      }
      if (choice === 1) {
        // 等完成：等 run 池安静再退出。
        try {
          await awaitQuiet();
        } catch (err) {
          onNote(`awaitQuiet 未成功（${String(err instanceof Error ? err.message : err)}），直接退出`);
        }
        exiting = true;
        allowQuit();
        return true;
      }
      // 取消：什么都不发生
      return true;
    } finally {
      prompting = false;
    }
  }

  return {
    requestClose,
    /** 退出流程已经放行（window close 拦截器据此不再拦）。 */
    get exiting() {
      return exiting;
    },
    /** 三选对话框是否正开着。 */
    get prompting() {
      return prompting;
    },
    dialogSpec: spec,
  };
}
