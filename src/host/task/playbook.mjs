/**
 * Task playbooks — the contract a 工单 puts on a work sentence.
 *
 * One sentence in, and the 工单台 prefills a playbook (加功能 / 修 bug /
 * 写文档 / 自由), a goal and acceptance criteria the boss can edit before
 * dispatch (ticket 05: 一句话自动套 playbook，可手改目标与验收标准).
 *
 * Classification is deliberately deterministic (keywords, not vibes): v1
 * ships without an LLM in the drafting path, and the result is editable
 * anyway. `taskPrompt` is what actually reaches the engine — it carries the
 * goal, the acceptance list, the employee's git discipline (员工自己 commit,
 * never push — the app itself stays read-only), and the closing-report
 * contract that the artifact collector later reads as the report artifact.
 */

/**
 * @typedef {"feature" | "bugfix" | "docs" | "free"} PlaybookKey
 *
 * @typedef {object} Playbook
 * @property {PlaybookKey} key
 * @property {string} label
 * @property {string[]} acceptance acceptance-criteria template (editable copy)
 *
 * @typedef {object} TaskDraft
 * @property {PlaybookKey} playbook
 * @property {string} label
 * @property {string} goal
 * @property {string[]} acceptance
 */

export const PLAYBOOKS = /** @type {const} */ ({
  feature: {
    key: "feature",
    label: "加功能",
    acceptance: [
      "功能完成后能在工作区里被验证（说明验证方式）",
      "相关测试通过；若没跑测试，说明原因",
    ],
  },
  bugfix: {
    key: "bugfix",
    label: "修 bug",
    acceptance: [
      "先复现问题（附复现方式），再修复",
      "修复后相关测试通过，并留有回归防护",
    ],
  },
  docs: {
    key: "docs",
    label: "写文档",
    acceptance: [
      "文档产出位置明确，内容与当前代码一致",
      "没有过时或误导性的描述",
    ],
  },
  free: {
    key: "free",
    label: "自由",
    acceptance: [
      "目标达成且可验证",
      "改动范围尽量小",
    ],
  },
});

/**
 * Ordered keyword rules. Order matters: 修复…文档类句子归修 bug，
 * 「修改 README」没有故障语义所以归写文档。
 */
const CLASSIFIERS = /** @type {const} */ ([
  ["bugfix", /(修复|修一下|修好|报错|出错|崩溃|异常|挂了|坏了|bug|error|fail|broken|fix)/i],
  ["docs", /(文档|说明|手册|README|readme|docs?\b|documentation)/i],
  ["feature", /(加|增|支持|实现|功能|接入|优化|重构|refactor|add|feature|support|implement)/i],
]);

/**
 * @param {string} text one work sentence
 * @returns {PlaybookKey}
 */
export function classifyPlaybook(text) {
  const sentence = String(text ?? "");
  for (const [key, pattern] of CLASSIFIERS) {
    if (pattern.test(sentence)) return key;
  }
  return "free";
}

/**
 * Prefill the 工单 form from one sentence: playbook + editable goal +
 * editable acceptance criteria.
 *
 * @param {string} text
 * @returns {TaskDraft}
 */
export function draftTask(text) {
  const goal = String(text ?? "").trim();
  const playbook = classifyPlaybook(goal);
  const entry = PLAYBOOKS[/** @type {PlaybookKey} */ (playbook)];
  return {
    playbook,
    label: entry.label,
    goal,
    acceptance: entry.acceptance.slice(),
  };
}

/**
 * The engine-facing prompt for a dispatched task: the goal, the acceptance
 * list, and the discipline that makes ticket 05's acceptance hold — the
 * employee runs commands and commits by itself (never pushes), and ends
 * with a 收尾报告 the collector turns into the report artifact.
 *
 * @param {{ id: number, playbook: string, goal: string, acceptance: string[] }} task
 * @returns {string}
 */
export function taskPrompt(task) {
  const entry = PLAYBOOKS[/** @type {PlaybookKey} */ (task.playbook)] ?? PLAYBOOKS.free;
  const acceptance = (Array.isArray(task.acceptance) ? task.acceptance : [])
    .map((line) => `- ${line}`)
    .join("\n");
  return [
    `【工单 #${task.id} · ${entry.label}】`,
    `目标：${task.goal}`,
    "验收标准：",
    acceptance || "- （无附加标准）",
    "",
    "工作方式（必须遵守）：",
    "1. 只在当前工作目录里改动，不要越出工作区。",
    "2. 需要跑命令（测试、查询、提交）就用 bash 工具。",
    "3. 改动完成后你自己提交：git add + git commit，写清楚 commit message；不要 push。",
    "4. 最后一条消息以「收尾报告」开头：完成了什么、变更了哪些文件、测试/命令的输出要点、未尽事项。",
  ].join("\n");
}

/**
 * 打回后续跑的第二把钥匙（票 06）: same task, same employee session, new
 * iteration. The boss's rejection note rides into the prompt so the
 * employee knows exactly what failed 验收 — and the discipline contract
 * (own commits, closing report) stays fully in force.
 *
 * @param {{ id: number, playbook: string, goal: string, acceptance: string[] }} task
 * @param {string} [reason] the boss's 打回意见
 * @returns {string}
 */
export function rejectPrompt(task, reason) {
  const note = String(reason ?? "").trim() || "老板打回了这张工单：产出没有通过验收，需要返工。";
  return [
    taskPrompt(task),
    "",
    "【打回意见】",
    note,
    "",
    "这是打回后的新一轮：先对照上面的打回意见说明上一轮差在哪，再动手修正；改动照旧自己提交，最后仍以「收尾报告」收尾。",
  ].join("\n");
}

/**
 * 崩溃后续跑的第二把钥匙（票 10）: the engine session resumes from its own
 * pointer (断点在引擎侧), so the prompt's job is to tell the employee this is
 * a resumed chapter — take stock of what already exists, continue from the
 * breakpoint, do not redo finished work. The discipline contract stays in
 * force (own commits, closing report).
 *
 * @param {{ id: number, playbook: string, goal: string, acceptance: string[] }} task
 * @returns {string}
 */
export function resumePrompt(task) {
  return [
    taskPrompt(task),
    "",
    "【崩溃续跑】",
    "这张工单的上一轮在应用崩溃/强杀中被中断，工单与引擎会话都保留在现场。",
    "先盘点已经完成的部分（工作区现状、git 历史），从未完成处继续；已经做完的不要重做。",
    "最后仍以「收尾报告」收尾，并说明本轮是从断点继续的。",
  ].join("\n");
}
