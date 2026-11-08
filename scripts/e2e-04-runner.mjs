/**
 * Ticket 04 acceptance runner — "说一句话，引擎开跑", driven from the
 * Electron main process but parked under scripts/ (main stays business-free).
 *
 * Phase "talk" (see also scripts/e2e-04.mjs orchestrator):
 *   boot → hire one programmer → seed the employee workspace (hello.txt) →
 *   click the occupied desk → conversation drawer opens → fingerprint home →
 *   send one sentence → first event lands in ≤2s → panel shows session
 *   start, text deltas, a read tool call, and the final text → tool event
 *   collapses/expands → second sentence reuses the same session (same 会话
 *   id, one growing session file) → a slow run is aborted with the 中止
 *   button (run lands in aborted, drawer goes idle) → home fingerprint
 *   unchanged (home root + ~/.pi strictly; the orchestrator samples
 *   AgentHost child processes separately) → reload the view, the last run's
 *   events re-paint from the host.
 * Phase "resume": fresh process, same data dir — the employee's session
 *   pointer survives; a new sentence completes and the SAME session file
 *   keeps growing (可续). The orchestrator separately proves the resumed
 *   request carried the old transcript (the mock model saw bigger prompts).
 *
 * Progress goes to process.stdout.write; evidence lands in <outDir>/<phase>.json.
 */
import { mkdirSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  out,
  sleep,
  waitFor,
  evalIn,
  click,
  typeInto,
  readJson,
  fingerprintHome,
  homeDirUntouched,
  bootAndShowOffice,
  ensureAllDaySchedule,
  hireThroughWizard,
} from "./e2e-harness.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const E2E_EMPLOYEE = "E2E 程序员甲";
const MSG_FIRST = "读一下 hello.txt，然后说说里面写了什么。";
const MSG_SECOND = "再把 hello.txt 读一遍确认一下。";
const MSG_SLOW = "慢慢念一段很长的话，别停。";
const MSG_RESUME = "重启过了，接着说：hello.txt 里写了什么？";

/**
 * @typedef {object} E2EContext
 * @property {import("electron").App} app
 * @property {() => import("electron").BrowserWindow | null} getMainWindow
 * @property {{ state: string, pid: number | null, send: (m: unknown) => boolean }} supervisor
 * @property {string} dataDir
 * @property {number} bootStartMs
 * @property {"talk" | "resume"} phase
 * @property {string} outDir
 */

const CHAT_OPEN_JS = `document.querySelector('[data-testid="chat-input"]') !== null`;
/** @param {string} type */
const EVENT_COUNT_JS = (type) =>
  `document.querySelectorAll('[data-testid="event-item"]${type ? `[data-type="${type}"]` : ""}').length`;
const RUNNING_JS = `document.querySelector('[data-testid="chat-running"]')?.dataset.running`;
/** @param {string} attr */
const TOOL_JS = (attr) => `document.querySelector('[data-testid="event-item"][data-type="tool"]')?.dataset.${attr}`;
const TEXT_TEXT_JS = `Array.from(document.querySelectorAll('[data-testid="event-item"][data-type="text"]')).map((n) => n.textContent).join("")`;

/**
 * @param {import("electron").WebContents} contents
 */
const openChatDrawer = async (contents) => {
  await click(contents, '[data-testid="desk"][data-empty="false"]');
  return waitFor(async () => (await evalIn(contents, CHAT_OPEN_JS)) === true, { timeoutMs: 3000 });
};

/**
 * Click 发送 immediately after recording the send time; resolves with the
 * latency until the FIRST event item paints in the drawer.
 *
 * @param {import("electron").WebContents} contents
 * @param {string} message
 */
async function sendMessage(contents, message) {
  await typeInto(contents, '[data-testid="chat-input"]', message);
  const sentAt = Date.now();
  await click(contents, '[data-testid="chat-send"]');
  const firstSeen = await waitFor(async () => (await evalIn(contents, EVENT_COUNT_JS(""))) > 0, { timeoutMs: 10_000 });
  return { firstSeen, firstEventMs: Date.now() - sentAt, sentAt };
}

/**
 * Children of the AgentHost pid are counted by the ORCHESTRATOR (plain
 * Node): this machine's policy refuses to let electron.exe spawn external
 * helpers like tasklist, so the check cannot run from inside the app. The
 * runner's only job is to publish the host pid as soon as the host is up.
 *
 * @param {{ outDir: string }} ctx
 * @param {number} hostPid
 */
async function publishHostPid(ctx, hostPid) {
  await writeFile(path.join(ctx.outDir, "hostpid.txt"), String(hostPid), "utf8");
}

/**
 * @param {string} sessionsDir
 * @returns {Promise<Array<{ name: string, size: number }>>}
 */
async function sessionFiles(sessionsDir) {
  let names = /** @type {string[]} */ ([]);
  try {
    names = (await readdir(sessionsDir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const listed = [];
  for (const name of names) {
    listed.push({ name, size: (await stat(path.join(sessionsDir, name))).size });
  }
  return listed;
}

/**
 * @param {E2EContext} ctx
 * @param {{ name: string, ok: boolean, detail?: string }[]} checks
 */
async function bootAndHire(ctx, checks) {
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };
  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { win: null, add, employeeId: 0 };

  await ensureAllDaySchedule(win.webContents); // 票 09: 默认班表 09:00–18:00，下班中有 off_duty 闸；e2e 配全天班表

  // Publish the host pid early: the orchestrator (plain Node) then samples
  // AgentHost child processes across the whole phase — electron.exe may not
  // spawn tasklist itself on this machine.
  await publishHostPid(ctx, Number(ctx.supervisor.pid));

  const first = await hireThroughWizard(win.webContents, {
    roleKey: "programmer",
    employeeName: E2E_EMPLOYEE,
    backFrom2: false,
    backFrom3: false,
  });
  add("招聘一名程序员（票 03 向导路径）", first.confirmed);
  await waitFor(async () => (await evalIn(win.webContents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, {
    timeoutMs: 4000,
  });

  const snapshot = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('office.get')`));
  const occupant = (snapshot?.desks ?? [])
    .map((/** @type {any} */ d) => d.occupant)
    .find((/** @type {any} */ o) => o !== null);
  const employeeId = Number(occupant?.id ?? 0);
  add("拿到新员工 id（用于私有目录断言）", employeeId > 0, `employeeId=${employeeId}`);

  // Seed the employee's private workspace BEFORE the first run.
  const dirs = enginePaths(ctx.dataDir, "pi", employeeId);
  await mkdirSync(dirs.workspaceDir, { recursive: true });
  await writeFile(path.join(dirs.workspaceDir, "hello.txt"), "hello from e2e fixture\n", "utf8");
  return { win, add, employeeId };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseTalk(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  const { win, add, employeeId } = await bootAndHire(ctx, checks);
  if (!win) return { checks };

  const homeBefore = await fingerprintHome();

  const drawerOpen = await openChatDrawer(win.webContents);
  add("点击在岗员工打开对话浮层", drawerOpen);
  if (!drawerOpen) return { checks };

  // — sentence one: events, tools, text —
  const dirs = enginePaths(ctx.dataDir, "pi", employeeId);
  const { firstSeen, firstEventMs, sentAt: firstSentAt } = await sendMessage(win.webContents, MSG_FIRST);
  add("输入一句话后 2 秒内出现首个事件", firstSeen && firstEventMs <= 2000, `${firstEventMs}ms`);
  // The first item is the run's session_start; the STRICTER read of the
  // acceptance — a real ENGINE event (text/tool) — must also land in 2s,
  // so the gate cannot be met by the session lifecycle event alone.
  const engineFirst = await waitFor(
    async () =>
      (await evalIn(win.webContents, `document.querySelectorAll('[data-testid="event-item"]:not([data-type="session_start"])').length`)) > 0,
    { timeoutMs: 10_000 },
  );
  const engineMs = Date.now() - firstSentAt;
  add("首个引擎事件（文本/工具，非会话开始）同样 ≤2s", engineFirst && engineMs <= 2000, `${engineMs}ms`);

  const settled = await waitFor(async () => (await evalIn(win.webContents, EVENT_COUNT_JS("agent_end"))) >= 1, {
    timeoutMs: 60_000,
  });
  add("这一轮在 60s 内结束（agent_end 落进面板）", settled);

  const hasSessionStart = (await evalIn(win.webContents, EVENT_COUNT_JS("session_start"))) >= 1;
  const textContent = String(await evalIn(win.webContents, TEXT_TEXT_JS));
  const toolDone = (await evalIn(win.webContents, TOOL_JS("done"))) === "true";
  const toolFailed = (await evalIn(win.webContents, TOOL_JS("error"))) === "true";
  const toolName = String(await evalIn(win.webContents, TOOL_JS("tool")));
  add(
    "面板按时间显示文本增量与工具调用（read 成功执行，文本含文件内容）",
    hasSessionStart && textContent.includes("好的，我先") && textContent.includes("hello from e2e fixture") && toolDone && !toolFailed,
    `tool=${toolName} text="${textContent.slice(0, 60)}…"`,
  );

  const collapsedBefore = (await evalIn(win.webContents, TOOL_JS("expanded"))) === "false";
  await click(win.webContents, '[data-testid="tool-toggle"]');
  const expanded = (await evalIn(win.webContents, TOOL_JS("expanded"))) === "true";
  const detailVisible = await evalIn(
    win.webContents,
    `document.querySelector('[data-testid="event-item"][data-type="tool"] pre')?.textContent ?? ''`,
  );
  await click(win.webContents, '[data-testid="tool-toggle"]');
  const collapsedAgain = (await evalIn(win.webContents, TOOL_JS("expanded"))) === "false";
  add(
    "工具事件可折叠：默认收起，展开可见参数/结果，再点收起",
    collapsedBefore && expanded && String(detailVisible).includes("hello.txt") && collapsedAgain,
    `detail=${String(detailVisible).slice(0, 40)}`,
  );

  const history1 = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('run.history', { employeeId: ${employeeId} })`));
  const sessionFiles1 = await sessionFiles(dirs.sessionsDir);
  add("会话数据落在应用私有目录（engines/pi/employee-<id>/sessions）", sessionFiles1.length === 1 && sessionFiles1[0].size > 0, JSON.stringify(sessionFiles1));
  add("落库运行记录：状态 completed、同一会话实体", history1?.lastRun?.status === "completed" && history1?.lastRun?.employeeSessionId > 0, JSON.stringify(history1?.lastRun));

  // — sentence two: same session continues —
  const eventsBefore = Number(await evalIn(win.webContents, EVENT_COUNT_JS("")));
  await sendMessage(win.webContents, MSG_SECOND);
  await waitFor(async () => (await evalIn(win.webContents, EVENT_COUNT_JS("agent_end"))) >= 2, { timeoutMs: 60_000 });
  const startLabelsRaw = String(
    await evalIn(
      win.webContents,
      `Array.from(document.querySelectorAll('[data-testid="event-item"][data-type="session_start"]')).map((n) => n.textContent).join("|")`,
    ),
  ).split("|");
  // 票 12/UI review: meta lines now carry a local clock time ("会话 #1 开始 · 11:58").
  // The identity assertion is about the session id, not the timestamp.
  const startLabels = startLabelsRaw.map((label) => label.replace(/\s*·\s*\d{1,2}:\d{2}\s*$/, "").trim());
  const sessionFiles2 = await sessionFiles(dirs.sessionsDir);
  const sameSession =
    startLabels.length === 2 && /^会话 #\d+ 开始$/.test(startLabels[0]) && startLabels[0] === startLabels[1];
  add(
    "同一员工连续两次对话复用同一会话：一个会话实体、一条会话文件持续生长",
    sameSession && sessionFiles2.length === 1 && sessionFiles2[0].size > sessionFiles1[0].size,
    `starts="${startLabels.join("|")}" sizes=${JSON.stringify(sessionFiles2.map((f) => f.size))}`,
  );
  const stillIdle = (await evalIn(win.webContents, RUNNING_JS)) === "false";
  const eventsGrew = Number(await evalIn(win.webContents, EVENT_COUNT_JS(""))) > eventsBefore;
  add("第二轮照常流事件、结束后回到空闲", stillIdle && eventsGrew);

  // — abort: a slow run, stopped by the button —
  await sendMessage(win.webContents, MSG_SLOW);
  await waitFor(async () => (await evalIn(win.webContents, RUNNING_JS)) === "true", { timeoutMs: 10_000 });
  await sleep(600);
  const abortVisible = await evalIn(win.webContents, `document.querySelector('[data-testid="chat-abort"]') !== null`);
  await click(win.webContents, '[data-testid="chat-abort"]');
  const wentIdle = await waitFor(async () => (await evalIn(win.webContents, RUNNING_JS)) === "false", { timeoutMs: 10_000 });
  const history3 = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('run.history', { employeeId: ${employeeId} })`));
  add("中止按钮停止运行：面板回到空闲、落库状态 aborted", abortVisible === true && wentIdle && history3?.lastRun?.status === "aborted", `status=${history3?.lastRun?.status}`);

  // — home isolation — the hard promise of this ticket is "会话数据落在应用
  //   私有目录，本机 ~/.pi 无新增文件". The home root fingerprint catches any
  //   NEW engine folder appearing; ~/.pi is checked strictly. This dev machine
  //   runs background codex agents that churn ~/.codex, so the remaining
  //   engine dirs are reported as detail rather than gated here.
  const homeAfter = await fingerprintHome();
  // Root: entry count must not grow (a NEW engine dir would show up); its
  // mtime churns when any top-level dir is touched by background agents, so
  // it is not part of the gate. ~/.pi itself is checked strictly.
  const rootUntouched = homeBefore["."].exists === homeAfter["."].exists && homeBefore["."].files === homeAfter["."].files;
  const piUntouched = homeDirUntouched(homeBefore[".pi"], homeAfter[".pi"]);
  const changedOthers = Object.keys(homeBefore)
    .filter((dir) => dir !== "." && dir !== ".pi" && !homeDirUntouched(homeBefore[dir], homeAfter[dir]));
  add(
    "会话数据不写家目录：根条目不变（无新引擎目录），~/.pi 指纹不变",
    rootUntouched && piUntouched,
    `root=${JSON.stringify(homeAfter["."])} .pi=${JSON.stringify(homeAfter[".pi"])}${changedOthers.length > 0 ? ` others-changed(本机后台代理噪音)=${changedOthers.join(",")}` : ""}`,
  );

  // — view reload: the last run re-paints from the host —
  win.webContents.reload();
  const reopened = await waitFor(async () => await openChatDrawer(win.webContents), { timeoutMs: 6000 });
  const replayed = await waitFor(async () => (await evalIn(win.webContents, EVENT_COUNT_JS("agent_end"))) >= 1, { timeoutMs: 3000 });
  add("重载视图后重新打开浮层，最后一轮事件由宿主重放", reopened && replayed);

  return {
    checks,
    evidence: {
      employeeId,
      sessionFiles1,
      sessionFiles2,
      firstEventMs,
    },
  };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }>}
 */
async function phaseResume(ctx) {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const checks = [];
  /** @param {string} name @param {unknown} ok @param {string} [detail] */
  const add = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? "" });
  };

  const { win } = await bootAndShowOffice(ctx, add);
  if (!win) return { checks };

  await ensureAllDaySchedule(win.webContents); // 票 09: 全天班表（幂等 upsert）

  const talkEvidence = await readJson(path.join(ctx.outDir, "talk.json"));
  const employeeId = Number(talkEvidence?.evidence?.employeeId ?? 0);

  await waitFor(async () => (await evalIn(win.webContents, `document.querySelectorAll('[data-testid="desk"][data-empty="false"]').length`)) === 1, {
    timeoutMs: 5000,
  });
  add("重启后：员工仍在工位", employeeId > 0, `employeeId=${employeeId}`);

  const drawerOpen = await openChatDrawer(win.webContents);
  add("重启后打开对话浮层", drawerOpen);
  if (!drawerOpen) return { checks };

  const dirs = enginePaths(ctx.dataDir, "pi", employeeId);
  const before = await sessionFiles(dirs.sessionsDir);
  add("重启后：会话文件仍是同一条（恢复指针在库）", before.length === 1, JSON.stringify(before));

  const { firstSeen, firstEventMs } = await sendMessage(win.webContents, MSG_RESUME);
  add("重启后再次对话，2 秒内出现首个事件", firstSeen && firstEventMs <= 2000, `${firstEventMs}ms`);

  const settled = await waitFor(async () => (await evalIn(win.webContents, EVENT_COUNT_JS("agent_end"))) >= 1, { timeoutMs: 60_000 });
  const textContent = String(await evalIn(win.webContents, TEXT_TEXT_JS));
  const after = await sessionFiles(dirs.sessionsDir);
  add(
    "会话可续：新一轮在同一会话文件上生长、事件照常（模型端已见完整上下文）",
    settled && textContent.includes("hello from e2e fixture") && after.length === 1 && after[0].size > (before[0]?.size ?? 0),
    `sizes=${before[0]?.size}→${after[0]?.size}`,
  );

  const history = /** @type {any} */ (await evalIn(win.webContents, `window.cubicle.invoke('run.history', { employeeId: ${employeeId} })`));
  add("续跑的运行也正常收尾（completed）", history?.lastRun?.status === "completed", JSON.stringify(history?.lastRun));

  return { checks, evidence: { sessionFilesBefore: before, sessionFilesAfter: after } };
}

/**
 * @param {E2EContext} ctx
 * @returns {Promise<number>} exit code
 */
export async function runE2E(ctx) {
  /** @type {{ checks: { name: string, ok: boolean, detail?: string }[], evidence?: Record<string, unknown> }} */
  let outcome = { checks: [] };
  try {
    outcome = ctx.phase === "resume" ? await phaseResume(ctx) : await phaseTalk(ctx);
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
