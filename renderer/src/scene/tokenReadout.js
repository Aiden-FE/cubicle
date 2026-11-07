/**
 * Token readout — pure helpers for the three-level token visibility layer
 * (票 12 验收 3/4). The judgement mirrors host `cost/budget.mjs` (same 80%
 * ratio, same exhausted rule) — this is the display mirror, not a second
 * source of truth for gating; the GATE itself lives in the run manager.
 *
 * @typedef {object} TokenSummary
 * @property {boolean} [measured]
 * @property {number} [total]
 */

export const WARN_RATIO = 0.8;

/**
 * The honest three-state label: 未计量 (no usage ever reported) is NEVER a 0.
 *
 * @param {TokenSummary | null | undefined} summary
 * @returns {string}
 */
export function tokenText(summary) {
  if (!summary || summary.measured !== true) return "未计量";
  return String(summary.total ?? 0);
}

/**
 * @param {number} used
 * @param {number | null | undefined} budget
 * @returns {"ok" | "warn" | "exhausted"}
 */
export function budgetStateFor(used, budget) {
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) return "ok";
  if (used >= budget) return "exhausted";
  if (used >= budget * WARN_RATIO) return "warn";
  return "ok";
}

/**
 * A task's budget marker from the detail payload: no bill (未计量) means no
 * marker — there is no number to judge, and guessing would lie.
 *
 * @param {{ tokens?: TokenSummary, budget?: number | null } | null | undefined} detail
 * @returns {"ok" | "warn" | "exhausted"}
 */
export function taskBudgetMarker(detail) {
  if (!detail) return "ok";
  if (!detail.tokens || detail.tokens.measured !== true) return "ok";
  return budgetStateFor(detail.tokens.total ?? 0, detail.budget);
}
