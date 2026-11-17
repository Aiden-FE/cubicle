/**
 * The methods a renderer is allowed to invoke through `window.cubicle`.
 *
 * The host bus is intentionally a string-keyed method table, but the renderer
 * is not the only possible frame: a navigated document or a future webview
 * would inherit the preload bridge. Keep the renderer-reachable surface an
 * explicit allow-list — lifecycle doors (`host.pauseAll` / `host.awaitQuiet` /
 * `host.shutdown`) are main-process-only.
 *
 * Keep this in sync with `src/host/service.mjs`; a new renderer feature that
 * forgets an entry fails closed with `method_not_allowed`, which is visible in
 * the UI, not silent.
 */
export const RENDERER_METHODS = new Set([
  "office.get",
  "office.setActive",
  "company.create",
  "projectGroup.create",
  "role.list",
  "employee.list",
  "employee.hire",
  "employee.setEngine",
  "employee.update",
  "engine.list",
  "engine.enable",
  "engine.probe",
  "engine.overview",
  "model.library",
  "model.provider.save",
  "model.provider.delete",
  "model.model.save",
  "model.model.delete",
  "model.defaults.set",
  "model.test",
  "run.start",
  "run.abort",
  "run.history",
  "task.draft",
  "task.create",
  "task.dispatch",
  "task.accept",
  "task.reject",
  "task.cancel",
  "task.list",
  "task.detail",
  "task.extendBudget",
  "task.gitAudit",
  "task.interrupted.list",
  "task.resume",
  "task.rerun",
  "task.abandon",
  "schedule.get",
  "schedule.set",
  "duty.override",
  // 票 a03: 学院浮层 — 列表 / 装 / 下发（写入全部经 vendored Neo CLI）。
  "academy.snapshot",
  "academy.install",
  "academy.dispatch",
]);

/** Main-process-only methods (never reachable from a renderer). */
export const MAIN_ONLY_METHODS = new Set(["host.pauseAll", "host.awaitQuiet", "host.shutdown"]);
