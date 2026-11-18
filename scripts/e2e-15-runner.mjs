/**
 * 票 a04 acceptance runner — phase "flow"，在 Electron 主进程内驱动（业务留在 scripts/）。
 *
 * 一条时间线（单窗口）：
 *   boot → 全天班表 → 招聘主员工（e2e-15-main，装了带 ACADEMY-7 暗号技能的领域已下发）
 *   → 招聘对照员工（e2e-15-ctrl，什么都没下发）
 *   → 各发一句话（派活；引擎 open 前装配：main 出链接+MCP 引用件，ctrl 出空集合）
 *   → 文件层断言：main 的 skills/<skill> 是链接（指向学院内容目录）、SKILL.md 带暗号；
 *     ctrl 的引擎根没有该技能目录；两个员工根内都没有 auth.json / neo 模型件；
 *   → MCP 断言：main 的 academy-mcp.json 只有 env:VAR 引用（密钥值不落 canonical 文件），
 *     open 后 pi 的 mcp.json 里是注入的解析值；ctrl 两件皆无。
 * 失败按阶段点名：招聘 / 派活 / 上下文 / 文件层 / MCP。
 * Evidence: <outDir>/flow.json.
 */
import { mkdirSync } from "node:fs";
import { lstat, readlink, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
  sleep,
  waitFor,
  evalIn,
  click,
  typeInto,
  bootAndShowOffice,
  ensureAllDaySchedule,
  hireThroughWizard,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const ROLE_MAIN = "e2e-15-main";
const ROLE_CTRL = "e2e-15-ctrl";
const SKILL = "academy-marker";
const MARKER = "ACADEMY-7";
const SECRET_VAR = "ACADEMY_E2E_SECRET";
const SECRET_VALUE = "ACAD-SECRET-7";
const EMP_MAIN = "小院";
const EMP_CTRL = "对照";
const MSG_MAIN = "主线任务：讲讲你手头有哪些技能可以用。";
const MSG_MAIN2 = "第二张工单：再说说你的技能。";
const MSG_CTRL = "对照任务：随便聊聊今天的天气。";

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

/** @param {string} type */
const EVENT_COUNT_JS = (type) =>
  `document.querySelectorAll('[data-testid="event-item"]${type ? `[data-type="${type}"]` : ""}').length`;

/**
 * @param {import("electron").WebContents} contents
 * @param {number} deskId
 */
const openChatAt = async (contents, deskId) => {
  await click(contents, `[data-testid="desk"][data-desk-id="${deskId}"]`);
  return waitFor(async () => (await evalIn(contents, `document.querySelector('[data-testid="chat-input"]') !== null`)) === true, {
    timeoutMs: 4000,
  });
};

/**
 * Send one sentence and wait for the run to end (agent_end event in the drawer).
 * @param {import("electron").WebContents} contents
 * @param {string} message
 */
async function sendAndWaitEnd(contents, message) {
  await typeInto(contents, '[data-testid="chat-input"]', message);
  await click(contents, '[data-testid="chat-send"]');
  const ended = await waitFor(async () => (await evalIn(contents, EVENT_COUNT_JS("agent_end"))) >= 1, {
    timeoutMs: 90_000,
    intervalMs: 200,
  });
  await click(contents, '[data-testid="chat-close"]');
  await sleep(200);
  return ended;
}

/**
 * Walk a dir; collect names matching the credential/model-file guards.
 * @param {string} root @returns {Promise<string[]>} offending relative paths
 */
async function findGuardedFiles(root) {
  const guarded = new Set(["auth.json", "models.json", "settings.json"]);
  /** @type {string[]} */
  const hits = [];
  /** @param {string} dir @param {string} rel */
  const go = async (dir, rel) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await go(p, r);
      } else if (guarded.has(entry.name)) {
        hits.push(r);
      }
    }
  };
  try {
    await go(root, "");
  } catch {
    // dir missing → nothing found; other checks will name the gap
  }
  return hits;
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseFlow(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };
  /** @param {string} stage @param {unknown} err */
  const stageFail = (stage, err) => {
    add(`阶段失败: ${stage}`, false, String(err));
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };
  const contents = win.webContents;
  await ensureAllDaySchedule(contents);

  // ── 招聘（真实向导路径；角色列表来自 ~/.neo 投影）────────────
  const hireMain = await hireThroughWizard(contents, { roleKey: ROLE_MAIN, employeeName: EMP_MAIN, backFrom2: false, backFrom3: false });
  add("招聘: 主员工（neo 角色 e2e-15-main）录用成功", hireMain.confirmed, `roleCount=${hireMain.roleCount}`);
  const hireCtrl = await hireThroughWizard(contents, { roleKey: ROLE_CTRL, employeeName: EMP_CTRL, backFrom2: false, backFrom3: false });
  add("招聘: 对照员工（neo 角色 e2e-15-ctrl）录用成功", hireCtrl.confirmed, `roleCount=${hireCtrl.roleCount}`);
  if (!hireMain.confirmed || !hireCtrl.confirmed) return { checks };

  /** @type {{ main: { id: number, deskId: number } | null, ctrl: { id: number, deskId: number } | null }} */
  const who = { main: null, ctrl: null };
  for (let attempt = 0; attempt < 20 && (!who.main || !who.ctrl); attempt += 1) {
    const snapshot = /** @type {any} */ (await evalIn(contents, `window.cubicle.invoke('office.get')`));
    for (const desk of snapshot?.desks ?? []) {
      const o = desk?.occupant;
      if (!o) continue;
      if (o.name === EMP_MAIN) who.main = { id: Number(o.id), deskId: Number(desk.id) };
      if (o.name === EMP_CTRL) who.ctrl = { id: Number(o.id), deskId: Number(desk.id) };
    }
    if (!who.main || !who.ctrl) await sleep(300);
  }
  add("招聘: 两位员工都拿到 员工id+工位id（用于文件层与定向派活）", Boolean(who.main && who.ctrl), JSON.stringify(who));
  if (!who.main || !who.ctrl) return { checks };

  // ── 派活（对话浮层 → run.start → 装配 → 引擎 open）───────────
  try {
    const drawerMain = await openChatAt(contents, who.main.deskId);
    add("派活: 打开主员工对话浮层", drawerMain);
    const endMain = drawerMain && (await sendAndWaitEnd(contents, MSG_MAIN));
    add("派活: 主员工一轮 run 收尾（agent_end）", endMain);

    const drawerCtrl = await openChatAt(contents, who.ctrl.deskId);
    add("派活: 打开对照员工对话浮层", drawerCtrl);
    const endCtrl = drawerCtrl && (await sendAndWaitEnd(contents, MSG_CTRL));
    add("派活: 对照员工一轮 run 收尾（agent_end）", endCtrl);
    if (!endMain || !endCtrl) return { checks };

    // 第二张工单给主员工：同一员工再装配一次必须幂等。
    // 本机坑（a04 实录）：electron 内创建的 junction 对 node 的 lstat/readlink
    // 呈现为普通目录（`\??\Global\` 重解析数据）——装配若只看 lstat 会误报
    // academy_slot_not_link；realpath 门识别链接，重派照常收敛。
    const drawerMain2 = await openChatAt(contents, who.main.deskId);
    const endMain2 = drawerMain2 && (await sendAndWaitEnd(contents, MSG_MAIN2));
    add("派活: 主员工第二张工单收尾（同一员工重装配幂等；lstat 不可见的 electron junction 不再炸 academy_slot_not_link）", endMain2);
    if (!endMain2) return { checks };
  } catch (err) {
    stageFail("派活/上下文", err);
    return { checks };
  }

  // ── 文件层（装配落点：链接非副本；对照角色干净）──────────────
  /** @type {Record<string, unknown>} */
  const evidence = {};
  try {
    const mainAgent = enginePaths(ctx.dataDir, "pi", who.main.id).agentDir;
    const ctrlAgent = enginePaths(ctx.dataDir, "pi", who.ctrl.id).agentDir;
    const slot = path.join(mainAgent, "skills", SKILL);

    // 链接判定与装配器同门：lstat 可见就用 lstat；electron 在本机创建的 junction
    // 对 lstat/readlink 呈现为普通目录，realpath 仍能看穿 —— 链接的本质是
    // realpath 落到别处（内容目录），不是自己。副本的 realpath 就是它自己。
    const info = await lstat(slot).catch(() => null);
    const real = info !== null ? await realpath(slot).catch(() => null) : null;
    const libraryDir = path.resolve(ctx.outDir, "neo", "library", "demo", SKILL);
    const isLink =
      info !== null &&
      (info.isSymbolicLink() || (real !== null && path.resolve(real) !== path.resolve(slot)));
    add("文件层(正): 主员工 agent/skills/<name> 存在且是指向别处的链接（junction），非副本", info !== null && isLink, info === null ? "absent" : `lstatSymlink=${info.isSymbolicLink()} realpath=${real}`);
    if (isLink) {
      evidence.mainSkillRealTarget = real;
      add("文件层(正): 链接最终落到学院内容目录（neo/library/demo/academy-marker）", real !== null && path.resolve(real) === libraryDir, `real=${real}`);
      try {
        evidence.mainSkillReadlink = await readlink(slot);
      } catch {
        evidence.mainSkillReadlink = "EINVAL(本机 electron junction 对 readlink 不可见，realpath 门已证明链接性)";
      }
      const body = await readFile(path.join(slot, "SKILL.md"), "utf8").catch(() => "");
      add(`文件层(正): 该技能 SKILL.md 在员工根内可读且含 ${MARKER}`, body.includes(MARKER));
    }

    const ctrlSlot = await lstat(path.join(ctrlAgent, "skills", SKILL)).catch(() => null);
    add("文件层(反): 对照员工的引擎根里没有该技能目录", ctrlSlot === null);
    /** @type {string[]} */
    const ctrlSkills = await readdir(path.join(ctrlAgent, "skills")).catch(() => []);
    add("文件层(反): 对照员工 skills/ 不含任何学院技能", !ctrlSkills.includes(SKILL), `entries=${JSON.stringify(ctrlSkills)}`);

    // 凭据/模型卫生（--no-auth --agent-models 的文件层证据）
    const hitsMain = await findGuardedFiles(mainAgent);
    const hitsCtrl = await findGuardedFiles(ctrlAgent);
    add("文件层(卫): 两个员工根内均无 auth.json / models.json / settings.json", hitsMain.length === 0 && hitsCtrl.length === 0, `main=${JSON.stringify(hitsMain)} ctrl=${JSON.stringify(hitsCtrl)}`);
    evidence.mainAgentFiles = await readdir(mainAgent);

    // ── MCP（默认 ON；canonical 只存引用；值在 open 注入）───────
    const canonText = await readFile(path.join(mainAgent, "academy-mcp.json"), "utf8").catch(() => null);
    add("MCP(正): 主员工有 canonical academy-mcp.json", canonText !== null);
    if (canonText !== null) {
      const canon = JSON.parse(canonText);
      evidence.canon = canon;
      add("MCP(正): canonical 是 v2 引用形态：servers 里只有 env:VAR，密钥值不落盘", canon.version === 2 && canon.servers?.a04?.env?.[SECRET_VAR] === `env:${SECRET_VAR}` && !canonText.includes(SECRET_VALUE), JSON.stringify(canon.servers?.a04 ?? null));
      add("MCP(正): manifest envRefs 入账（server→key→变量名）", canon.envRefs?.a04?.[SECRET_VAR] === SECRET_VAR, JSON.stringify(canon.envRefs ?? null));
    }
    const piMcpText = await readFile(path.join(mainAgent, "mcp.json"), "utf8").catch(() => null);
    add("MCP(正): 引擎 open 后 pi mcp.json 出现，且带 open 时注入的解析值", piMcpText !== null && String(piMcpText).includes(SECRET_VALUE), piMcpText === null ? "absent" : piMcpText.slice(0, 240));
    const ctrlCanon = await readFile(path.join(ctrlAgent, "academy-mcp.json"), "utf8").catch(() => null);
    const ctrlPi = await readFile(path.join(ctrlAgent, "mcp.json"), "utf8").catch(() => null);
    add("MCP(反): 对照员工既无 canonical 也无引擎 MCP 件", ctrlCanon === null && ctrlPi === null);
  } catch (err) {
    stageFail("文件层/MCP", err);
  }

  return { checks, evidence };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    outcome = await phaseFlow(ctx);
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
