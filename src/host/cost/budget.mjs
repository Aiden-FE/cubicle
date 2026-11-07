/**
 * Cost — the per-task token soft gate (票 12 验收 4: 80% 黄点、100% 暂停、
 * 一键 +50% 继续).
 *
 * budgetState() is the ONLY threshold judgement: pure and injectable, so
 * the <80 / 80–99 / ≥100 state machine is unit-testable without an engine
 * or a store. Side effects live where they belong — the run manager pauses
 * a run at `exhausted` (reusing 票 09 的 paused 落盘层), the service writes
 * the raised budget to the task row.
 *
 * Budget source (决策 04 / 角色 cost 语义): the role manifest's
 * `cost.tokenBudgetPerTask` is copied onto the task at creation; 「+50%」
 * raises THAT task's budget (1.5×) — never the role template.
 */

export const DEFAULT_TASK_TOKEN_BUDGET = 500_000;
export const BUDGET_WARN_RATIO = 0.8;

/**
 * @typedef {"ok" | "warn" | "exhausted"} BudgetState
 */

/**
 * @param {number} used total tokens spent on the task so far (past runs + live run)
 * @param {unknown} budget the task's token budget (null/<=0 = no gate)
 * @returns {BudgetState}
 */
export function budgetState(used, budget) {
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) return "ok";
  if (used >= budget) return "exhausted";
  if (used >= budget * BUDGET_WARN_RATIO) return "warn";
  return "ok";
}

/**
 * The 「+50%」 step: this task's budget grows to 1.5× (落库、可再审).
 *
 * @param {number} budget
 * @returns {number}
 */
export function extendBudgetBy50(budget) {
  return Math.round(budget * 1.5);
}
