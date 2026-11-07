import test from "node:test";
import assert from "node:assert/strict";

import { BUDGET_WARN_RATIO, DEFAULT_TASK_TOKEN_BUDGET, budgetState, extendBudgetBy50 } from "../src/host/cost/budget.mjs";

/**
 * 票 12 验收 4：预算软闸的纯状态机。<80% ok；80–99% warn（黄点）；
 * ≥100% exhausted（自动暂停 + 可 +50%）。阈值判定住在这里（可单测），
 * 副作用（pause / 落库）住在 run-manager 与 service。
 */

test("默认预算就是角色 cost.tokenBudgetPerTask（50 万）", () => {
  assert.equal(DEFAULT_TASK_TOKEN_BUDGET, 500_000);
  assert.equal(BUDGET_WARN_RATIO, 0.8);
});

test("below 80% the budget state is ok", () => {
  assert.equal(budgetState(0, 500), "ok");
  assert.equal(budgetState(359, 500), "ok");
  assert.equal(budgetState(399, 500), "ok"); // 79.8%：差一点才到黄点
});

test("at 80% the state flips to warn — the yellow dot", () => {
  assert.equal(budgetState(400, 500), "warn");
  assert.equal(budgetState(499, 500), "warn");
});

test("at 100% the state is exhausted — the auto-pause trigger", () => {
  assert.equal(budgetState(500, 500), "exhausted");
  assert.equal(budgetState(900, 500), "exhausted");
});

test("no budget set never gates (null/undefined/<=0 budget)", () => {
  assert.equal(budgetState(9_999_999, null), "ok");
  assert.equal(budgetState(9_999_999, undefined), "ok");
  assert.equal(budgetState(9_999_999, 0), "ok");
});

test("the +50% button lifts this task's budget to 1.5×, integer-pinned", () => {
  assert.equal(extendBudgetBy50(500_000), 750_000);
  assert.equal(extendBudgetBy50(500), 750);
  assert.equal(extendBudgetBy50(101), 152); // 151.5 → 152，落库保持整数
});

test("after +50% the same spend is no longer exhausted (再跑一段才见顶)", () => {
  const raised = extendBudgetBy50(500);
  assert.equal(budgetState(500, 500), "exhausted");
  assert.equal(budgetState(500, raised), "ok"); // 500/750 = 66.7%：又能跑一段了
  assert.equal(budgetState(749, raised), "warn");
  assert.equal(budgetState(750, raised), "exhausted");
});
