/**
 * Ticket 08 acceptance runner — 「主界面外壳」, driven from Electron main but
 * parked under scripts/ (main stays business-free).
 *
 * Phase "shell" (one continuous office story in one 1280×800 window):
 *   boot → 左轨入口可用（公司切换 / 工单台 / 花名册 / 引擎中心）
 *   → 招一名程序员（工单 owner）→ 花名册列出 TA（花名/角色/在岗）
 *   → 引擎中心显示 pi + 配置目录 + 票 11 插槽
 *   → 工单台浮层开合，画布始终满窗（浮层不挤压画布）
 *   → 快活工单跑完点「通过」→ 档案里多一条完成
 *   → 慢活工单跑着：公司切换器显示 A 的活跃数（进行中 1）→ 新建并切到公司 B
 *     （画布仍是 100%，A 的 run 事件继续进 host，taskCounts[A] 跨公司可见）
 *   → 切回 A：八个工位还在、TA 还在岗、工位重新亮「干活」（新事件继续驱动）
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
  const rr = room?.getBoundingClientRect();
  return {
    innerW: window.innerWidth, innerH: window.innerHeight,
    floorW: floor ? floor.clientWidth : 0, floorH: floor ? floor.clientHeight : 0,
    roomW: room ? room.clientWidth : 0, roomH: room ? room.clientHeight : 0,
    roomRectW: rr ? Math.round(rr.width) : 0, roomRectH: rr ? Math.round(rr.height) : 0,
  };
})()`;

const VIEW_JS = `(() => {
  const room = document.querySelector('[data-testid="room"]');
  const controls = document.querySelector('[data-testid="zoom-controls"]');
  const settings = document.querySelector('[data-testid="settings-open"]');
  const percent = document.querySelector('[data-testid="zoom-percent"]');
  const desk = document.querySelector('[data-testid="desk"]');
  const hit = desk?.querySelector('[data-testid="desk-hit"]');
  const rr = room?.getBoundingClientRect();
  const cr = controls?.getBoundingClientRect();
  const sr = settings?.getBoundingClientRect();
  const hr = hit?.getBoundingClientRect();
  const dr = desk?.getBoundingClientRect();
  const inside = (outer, inner) => outer && inner
    ? inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom
    : false;
  return {
    inner: [window.innerWidth, window.innerHeight],
    room: rr ? [Math.round(rr.width), Math.round(rr.height), Math.round(rr.left), Math.round(rr.top)] : null,
    controls: cr ? [Math.round(cr.left), Math.round(cr.top), Math.round(cr.right), Math.round(cr.bottom)] : null,
    settings: sr ? [Math.round(sr.left), Math.round(sr.top), Math.round(sr.right), Math.round(sr.bottom)] : null,
    percent: percent?.textContent ?? '',
    zoom: room?.dataset.zoom ?? '',
    canIn: !document.querySelector('[data-testid="zoom-in"]')?.disabled,
    canOut: !document.querySelector('[data-testid="zoom-out"]')?.disabled,
    hit: hr ? [Math.round(hr.width), Math.round(hr.height)] : null,
    deskCard: dr ? [Math.round(dr.width), Math.round(dr.height)] : null,
    controlsInsideRoom: inside(rr, cr),
    overlapSettings: cr && sr
      ? !(cr.right <= sr.left || cr.left >= sr.right || cr.bottom <= sr.top || cr.top >= sr.bottom)
      : null,
    labels: [...document.querySelectorAll('[data-testid="desk"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return [Number(el.dataset.deskId), Math.round(r.left), Math.round(r.top)];
    }),
  };
})()`;

const ZOOM_JS = `document.querySelector('[data-testid="zoom-percent"]')?.textContent ?? ''`;

/**
 * Best-effort screenshot. A service-session Electron may have no display
 * surface; assertions still decide the run, the image is human evidence.
 * @param {E2EContext} ctx @param {import("electron").BrowserWindow} win @param {string} name
 */
async function shot(ctx, win, name) {
  try {
    const image = await win.webContents.capturePage();
    await writeFile(path.join(ctx.outDir, `${name}.png`), image.toPNG());
    return `${name}.png`;
  } catch (err) {
    out(`E2E WARN screenshot ${name} failed: ${String(err)}`);
    return null;
  }
}

/** @param {import("electron").BrowserWindow} win @param {number} width @param {number} height */
async function resizeWindow(win, width, height) {
  win.setSize(width, height);
  await sleep(900);
}

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
  /** @returns {Promise<any>} */
  const readView = async () => /** @type {any} */ (await evalIn(contents, VIEW_JS));
  /**
   * @param {(view: any) => boolean} predicate
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  const waitView = async (predicate, timeoutMs = 2000) => {
    let latest = await readView();
    await waitFor(
      async () => {
        latest = await readView();
        return predicate(latest);
      },
      { timeoutMs },
    );
    return latest;
  };
  await ensureAllDaySchedule(win.webContents); // 票 09: 默认班表 09:00–18:00 下班中有 off_duty 闸；e2e 全天班表

  // ── 画布基线：1280 窗口里画布满窗，工位房间在主体位置 ──────────────
  const baseCanvas = /** @type {any} */ (await evalIn(contents, CANVAS_JS));
  add(
    "窗口 ≈1280 且画布（office-floor）满窗",
    baseCanvas.innerW >= 1200 && baseCanvas.floorW === baseCanvas.innerW && baseCanvas.floorH === baseCanvas.innerH,
    JSON.stringify(baseCanvas),
  );
  add(
    "默认 1280×800 房间铺满主体（≥1000×680）",
    baseCanvas.roomRectW >= 1000 && baseCanvas.roomRectH >= 680,
    JSON.stringify(baseCanvas),
  );

  // ── 左轨入口可用 ───────────────────────────────────────────────
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
    "左轨入口 = 公司切换 / 工单台 / 花名册 / 上下班；引擎中心/关于已收进设置",
    rail.rail && rail.company && rail.bench && rail.roster && rail.duty && rail.settings && rail.noEngineRail && rail.noAboutRail,
    JSON.stringify(rail),
  );

  // ── 3D 场景：WebGL 画布、8 个工位、咖啡机/饮水机 ───────────────
  const scene3d = await waitFor(
    async () => {
      const state = /** @type {any} */ (
        await evalIn(
          contents,
          `(() => ({
            canvas: document.querySelector('[data-testid="office-3d"] canvas') !== null,
            canvasW: document.querySelector('[data-testid="office-3d"] canvas')?.clientWidth ?? 0,
            desks: document.querySelectorAll('[data-testid="desk"]').length,
            labels: document.querySelectorAll('.amenity-tag, [data-testid="desk-occupant"], [data-testid="desk-light"]').length,
          }))()`,
        )
      );
      return state.canvas && state.canvasW > 0 && state.desks === 8 && state.labels === 0 ? state : null;
    },
    { timeoutMs: 8000 },
  );
  add(
    "3D 办公室：WebGL 画布 + 8 工位，且场景内没有任何文字标签（票 18）",
    Boolean(scene3d),
    JSON.stringify(scene3d),
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

  // ── 票 16：窗口自适应 + 放大/滚轮/平移/复位 ─────────────────────
  const initialView = await waitView((view) => view.percent === "100%" && Boolean(view.room) && Boolean(view.controls), 3000);
  add(
    "缩放控件在房间右上角、默认 100%、减号禁用，不遮设置",
    initialView.controlsInsideRoom === true &&
      initialView.overlapSettings === false &&
      initialView.canIn === true &&
      initialView.canOut === false,
    JSON.stringify(initialView),
  );
  await shot(ctx, win, "16-zoom-1280-fit");

  await click(contents, '[data-testid="zoom-in"]');
  const afterButton = await waitView((view) => view.percent === "125%");
  add(
    "加号把相机推到 125%，房间外框不变",
    afterButton.room[0] === initialView.room[0] && afterButton.canOut === true,
    JSON.stringify(afterButton),
  );

  await click(contents, '[data-testid="zoom-in"]'); // 156%: enough separation for wheel/anchor tests
  const wheelPoint = await evalIn(
    contents,
    `(() => {
      const desk = document.querySelector('[data-testid="desk"][data-desk-id="1"]');
      const r = desk.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`,
  );
  const beforeWheel = /** @type {any} */ (await evalIn(contents, VIEW_JS));
  await evalIn(
    contents,
    `(() => {
      const room = document.querySelector('[data-testid="room"]');
      room.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -240, deltaMode: 0, clientX: ${wheelPoint.x}, clientY: ${wheelPoint.y},
        bubbles: true, cancelable: true,
      }));
      return true;
    })()`,
  );
  const afterWheel = await waitView((view) => view.percent !== beforeWheel.percent);
  const wheelDeskBefore = beforeWheel.labels.find((/** @type {any} */ row) => row[0] === 1);
  const wheelDeskAfter = afterWheel.labels.find((/** @type {any} */ row) => row[0] === 1);
  const anchorDrift = wheelDeskBefore && wheelDeskAfter
    ? Math.hypot(wheelDeskAfter[1] - wheelDeskBefore[1], wheelDeskAfter[2] - wheelDeskBefore[2])
    : 999;
  add(
    "房间内滚轮放大，鼠标所在工位的投影基本不漂移",
    anchorDrift <= 26,
    `percent=${beforeWheel.percent}→${afterWheel.percent} drift=${Math.round(anchorDrift)}`,
  );
  await shot(ctx, win, "16-zoom-1280-detail");

  const beforeOutsideWheel = String(await evalIn(contents, ZOOM_JS));
  await evalIn(
    contents,
    `(() => {
      document.querySelector('[data-testid="left-rail"]').dispatchEvent(new WheelEvent("wheel", {
        deltaY: -240, deltaMode: 0, clientX: 40, clientY: 300, bubbles: true, cancelable: true,
      }));
      return true;
    })()`,
  );
  await sleep(250);
  add("滚轮离开房间不缩放", String(await evalIn(contents, ZOOM_JS)) === beforeOutsideWheel, `${beforeOutsideWheel}→${await evalIn(contents, ZOOM_JS)}`);

  const beforePan = /** @type {any} */ (await evalIn(contents, VIEW_JS));
  const panPoint = await evalIn(
    contents,
    `(() => {
      const desk = document.querySelector('[data-testid="desk"][data-empty="true"]');
      const r = desk.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: Number(desk.dataset.deskId) };
    })()`,
  );
  await evalIn(
    contents,
    `(() => {
      const desk = document.querySelector('[data-testid="desk"][data-empty="true"]');
      desk.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, pointerId: 42, button: 0, buttons: 1,
        clientX: ${panPoint.x}, clientY: ${panPoint.y},
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, cancelable: true, pointerId: 42, buttons: 1,
        clientX: ${panPoint.x + 72}, clientY: ${panPoint.y + 34},
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, pointerId: 42, button: 0,
        clientX: ${panPoint.x + 72}, clientY: ${panPoint.y + 34},
      }));
      desk.click(); // immediate post-drag click must be swallowed
      return true;
    })()`,
  );
  const afterPan = await waitView((view) => {
    const row = view.labels.find((/** @type {any} */ entry) => entry[0] === panPoint.id);
    const beforeRow = beforePan.labels.find((/** @type {any} */ entry) => entry[0] === panPoint.id);
    return Boolean(row && beforeRow && row[1] !== beforeRow[1]);
  });
  const noAccidentalModal = await waitFor(
    async () =>
      (await evalIn(contents, `document.querySelector('[data-testid="hire-modal"]') === null`)) === true,
    { timeoutMs: 1000 },
  );
  const panRowBefore = beforePan.labels.find((/** @type {any} */ entry) => entry[0] === panPoint.id);
  const panRowAfter = afterPan.labels.find((/** @type {any} */ entry) => entry[0] === panPoint.id);
  const panDrift = panRowBefore && panRowAfter ? Math.hypot(panRowAfter[1] - panRowBefore[1], panRowAfter[2] - panRowBefore[2]) : 0;
  add("放大后拖动任意工位可平移，拖动结束不触发点选", panDrift > 20 && noAccidentalModal, `drift=${Math.round(panDrift)}`);

  await click(contents, '[data-testid="desk"][data-empty="true"]');
  const normalClickOpens = await waitFor(
    async () => (await evalIn(contents, `document.querySelector('[data-testid="hire-modal"]') !== null`)) === true,
    { timeoutMs: 2000 },
  );
  add("拖动判定只有超过 5px 才吞点击；普通点击仍打开招聘", normalClickOpens);
  await click(contents, '[data-testid="hire-close"]');
  await waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="hire-modal"]')`)) === null, { timeoutMs: 2000 });

  await click(contents, '[data-testid="zoom-fit"]');
  const resetView = await waitView((view) => view.percent === "100%");
  const deskAt100Before = /** @type {any} */ (await evalIn(contents, VIEW_JS)).labels;
  await evalIn(
    contents,
    `(() => {
      const desk = document.querySelector('[data-testid="desk"][data-empty="true"]');
      const r = desk.getBoundingClientRect();
      desk.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, pointerId: 43, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, cancelable: true, pointerId: 43, buttons: 1,
        clientX: Math.round(r.left + r.width / 2) + 80, clientY: Math.round(r.top + r.height / 2) + 40,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 43, button: 0 }));
      return true;
    })()`,
  );
  await sleep(300);
  const deskAt100After = /** @type {any} */ (await evalIn(contents, VIEW_JS)).labels;
  add(
    "100% 时拖动不平移，适应后回到全景",
    Boolean(resetView) && JSON.stringify(deskAt100Before) === JSON.stringify(deskAt100After) && resetView.canOut === false,
    JSON.stringify({ before: deskAt100Before, after: deskAt100After }),
  );

  const keyBefore = String(await evalIn(contents, ZOOM_JS));
  await evalIn(contents, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true })); true`);
  await sleep(200);
  add("没有全局 +/- 键盘缩放（输入框不会被劫持）", String(await evalIn(contents, ZOOM_JS)) === keyBefore, `${keyBefore}→${await evalIn(contents, ZOOM_JS)}`);

  for (let i = 0; i < 8; i += 1) await click(contents, '[data-testid="zoom-in"]');
  const maxView = await waitView((view) => view.percent === "400%", 3000);
  const maxHitOwners = /** @type {any[]} */ (
    await evalIn(
      contents,
      `(() => {
        const room = document.querySelector('[data-testid="room"]').getBoundingClientRect();
        return [...document.querySelectorAll('[data-testid="desk"]')].map((desk) => {
          const r = desk.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          if (cx < room.left || cx > room.right || cy < room.top || cy > room.bottom) return { id: Number(desk.dataset.deskId), visible: false, owner: null };
          const hit = document.elementFromPoint(cx, cy);
          return { id: Number(desk.dataset.deskId), visible: true, owner: Number(hit?.closest('[data-testid="desk"]')?.dataset.deskId ?? 0) };
        });
      })()`,
    )
  );
  const visibleHits = maxHitOwners.filter((row) => row.visible);
  add(
    "倍率封顶 400%，加号禁用；放大后每个可见工位中心仍命中自己（热区不串桌）",
    maxView.canIn === false &&
      maxView.canOut === true &&
      maxView.hit[0] > maxView.deskCard[0] &&
      visibleHits.length >= 2 &&
      visibleHits.every((row) => row.owner === row.id),
    JSON.stringify({ maxView, visibleHits }),
  );

  await click(contents, '[data-testid="zoom-fit"]');
  await waitFor(async () => String(await evalIn(contents, ZOOM_JS)) === "100%", { timeoutMs: 2000 });

  await click(contents, '[data-testid="zoom-in"]');
  await waitFor(async () => String(await evalIn(contents, ZOOM_JS)) === "125%", { timeoutMs: 2000 });
  await resizeWindow(win, 1920, 1080);
  const largeView = /** @type {any} */ (await evalIn(contents, VIEW_JS));
  add(
    "1920×1080 房间≥1400×950，放大倍率在 resize 后保留",
    largeView.room[0] >= 1400 && largeView.room[1] >= 950 && largeView.percent === "125%" && largeView.controlsInsideRoom === true,
    JSON.stringify(largeView),
  );
  await shot(ctx, win, "16-zoom-1920-125");
  await click(contents, '[data-testid="zoom-fit"]');
  await waitFor(async () => String(await evalIn(contents, ZOOM_JS)) === "100%", { timeoutMs: 2000 });
  const largeFit = /** @type {any} */ (await evalIn(contents, VIEW_JS));
  add("1920×1080 适应后仍是 100% 且控件不遮设置", largeFit.percent === "100%" && largeFit.overlapSettings === false, JSON.stringify(largeFit));
  await shot(ctx, win, "16-zoom-1920-fit");

  await resizeWindow(win, 900, 600);
  const smallView = await waitView((view) => {
    const inRoom = (/** @type {any[]} */ row) => {
      const cx = row[1] + 85;
      const cy = row[2] + 76;
      return cx >= view.room[2] && cx <= view.room[2] + view.room[0] && cy >= view.room[3] && cy <= view.room[3] + view.room[1];
    };
    return view.room[0] >= 700 &&
      view.room[1] >= 480 &&
      view.controlsInsideRoom === true &&
      view.overlapSettings === false &&
      view.labels.every(inRoom);
  });
  add(
    "900×600 最小窗房间≥700×480，控件不溢出、不遮设置；投影标签跟到新视口",
    smallView.room[0] >= 700 &&
      smallView.room[1] >= 480 &&
      smallView.controlsInsideRoom === true &&
      smallView.overlapSettings === false &&
      smallView.labels.every((/** @type {any[]} */ row) => {
        const cx = row[1] + 85;
        const cy = row[2] + 76;
        return cx >= smallView.room[2] && cx <= smallView.room[2] + smallView.room[0] && cy >= smallView.room[3] && cy <= smallView.room[3] + smallView.room[1];
      }),
    JSON.stringify(smallView),
  );
  await shot(ctx, win, "16-zoom-900");

  await resizeWindow(win, 1280, 800);
  const restoredView = /** @type {any} */ (await evalIn(contents, VIEW_JS));
  add(
    "窗口恢复 1280×800 后房间回到基线，缩放仍是 100%",
    restoredView.room[0] === baseCanvas.roomRectW && restoredView.room[1] === baseCanvas.roomRectH && restoredView.percent === "100%",
    JSON.stringify({ restored: restoredView.room, baseline: [baseCanvas.roomRectW, baseCanvas.roomRectH] }),
  );

  // Leave 125% on the table so the company-switch assertion below can prove
  // the view survives a snapshot switch, then reset when we come back.
  await click(contents, '[data-testid="zoom-in"]');
  await waitFor(async () => String(await evalIn(contents, ZOOM_JS)) === "125%", { timeoutMs: 2000 });

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
  const zoomInB = String(await evalIn(contents, ZOOM_JS));
  add("切公司保留放大倍率（B 仍是 125%）", zoomInB === "125%", `zoom=${zoomInB}`);
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
  const backToA = await waitFor(async () => (await evalIn(contents, `document.querySelectorAll('[data-testid="desk"]').length`)) === 8, { timeoutMs: 5000 });
  add("切回 A：八个工位回来了", backToA);
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
  const zoomBackA = String(await evalIn(contents, ZOOM_JS));
  add("切回 A 后倍率仍保留（125%），投影跟随新窗口重新计算", zoomBackA === "125%", `zoom=${zoomBackA}`);
  await click(contents, '[data-testid="zoom-fit"]');
  await waitFor(async () => String(await evalIn(contents, ZOOM_JS)) === "100%", { timeoutMs: 2000 });

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
