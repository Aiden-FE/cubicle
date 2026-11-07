import test from "node:test";
import assert from "node:assert/strict";

import { budgetStateFor, taskBudgetMarker, tokenText } from "../renderer/src/scene/tokenReadout.js";

/**
 * 票 12 验收 3/4：三层可见 + 80%/100% 标记的纯读层（渲染层只展示；
 * 阈值判定与 host cost/budget.mjs 同一口径，这里是镜像不是第二套规则）。
 */

test("未计量就是「未计量」，不是 0（三态读的这半壁）", () => {
  assert.equal(tokenText({ measured: false, total: 0 }), "未计量");
  assert.equal(tokenText({ measured: undefined, total: 0 }), "未计量");
  assert.equal(tokenText(null), "未计量");
  assert.equal(tokenText({ measured: true, total: 0 }), "0"); // 真计量到 0 才显示 0
  assert.equal(tokenText({ measured: true, total: 135 }), "135");
});

test("阈值状态机：<80 ok；80–99 warn；≥100 exhausted；没预算不判", () => {
  assert.equal(budgetStateFor(100, 500), "ok");
  assert.equal(budgetStateFor(399, 500), "ok");
  assert.equal(budgetStateFor(400, 500), "warn");
  assert.equal(budgetStateFor(499, 500), "warn");
  assert.equal(budgetStateFor(500, 500), "exhausted");
  assert.equal(budgetStateFor(900, 500), "exhausted");
  assert.equal(budgetStateFor(900, null), "ok");
  assert.equal(budgetStateFor(900, undefined), "ok");
});

test("任务标记吃 detail 的 tokens/budget：未计量不挂预算标记（没数不判）", () => {
  assert.equal(taskBudgetMarker({ tokens: { measured: false, total: 0 }, budget: 500 }), "ok");
  assert.equal(taskBudgetMarker({ tokens: { measured: true, total: 405 }, budget: 500 }), "warn");
  assert.equal(taskBudgetMarker({ tokens: { measured: true, total: 500 }, budget: 500 }), "exhausted");
  assert.equal(taskBudgetMarker({ tokens: { measured: true, total: 405 }, budget: 750 }), "ok"); // +50% 后再判：405/750 = 54%
  assert.equal(taskBudgetMarker({ tokens: { measured: true, total: 600 }, budget: 750 }), "warn"); // 黄点跟着新预算重算
  assert.equal(taskBudgetMarker(null), "ok");
});
