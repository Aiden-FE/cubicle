import test from "node:test";
import assert from "node:assert/strict";

import { groupTasksForHandle, activeCountFor } from "../renderer/src/scene/handleGroups.js";

/**
 * 右把手三段分组（票 08 验收 2）：拉开是「进行中 / 待验收 / 档案」，
 * 档案 = done + failed。纯函数放 renderer/src/scene/（与 07 票同一层），
 * host 数据不变 — 分组只是视图对 task.list 的读法。
 *
 * @param {number} id @param {string} status
 */
const task = (id, status) => /** @type {any} */ ({ id, status, title: `#${id}`, employeeName: "小程" });

test("任务按三段落位：进行中 / 待验收 / 档案（done+failed）", () => {
  const sections = groupTasksForHandle([
    task(1, "running"),
    task(2, "review"),
    task(3, "done"),
    task(4, "failed"),
    task(5, "running"),
  ]);
  assert.deepEqual(sections.running.map((t) => t.id), [1, 5]);
  assert.deepEqual(sections.review.map((t) => t.id), [2]);
  assert.deepEqual(sections.archive.map((t) => t.id), [3, 4]);
});

test("待办不进把手三段 — 它属于工单台，不属于「活跃/档案」", () => {
  const sections = groupTasksForHandle([task(1, "open"), task(2, "open")]);
  assert.deepEqual(sections.running, []);
  assert.deepEqual(sections.review, []);
  assert.deepEqual(sections.archive, []);
});

test("未知状态诚实落进档案之外：不编造段落也不吞掉可见性", () => {
  const sections = groupTasksForHandle([task(1, "weird")]);
  assert.deepEqual(sections.running, []);
  assert.deepEqual(sections.review, []);
  assert.deepEqual(sections.archive, []);
});

test("把手徽标的活跃数 = 进行中 + 待验收（与左轨公司切换器同一个口径）", () => {
  assert.equal(
    activeCountFor(/** @type {any} */ ({ running: 2, review: 1, done: 9, failed: 3, open: 4 })),
    3,
  );
  assert.equal(activeCountFor({}), 0);
  assert.equal(activeCountFor(null), 0);
});

test("空输入不炸：把手在还没有任何工单时也是三段空列表", () => {
  const sections = groupTasksForHandle(undefined);
  assert.deepEqual(sections.running, []);
  assert.deepEqual(sections.review, []);
  assert.deepEqual(sections.archive, []);
});
