import test from "node:test";
import assert from "node:assert/strict";

import { PLAYBOOKS, classifyPlaybook, draftTask, rejectPrompt, taskPrompt } from "../src/host/task/playbook.mjs";

// A playbook draft is what the 工单台 form prefills: the four playbooks,
// an editable goal, and an editable acceptance-criteria list.

test("classifyPlaybook maps one sentence to the matching playbook", () => {
  assert.equal(classifyPlaybook("给登录页增加一个验证码输入框"), "feature");
  assert.equal(classifyPlaybook("支持导出 PDF"), "feature");
  assert.equal(classifyPlaybook("修复导出报表时的崩溃 bug"), "bugfix");
  assert.equal(classifyPlaybook("导出按钮点了报错，修一下"), "bugfix");
  assert.equal(classifyPlaybook("写一份部署文档"), "docs");
  assert.equal(classifyPlaybook("修改 README 里的安装说明"), "docs");
  assert.equal(classifyPlaybook("把桌面图标按字母顺序摆好"), "free");
  assert.equal(classifyPlaybook("refactor the settings panel"), "feature");
  assert.equal(classifyPlaybook("fix flaky upload test"), "bugfix");
});

test("the playbook roster is exactly 加功能 / 修 bug / 写文档 / 自由", () => {
  assert.deepEqual(
    Object.values(PLAYBOOKS).map((p) => [p.key, p.label]),
    [
      ["feature", "加功能"],
      ["bugfix", "修 bug"],
      ["docs", "写文档"],
      ["free", "自由"],
    ],
  );
});

test("draftTask prefills goal (the sentence) and editable acceptance criteria", () => {
  const draft = draftTask("给登录页增加一个验证码输入框");
  assert.equal(draft.playbook, "feature");
  assert.equal(draft.label, "加功能");
  assert.equal(draft.goal, "给登录页增加一个验证码输入框");
  assert.ok(Array.isArray(draft.acceptance));
  assert.ok(draft.acceptance.length >= 2);
  assert.ok(draft.acceptance.every((item) => typeof item === "string" && item.trim().length > 0));
  // The two criteria of different playbooks differ — they are per-playbook
  // templates the user can edit, not a constant.
  const bug = draftTask("修复导出报表时的崩溃 bug");
  assert.notDeepEqual(bug.acceptance, draft.acceptance);
  assert.ok(bug.acceptance.some((item) => item.includes("复现")));
});

test("taskPrompt composes the playbook contract into one engine prompt", () => {
  const prompt = taskPrompt({
    id: 7,
    playbook: "feature",
    goal: "给登录页加验证码",
    acceptance: ["验证码在页面上可用", "测试通过"],
  });
  assert.ok(prompt.includes("工单 #7"));
  assert.ok(prompt.includes("加功能"));
  assert.ok(prompt.includes("目标：给登录页加验证码"));
  assert.ok(prompt.includes("- 验证码在页面上可用"));
  assert.ok(prompt.includes("- 测试通过"));
  // Employee discipline: the engine commits itself; it must not push.
  assert.ok(prompt.includes("git commit"));
  assert.ok(prompt.includes("不要 push"));
  // The closing-report contract lands in the prompt (ticket 05 四件套).
  assert.ok(prompt.includes("收尾报告"));
  assert.ok(prompt.includes("测试"));
});

test("taskPrompt tolerates an unknown playbook key with the free template", () => {
  const prompt = taskPrompt({ id: 1, playbook: "nope", goal: "把灯关了", acceptance: [] });
  assert.ok(prompt.includes("工单 #1"));
  assert.ok(prompt.includes("目标：把灯关了"));
  assert.ok(prompt.includes("收尾报告"));
});

test("rejectPrompt carries the 打回意见 on top of the same work-order contract (票 06)", () => {
  const task = { id: 7, playbook: "feature", goal: "加欢迎语", acceptance: ["全小写"] };
  const prompt = rejectPrompt(task, "欢迎语没有全小写");
  assert.ok(prompt.includes("工单 #7 · 加功能"), "same task, same contract");
  assert.ok(prompt.includes("【打回意见】"));
  assert.ok(prompt.includes("欢迎语没有全小写"));
  assert.ok(prompt.includes("新一轮"));
  assert.ok(prompt.includes("git commit"));

  // an empty note still says something honest
  assert.ok(rejectPrompt(task, "   ").includes("没有通过验收"));
});
