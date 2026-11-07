import assert from "node:assert/strict";
import { test } from "node:test";

import { createSingleInstanceGuard, focusMainWindow } from "../src/main/single-instance.mjs";

// 票 13 验收 2：单实例锁生效 — 拿不到锁的进程必须让位（聚焦既有窗口后退出），
// 第二个窗口永远不出现。纯决策 seam：Electron 的真实锁行为由 e2e-13 钉。

test("拿到单实例锁 → primary：正常启动路径", () => {
  const guard = createSingleInstanceGuard({ requestSingleInstanceLock: () => true });
  assert.equal(guard.role, "primary");
});

test("拿不到单实例锁 → secondary：调用方据此直接退出，不开窗口", () => {
  const guard = createSingleInstanceGuard({ requestSingleInstanceLock: () => false });
  assert.equal(guard.role, "secondary");
});

test("重复启动信号（second-instance）：最小化的窗口先还原再聚焦", () => {
  /** @type {string[]} */
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push("restore"),
    focus: () => calls.push("focus"),
  };
  focusMainWindow(win);
  assert.deepEqual(calls, ["restore", "focus"]);
});

test("已经在前台的窗口只聚焦，不做多余的还原", () => {
  /** @type {string[]} */
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => calls.push("restore"),
    focus: () => calls.push("focus"),
  };
  focusMainWindow(win);
  assert.deepEqual(calls, ["focus"]);
});

test("窗口正在销毁：什么都不做，不抛出（否则 second-instance 会崩主进程）", () => {
  const win = {
    isDestroyed: () => true,
    isMinimized: () => false,
    restore: () => assert.fail("must not touch a destroyed window"),
    focus: () => assert.fail("must not touch a destroyed window"),
  };
  focusMainWindow(win);
});

test("没有窗口（全部已关）：什么都不做", () => {
  focusMainWindow(null);
  focusMainWindow(undefined);
});
