/**
 * 右把手三段分组（票 08 验收 2）— 纯函数，node:test 可跑（与 07 票的
 * scene 层同规）：拉开是「进行中 / 待验收 / 档案」，档案 = done + failed。
 * 待办（open）属于工单台，不进把手；未知状态诚实落空，不编造段落。
 *
 * 分组不改数据：host 的 task.list（公司范围）是唯一数据源，这里只决定读法。
 *
 * @typedef {object} ActiveCounts
 * @property {number} [running]
 * @property {number} [review]
 */

/**
 * @template {{ status: string }} T
 * @param {readonly T[] | null | undefined} tasks
 * @returns {{ running: T[], review: T[], archive: T[] }}
 */
export function groupTasksForHandle(tasks) {
  const sections = { running: /** @type {T[]} */ ([]), review: /** @type {T[]} */ ([]), archive: /** @type {T[]} */ ([]) };
  for (const task of tasks ?? []) {
    if (task.status === "running") sections.running.push(task);
    else if (task.status === "review") sections.review.push(task);
    else if (task.status === "done" || task.status === "failed") sections.archive.push(task);
    // open / 未知状态不进把手三段（待办在工单台；未知状态不假装归类）
  }
  return sections;
}

/**
 * 把手徽标与左轨公司切换器共用的活跃口径：进行中 + 待验收。
 *
 * @param {ActiveCounts | null | undefined} counts
 * @returns {number}
 */
export function activeCountFor(counts) {
  if (!counts) return 0;
  return (counts.running ?? 0) + (counts.review ?? 0);
}
