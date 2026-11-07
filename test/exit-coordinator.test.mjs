import test from "node:test";
import assert from "node:assert/strict";

import { createExitCoordinator } from "../src/main/exit-coordinator.mjs";

/**
 * 退出三选（票 09 验收 4）在纯协作对象上的钉法：假 dialog 选钮、假 host 门、
 * 事件序列记录 — 钉的是「对话框出现三选」+「直接退先下班落盘再退」+
 * 「取消什么都不发生」+「对话框不叠加」。
 */

/**
 * @param {{ choice: number, pauseAllImpl?: () => Promise<unknown>, awaitQuietImpl?: () => Promise<unknown> }} options
 */
function withCoordinator({ choice, pauseAllImpl, awaitQuietImpl }) {
  /** @type {string[]} */
  const events = [];
  const coordinator = createExitCoordinator({
    showMessageBox: async (dialog) => {
      events.push(`dialog:${dialog.buttons.join("|")}`);
      return choice;
    },
    pauseAll: async () => {
      events.push("pauseAll");
      if (pauseAllImpl) return pauseAllImpl();
    },
    awaitQuiet: async () => {
      events.push("awaitQuiet");
      if (awaitQuietImpl) return awaitQuietImpl();
    },
    allowQuit: () => events.push("allowQuit"),
    onNote: (note) => events.push(`note:${note}`),
  });
  return { coordinator, events };
}

test("退出出现三选对话：直接退 / 等完成 / 取消（验收 4）", async () => {
  const { coordinator, events } = withCoordinator({ choice: 2 });
  const intercepted = await coordinator.requestClose();
  assert.equal(intercepted, true, "关闭被拦截");
  assert.equal(events[0], "dialog:直接退|等完成|取消", "三个选项、顺序固定");
  assert.deepEqual(events.slice(1), [], "选「取消」：什么都不发生（验收 4 取消语义）");
  assert.equal(coordinator.exiting, false, "取消后窗口照开");
});

test("直接退：先 pauseAll 下班落盘，落库回答后才放行退出（顺序钉死）", async () => {
  const { coordinator, events } = withCoordinator({
    choice: 0,
    pauseAllImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  });
  await coordinator.requestClose();
  assert.deepEqual(events, ["dialog:直接退|等完成|取消", "pauseAll", "allowQuit"], "pauseAll 一定在 allowQuit 之前");
  assert.equal(coordinator.exiting, true);
});

test("等完成：awaitQuiet 回答后才放行退出，不发 pauseAll", async () => {
  const { coordinator, events } = withCoordinator({ choice: 1 });
  await coordinator.requestClose();
  assert.deepEqual(events, ["dialog:直接退|等完成|取消", "awaitQuiet", "allowQuit"]);
});

test("对话框开着时再点关闭：不叠第二个对话框（关闭只问一次）", async () => {
  let resolveChoice = /** @type {((n: number) => void) | null} */ (null);
  const events = /** @type {string[]} */ ([]);
  const coordinator = createExitCoordinator({
    showMessageBox: () => {
      events.push("dialog");
      return new Promise((resolve) => (resolveChoice = resolve));
    },
    pauseAll: async () => events.push("pauseAll"),
    awaitQuiet: async () => events.push("awaitQuiet"),
    allowQuit: () => events.push("allowQuit"),
  });
  const first = coordinator.requestClose();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await coordinator.requestClose(); // 第二个关闭请求
  assert.equal(second, true, "第二次也被拦截");
  assert.deepEqual(events, ["dialog"], "只弹一次对话框");
  resolveChoice?.(0);
  await first;
  assert.deepEqual(events, ["dialog", "pauseAll", "allowQuit"]);
});

test("pauseAll 失败（host 已死）：诚实记一笔并照样放行，不把用户锁在开着的窗口里", async () => {
  const { coordinator, events } = withCoordinator({
    choice: 0,
    pauseAllImpl: async () => {
      throw new Error("host_offline");
    },
  });
  await coordinator.requestClose();
  assert.ok(events.includes("pauseAll"));
  assert.ok(events.at(-1) === "allowQuit", `最后一步放行：${events.join(",")}`);
  assert.ok(events.some((e) => e.startsWith("note:")), "失败有记录");
});

test("退出流程已放行后：不再弹对话框（window-all-closed 再触发也直通）", async () => {
  const { coordinator, events } = withCoordinator({ choice: 0 });
  await coordinator.requestClose();
  const again = await coordinator.requestClose();
  assert.equal(again, false, "不再拦截");
  assert.deepEqual(events, ["dialog:直接退|等完成|取消", "pauseAll", "allowQuit"], "对话框只出现过一次");
});
