/**
 * Ticket 08 acceptance runner — 「主界面外壳」, driven from Electron main but
 * parked under scripts/ (main stays business-free).
 *
 * Phase "shell" (one continuous office story in one 1280×800 window):
 *   boot → 左轨四入口可用（公司切换 / 工单台 / 花名册 / 引擎中心）
 *   → 招一名程序员（工单 owner）→ 花名册列出 TA（花名/角色/在岗）
 *   → 引擎中心显示 pi + 配置目录 + 票 11 插槽
 *   → 工单台浮层开合，画布始终满窗（浮层不挤压画布）
 *   → 快活工单跑完点「通过」→ 档案里多一条完成
 *   → 慢活工单跑着：公司切换器显示 A 的活跃数（进行中 1）→ 新建并切到公司 B
 *     （画布仍是 100%，A 的 run 事件继续进 host，taskCounts[A] 跨公司可见）
 *   → 切回 A：四个工位还在、TA 还在岗、工位重新亮「干活」（新事件继续驱动）
 *   → 右把手徽标 = 活跃数；拉开三段：进行中(慢活) / 待验收(空→跑完后) / 档案(快活)
 *   → 慢活跑完自动待验收（把手里段落实时搬家）→ 通过 → 徽标归 0、档案 ×2
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
  sleep,
  waitFor,
  evalIn,
  click,
  typeInto,
  setSelect,
  bootAndShowOffice,
  ensureAllDaySchedule,
  hireThroughWizard,
  seedGitWorkspace,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const EMPLOYEE_NAME = "E2E 外壳员";
const DEFAULT_COMPANY = "默认公司";
const OTHER_COMPANY = "远岸分公司";
const FAST_SENTENCE = "给 greet.txt 加一行欢迎语";
const SLOW_SENTENCE = "写一份慢文档，慢慢来";
const OBSERVATION_TIMEOUT = 90_000;

/** @param {number} taskId */
const ROW_STATUS_JS = (taskId) =>
  `(() => {
    const row = document.querySelector('[data-testid="task-row"][data-task-id="${taskId}"]');
    if (row) return row.dataset.status ?? '';
    const detail = document.querySelector('[data-testid="task-detail"][data-task-id="${taskId}"]');
    return detail ? detail.querySelector('[data-testid="task-status"]')?.dataset.status ?? '' : '';
  })()`;
const DETAIL_STATUS_JS = `document.querySelector('[data-testid="task-status"]')?.dataset.status ?? ''`;

const CANVAS_JS = `(() => {
  const floor = document.querySelector('[data-testid="office-floor"]');
  const room = document.querySelector('[data-testid="room"]');
  return {
    innerW: window.innerWidth, innerH: window.innerHeight,
    floorW: floor ? floor.clientWidth : 0, floorH: floor ? floor.clientHeight : 0,
    roomW: room ? room.clientWidth : 0, roomH: room ? room.clientHeight : 0,
  };
})()`;

/** @param {string} section @returns {string} */
const HANDLE_ROWS_JS = (section) =>
  `Array.from(document.querySelectorAll('[data-testid="${section}"] [data-testid="handle-row"]')).map((el) => el.dataset.taskId).join(',')`;

/**
 * 左轨公司/项目组面板必须真正浮出左轨。只看 getBoundingClientRect 会撒谎 —
 * 祖先 overflow 裁剪时 rect 仍是完整 272px。用 elementFromPoint 打命中测试：
 * 被裁掉/被盖住时命中的是 office-floor，而不是面板内的元素。
 * @param {string} testId
 */
const POPOVER_VISIBLE_JS = (testId) =>
  `(() => {
    const panel = document.querySelector('[data-testid="${testId}"]');
    const rail = document.querySelector('[data-testid="left-rail"]');
    if (!panel || !rail) return { ok: false, reason: 'missing' };
    const r = panel.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(8, r.width / 2));
    const y = Math.round(r.top + Math.min(8, r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      ok: r.width > 200 && r.right > rr.right + 100 && Boolean(hit && panel.contains(hit)),
      left: Math.round(r.left),
      right: Math.round(r.right),
      railRight: Math.round(rr.right),
      hit: hit ? String(hit.className).slice(0, 48) : null,
    };
  })()`;

/**
 * @param {import("electron").WebContents} contents
 * @param {number} taskId
 * @param {string} wanted
 * @param {Set<string>} observed
 * @param {number} timeoutMs
 */
async function waitRowStatus(contents, taskId, wanted, observed, timeoutMs = OBSERVATION_TIMEOUT) {
  return waitFor(
    async () => {
      const status = String(await evalIn(contents, ROW_STATUS_JS(taskId)));
      if (status) observed.add(status);
      return status === wanted;
    },
    { timeoutMs, intervalMs: 300 },
  );
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseShell(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };
  const observed = /** @type {Set<string>} */ (new Set());

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;
  await ensureAllDaySchedule(win.webContents); // 票 09: 默认班表 09:00–18:00 下班中有 off_duty 闸；e2e 全天班表

  // ── 画布基线：1280 窗口里画布满窗，工位房间在主体位置 ──────────────
  const baseCanvas = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  add(
    "窗口 ≈1280 且画布（office-floor）满窗",
    baseCanvas.innerW >= 1200 && baseCanvas.floorW === baseCanvas.innerW && baseCanvas.floorH === baseCanvas.innerH,
    JSON.stringify(baseCanvas),
  );
  add("房间（room）在画布主体位置（宽 500–800）", baseCanvas.roomW >= 500 && baseCanvas.roomW <= 800, `roomW=${baseCanvas.roomW}`);

  // ── 左轨四入口可用 ───────────────────────────────────────────────
  const rail = /** @type {any} */ (
    await evalIn(
      contents,
      `(() => ({
        rail: document.querySelector('[data-testid="left-rail"]') !== null,
        company: document.querySelector('[data-testid="company-switcher"]') !== null,
        bench: document.querySelector('[data-testid="task-rail"]') !== null,
        roster: document.querySelector('[data-testid="rail-roster"]') !== null,
        duty: document.querySelector('[data-testid="rail-duty"]') !== null,
        settings: document.querySelector('[data-testid="settings-open"]') !== null,
        noEngineRail: document.querySelector('[data-testid="rail-engine"]') === null,
        noAboutRail: document.querySelector('[data-testid="rail-about"]') === null,
      }))()`,
    )
  );
  add(
    "左轨四入口 = 公司切换 / 工单台 / 花名册 / 上下班；引擎中心/关于已收进设置",
    rail.rail && rail.company && rail.bench && rail.roster && rail.duty && rail.settings && rail.noEngineRail && rail.noAboutRail,
    JSON.stringify(rail),
  );

  // ── 招一名程序员（工单 owner）───────────────────────────────────
  const hired = await hireThroughWizard(contents, { roleKey: "programmer", employeeName: EMPLOYEE_NAME, backFrom2: false, backFrom3: false });
  add("招聘程序员（工单 owner）", hired.confirmed);
  await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, {
    timeoutMs: 4000,
  });

  const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const companyIdA = Number(snapshot?.activeCompanyId ?? 0);
  const groupIdA = Number(snapshot?.activeGroupId ?? 0);
  const programmer = (snapshot?.desks ?? [])
    .map((/** @type {any} */ d) => d.occupant)
    .find((/** @type {any} */ o) => o?.name === EMPLOYEE_NAME);
  const programmerId = Number(programmer?.id ?? 0);
  add("拿到员工 id", programmerId > 0, `programmer=${programmerId}`);

  const dirs = enginePaths(ctx.dataDir, "pi", programmerId);
  const { headBefore } = seedGitWorkspace(dirs.workspaceDir, execFileSync);
  add("程序员工作区被种成 git 仓库（fixture，非应用行为）", /^[0-9a-f]{40}$/.test(headBefore), `head=${headBefore.slice(0, 7)}`);

  // ── 花名册浮层：花名 / 角色 / 在岗 ──────────────────────────────
  await click(contents, '[data-testid="rail-roster"]');
  const rosterOk = await waitFor(
    async () =>
      (await evalIn(contents, `document.querySelector('[data-testid="roster-panel"]') !== null`)) === true &&
      (await evalIn(contents, `document.querySelector('[data-testid="roster-name"]')?.textContent ?? ''`)).includes(EMPLOYEE_NAME) &&
      (await evalIn(contents, `document.querySelectorAll('[data-testid="roster-row"][data-seated="true"]').length`)) === 1,
    { timeoutMs: 3000 },
  );
  const rosterRole = String(await evalIn(contents, `document.querySelector('[data-testid="roster-row"] .roster-role')?.textContent ?? ''`));
  add("花名册浮层：花名/角色/在岗都在", rosterOk && rosterRole.includes("程序员"), `role=${rosterRole}`);
  await click(contents, '[data-testid="roster-close"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="roster-panel"]')`)) === null, { timeoutMs: 2000 });

  // ── 引擎中心（设置 tab）：引擎名 + 配置目录 + 票 11 插槽 ────────
  await click(contents, '[data-testid="settings-open"]');
  await click(contents, '[data-testid="settings-tab-engine"]');
  const engineOk = await waitFor(
    async () =>
      (await evalIn(contents, `document.querySelector('[data-testid="engine-item"][data-engine="pi"]') !== null`)) === true &&
      (await evalIn(contents, `document.querySelector('[data-testid="engine-card-slot"]') !== null`)) === true,
    { timeoutMs: 3000 },
  );
  const engineConfigDir = String(await evalIn(contents, `document.querySelector('[data-testid="engine-item"][data-engine="pi"] [data-testid="engine-config-dir"]')?.textContent ?? ''`)).replace(/\\/g, "/");
  add(
    "引擎中心：pi 出现 + 配置目录路径（数据目录/engines/pi）+ 票 11 引擎卡插槽",
    engineOk && engineConfigDir.includes("engines/pi") && engineConfigDir.includes(ctx.dataDir.replace(/\\/g, "/")),
    engineConfigDir,
  );
  await click(contents, '[data-testid="settings-close"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="settings-modal"]')`)) === null, { timeoutMs: 2000 });

  // ── 工单台浮层：开合都不改变画布尺寸 ────────────────────────────
  await click(contents, '[data-testid="task-rail"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-bench"]') !== null`)) === true, { timeoutMs: 3000 });
  const canvasWithBench = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  add(
    "工单台以浮层出现：画布仍满窗、房间尺寸不变",
    canvasWithBench.floorW === canvasWithBench.innerW && canvasWithBench.roomW === baseCanvas.roomW,
    JSON.stringify(canvasWithBench),
  );

  // ── 快活工单：跑完 → 通过 → 档案 ────────────────────────────────
  await typeInto(contents, '[data-testid="task-sentence"]', FAST_SENTENCE);
  await waitFor(async () => String(await evalIn(contents, `document.querySelector('[data-testid="task-playbook"]')?.textContent ?? ''`)).includes("加功能"), { timeoutMs: 3000 });
  await setSelect(contents, '[data-testid="task-employee"]', String(programmerId));
  await click(contents, '[data-testid="task-dispatch"]');
  // task.create is async now (git is async); the direct list probe must wait
  // for the row to land instead of racing the create.
  await waitFor(async () => {
    const list = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${groupIdA} })`));
    return (list?.tasks ?? []).length > 0;
  }, { timeoutMs: 5000 });
  const fastList = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${groupIdA} })`));
  const fastTaskId = Number((fastList?.tasks ?? [])[0]?.id ?? 0);
  add("快活工单已派出", fastTaskId > 0, `taskId=${fastTaskId}`);
  const fastRunning = await waitRowStatus(contents, fastTaskId, "running", observed);
  add("快活工单进入「进行中」", fastRunning);
  const fastReview = await waitRowStatus(contents, fastTaskId, "review", observed);
  add("快活工单跑完自动进入「待验收」", fastReview);
  await click(contents, `[data-testid="task-row"][data-task-id="${fastTaskId}"]`);
  await waitFor(async () => (await evalIn(contents, DETAIL_STATUS_JS)) === "review", { timeoutMs: 3000 });
  await click(contents, '[data-testid="task-accept"]');
  const fastDone = await waitFor(async () => (await evalIn(contents, DETAIL_STATUS_JS)) === "done", { timeoutMs: 10_000 });
  add("点通过 → 完成（给档案段留一条 done）", fastDone);
  observed.add("done");
  await click(contents, '[data-testid="task-back"]');

  // ── 慢活工单跑着：公司 A → 公司 B → 公司 A，后台任务不受影响 ────
  await typeInto(contents, '[data-testid="task-sentence"]', SLOW_SENTENCE);
  await waitFor(async () => String(await evalIn(contents, `document.querySelector('[data-testid="task-playbook"]')?.textContent ?? ''`)).includes("写文档"), { timeoutMs: 3000 });
  await setSelect(contents, '[data-testid="task-employee"]', String(programmerId));
  await click(contents, '[data-testid="task-dispatch"]');
  await waitFor(async () => {
    const list = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${groupIdA} })`));
    return (list?.tasks ?? []).some((/** @type {any} */ t) => t.title === SLOW_SENTENCE);
  }, { timeoutMs: 5000 });
  const slowList = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('task.list', { groupId: ${groupIdA} })`));
  const slowTask = (slowList?.tasks ?? []).find((/** @type {any} */ t) => t.title === SLOW_SENTENCE);
  const slowTaskId = Number(slowTask?.id ?? 0);
  add("慢活工单已派出", slowTaskId > 0, `taskId=${slowTaskId}`);
  const slowRunning = await waitRowStatus(contents, slowTaskId, "running", observed, 20_000);
  add("慢活工单进入「进行中」（接下来全程它在跑）", slowRunning);

  // 右把手：徽标 + 三段（进行中=慢活，档案=快活 done，待验收=空）
  const badgeWhileRunning = String(await evalIn(contents, `document.querySelector('[data-testid="handle-active"]')?.textContent ?? ''`));
  add("右把手徽标显示活跃工单数（进行中+待验收 = 1）", badgeWhileRunning === "1", `badge=${badgeWhileRunning}`);
  await click(contents, '[data-testid="task-handle"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="handle-drawer"]') !== null`)) === true, { timeoutMs: 3000 });
  // 抽屉挂载后自己拉一次 task.list（公司范围）— 轮询等数据到位，别读空壳。
  /** @type {{ running: string, review: string, archive: string }} */
  let handleRows = { running: "", review: "", archive: "" };
  const handleMembership = await waitFor(
    async () => {
      handleRows = {
        running: String(await evalIn(contents, HANDLE_ROWS_JS("handle-running"))),
        review: String(await evalIn(contents, HANDLE_ROWS_JS("handle-review"))),
        archive: String(await evalIn(contents, HANDLE_ROWS_JS("handle-archive"))),
      };
      return handleRows.running.includes(String(slowTaskId)) && handleRows.review.length === 0 && handleRows.archive.includes(String(fastTaskId));
    },
    { timeoutMs: 6000, intervalMs: 200 },
  );
  add(
    "把手三段：进行中=慢活 / 待验收=空 / 档案=完成的那条",
    handleMembership,
    `running=${handleRows.running} review=${handleRows.review} archive=${handleRows.archive}`,
  );
  const canvasBothOverlays = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  add(
    "工单台 + 把手浮层同时开着：画布仍满窗、房间尺寸不变（1280 布局不破）",
    canvasBothOverlays.floorW === canvasBothOverlays.innerW && canvasBothOverlays.floorH === canvasBothOverlays.innerH && canvasBothOverlays.roomW === baseCanvas.roomW,
    JSON.stringify(canvasBothOverlays),
  );
  await click(contents, '[data-testid="handle-close"]');

  // 公司切换器：显示各公司活跃数（A：进行中 1）
  await click(contents, '[data-testid="task-close"]'); // 关掉工单台，左轨可达
  await click(contents, '[data-testid="company-switcher"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="company-panel"]') !== null`)) === true, { timeoutMs: 3000 });
  const companyPopover = /** @type {any} */ (await evalIn(contents, POPOVER_VISIBLE_JS("company-panel")));
  add("公司面板浮出左轨、可命中（不被滚动容器的 overflow 裁成细条）", companyPopover?.ok === true, JSON.stringify(companyPopover));

  // 项目组面板共用同一套弹出位置，同样必须跳出左轨
  await click(contents, '[data-testid="group-switcher"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="group-panel"]') !== null`)) === true, { timeoutMs: 3000 });
  const groupPopover = /** @type {any} */ (await evalIn(contents, POPOVER_VISIBLE_JS("group-panel")));
  add("项目组面板浮出左轨、可命中", groupPopover?.ok === true, JSON.stringify(groupPopover));
  await click(contents, '[data-testid="company-switcher"]'); // 回到公司面板继续新建公司
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="company-panel"]') !== null`)) === true, { timeoutMs: 3000 });

  const companyCounts = /** @type {any} */ (
    await evalIn(
      contents,
      `(() => {
        const items = Array.from(document.querySelectorAll('[data-testid="company-item"]'));
        const item = items.find((el) => el.textContent.trim().startsWith(${JSON.stringify(DEFAULT_COMPANY)}));
        return item ? { running: item.dataset.running, review: item.dataset.review, text: item.textContent } : null;
      })()`,
    )
  );
  add(
    "公司切换器显示各公司活跃数（默认公司：进行中 1 · 待验收 0）",
    companyCounts?.running === "1" && companyCounts?.review === "0",
    JSON.stringify(companyCounts),
  );

  // 新建并切到公司 B（创建即切换）；画布满窗、A 的 run 继续进 host
  await typeInto(contents, '[data-testid="company-name-input"]', OTHER_COMPANY);
  await click(contents, '[data-testid="company-create"]');
  const bShown = await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"]').length`)) === 0, { timeoutMs: 5000 });
  const snapshotB = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
  const companyIdB = Number((snapshotB?.companies ?? []).find((/** @type {any} */ c) => c.name === OTHER_COMPANY)?.id ?? snapshotB?.activeCompanyId ?? 0);
  add("新建公司并切过去：画布切到 B 的空办公室（0 工位）", bShown && snapshotB?.activeCompanyId === companyIdB, `companyB=${companyIdB}`);
  const canvasB = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  add("切到 B（还没有任何组的画布）也仍 100% 满窗", canvasB.floorW === canvasB.innerW && canvasB.floorH === canvasB.innerH, JSON.stringify(canvasB));

  const eventsBefore = Number(
    await evalIn(contents, `(async () => (await window.cubicle.invoke('run.history', { employeeId: ${programmerId} })).events.length)()`),
  );
  await sleep(3000);
  const eventsAfter = Number(
    await evalIn(contents, `(async () => (await window.cubicle.invoke('run.history', { employeeId: ${programmerId} })).events.length)()`),
  );
  const lastRunInB = String(
    await evalIn(contents, `(async () => (await window.cubicle.invoke('run.history', { employeeId: ${programmerId} })).lastRun?.status ?? '')()`),
  );
  add(
    "在 B 视图里，A 的 run 事件继续进 host：事件数增长且 run 仍在 running",
    eventsAfter > eventsBefore && lastRunInB === "running",
    `events=${eventsBefore}→${eventsAfter} lastRun=${lastRunInB}`,
  );
  const countsInB = /** @type {any} */ (snapshotB?.taskCounts?.[String(companyIdA)] ?? null);
  add("切到 B 后 A 的活跃数照样可见（taskCounts[A].running=1）", countsInB?.running === 1, JSON.stringify(countsInB));

  // 切回 A：工位/工单状态正确，工位重新亮「干活」（新事件继续驱动）
  await click(contents, '[data-testid="company-switcher"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="company-panel"]') !== null`)) === true, { timeoutMs: 3000 });
  await evalIn(
    contents,
    `(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="company-item"]'));
      const item = items.find((el) => el.textContent.trim().startsWith(${JSON.stringify(DEFAULT_COMPANY)}));
      item?.click();
    })()`,
  );
  const backToA = await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"]').length`)) === 4, { timeoutMs: 5000 });
  add("切回 A：四个工位回来了", backToA);
  const busyAgain = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="desk"][data-empty="false"]')?.dataset.busy ?? ''`)) === "true",
    { timeoutMs: 12_000, intervalMs: 300 },
  );
  add("切回后工位状态正确：TA 还在岗，且继续被真实事件点亮「干活」", busyAgain);
  const seatName = String(
    await evalIn(
      contents,
      `document.querySelector('[data-testid="desk"][data-empty="false"]')?.getAttribute('title') ?? ''`,
    ),
  );
  add("工位 occupant 仍是同一名员工", seatName.includes(EMPLOYEE_NAME), seatName);

  // 工单重开：慢活还在「进行中」→ 跑完自动「待验收」；把手段落实时搬家
  await click(contents, '[data-testid="task-rail"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="task-bench"]') !== null`)) === true, { timeoutMs: 3000 });
  const stillRunning = await waitFor(async () => (await evalIn(contents, ROW_STATUS_JS(slowTaskId))) === "running", { timeoutMs: 4000 });
  add("切公司没打断工单：切回后慢活仍是「进行中」", stillRunning);
  const slowReview = await waitRowStatus(contents, slowTaskId, "review", observed, 60_000);
  add("慢活工单在切公司往返之后照常跑完，自动进入「待验收」", slowReview);

  await click(contents, '[data-testid="task-handle"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="handle-drawer"]') !== null`)) === true, { timeoutMs: 3000 });
  const movedToReview = await waitFor(
    async () =>
      (await evalIn(contents, HANDLE_ROWS_JS("handle-review"))).includes(String(slowTaskId)) &&
      !(await evalIn(contents, HANDLE_ROWS_JS("handle-running"))).includes(String(slowTaskId)),
    { timeoutMs: 5000 },
  );
  add("把手三段实时搬家：慢活从「进行中」进「待验收」", movedToReview,
    `running=${await evalIn(contents, HANDLE_ROWS_JS("handle-running"))} review=${await evalIn(contents, HANDLE_ROWS_JS("handle-review"))}`);
  const badgeReview = String(await evalIn(contents, `document.querySelector('[data-testid="handle-active"]')?.textContent ?? ''`));
  add("徽标随状态更新（待验收 1 → 仍活跃 = 1）", badgeReview === "1", `badge=${badgeReview}`);
  await click(contents, '[data-testid="handle-close"]');

  // 通过：档案 ×2、徽标归 0
  await click(contents, `[data-testid="task-row"][data-task-id="${slowTaskId}"]`);
  await waitFor(async () => (await evalIn(contents, DETAIL_STATUS_JS)) === "review", { timeoutMs: 3000 });
  await click(contents, '[data-testid="task-accept"]');
  const slowDone = await waitFor(async () => (await evalIn(contents, DETAIL_STATUS_JS)) === "done", { timeoutMs: 10_000 });
  add("慢活也通过 → 完成", slowDone);
  observed.add("done");
  const badgeFinal = String(await evalIn(contents, `document.querySelector('[data-testid="handle-active"]')?.textContent ?? ''`));
  add("全部处理完：把手徽标归 0（没有进行中和待验收）", badgeFinal === "0", `badge=${badgeFinal}`);
  await click(contents, '[data-testid="task-handle"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="handle-drawer"]') !== null`)) === true, { timeoutMs: 3000 });
  let archiveFinal = "";
  const archiveOk = await waitFor(
    async () => {
      archiveFinal = String(await evalIn(contents, HANDLE_ROWS_JS("handle-archive")));
      return archiveFinal.includes(String(fastTaskId)) && archiveFinal.includes(String(slowTaskId));
    },
    { timeoutMs: 6000, intervalMs: 250 },
  );
  add("档案段收齐两条完成的工单", archiveOk, `archive=${archiveFinal}`);
  const finalCanvas = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  add("收尾画布仍满窗（布局从头到尾没被浮层挤过）", finalCanvas.floorW === finalCanvas.innerW && finalCanvas.roomW === baseCanvas.roomW, JSON.stringify(finalCanvas));

  const missing = ["running", "review", "done"].filter((state) => !observed.has(state));
  add("把手/工单台把 进行中/待验收/完成 都在界面上展示过", missing.length === 0, `observed=${[...observed].join(",")}`);

  return {
    checks,
    evidence: {
      companyIdA,
      companyIdB,
      groupIdA,
      programmerId,
      fastTaskId,
      slowTaskId,
      headBefore,
      workspaceDir: dirs.workspaceDir,
      eventsBefore,
      eventsAfter,
      badgeWhileRunning,
      badgeReview,
      badgeFinal,
      canvas: { baseCanvas, canvasWithBench, canvasBothOverlays, canvasB, finalCanvas },
      observed: [...observed],
    },
  };
}

/**
 * @typedef {object} E2EContext
 * @property {import("electron").App} app
 * @property {() => import("electron").BrowserWindow | null} getMainWindow
 * @property {{ state: string, pid: number | null, send: (m: unknown) => boolean }} supervisor
 * @property {string} dataDir
 * @property {number} bootStartMs
 * @property {string} phase
 * @property {string} outDir
 */

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    outcome = await phaseShell(ctx);
  } catch (err) {
    outcome.checks.push({ name: "unexpected error", ok: false, detail: String(err) });
  }

  const allOk = outcome.checks.length > 0 && outcome.checks.every((check) => check.ok);
  for (const check of outcome.checks) {
    out(`E2E ${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  mkdirSync(ctx.outDir, { recursive: true });
  await writeFile(
    path.join(ctx.outDir, `${ctx.phase}.json`),
    `${JSON.stringify({ phase: ctx.phase, allOk, ...outcome }, null, 2)}\n`,
    "utf8",
  );
  return allOk ? 0 : 1;
}
