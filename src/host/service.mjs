/**
 * AgentHost command/query bus.
 *
 * The host's only door: main forwards typed invoke envelopes in, this answers
 * with a reply envelope plus any domain events that the mutation produced.
 * Handlers never touch processes or transport — just the store.
 */
import { createReply, createErrorReply, createEvent, TOPICS } from "../shared/envelope.mjs";
import { appError } from "../shared/apperror.mjs";
import { draftTask, rejectPrompt, resumePrompt, taskPrompt } from "./task/playbook.mjs";
import { engineConfigDir, enginePaths } from "./engine/paths.mjs";
import { DEFAULT_SCHEDULE, validateSchedule } from "./duty/schedule.mjs";
import { deriveEngineBadge, installGuide } from "./engine/badge.mjs";
import { extendBudgetBy50 } from "./cost/budget.mjs";
import { existsSync } from "node:fs";

/**
 * @typedef {import("../shared/envelope.mjs").InvokeEnvelope} InvokeEnvelope
 * @typedef {import("../shared/envelope.mjs").ReplyEnvelope} ReplyEnvelope
 * @typedef {import("../shared/envelope.mjs").EventEnvelope} EventEnvelope
 *
 * @typedef {{ reply: ReplyEnvelope, events: EventEnvelope[] }} HandleResult
 */

/**
 * 票 12: the employee's frozen role snapshot carries the cost policy
 * (`cost.tokenBudgetPerTask`) — copy it onto the task at creation. A bad or
 * missing value lets the store land the preset default; nothing here invents.
 *
 * @param {unknown} roleSnapshot
 * @returns {number | undefined}
 */
function readRoleTokenBudget(roleSnapshot) {
  const manifest = /** @type {Record<string, unknown> | undefined} */ (
    /** @type {Record<string, unknown> | undefined} */ (roleSnapshot)?.manifest
  );
  const cost = /** @type {Record<string, unknown> | undefined} */ (manifest?.cost);
  const budget = cost?.tokenBudgetPerTask;
  return typeof budget === "number" && Number.isInteger(budget) && budget > 0 ? budget : undefined;
}

/**
 * 票 12: the续跑 contract after the soft gate capped a task — the 票 09 resume
 * channel, with the raised budget stated so the engine knows to continue
 * (not restart) its work.
 *
 * @param {{ id: number, playbook: string, goal: string, acceptance: string[] }} task
 * @param {number} budget
 * @returns {string}
 */
function budgetResumePrompt(task, budget) {
  return [
    taskPrompt(task),
    "",
    `【预算】这张工单的 token 预算已被老板提到 ${budget}：从中断处继续完成任务，不要重复已经完成的步骤。`,
  ].join("\n");
}

/**
 * @param {unknown} payload
 * @param {string} field
 * @returns {string}
 */
function requireName(payload, field) {
  const record = /** @type {Record<string, unknown>} */ (payload ?? {});
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw appError("invalid_payload", `${field} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Strict positive-integer extraction: booleans, strings and floats are all
 * invalid — the bridge carries JSON numbers, so anything else is a bug.
 *
 * @param {unknown} payload
 * @param {string} field
 * @returns {number}
 */
function requirePositiveId(payload, field) {
  const record = /** @type {Record<string, unknown>} */ (payload ?? {});
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw appError("invalid_payload", `${field} must be a positive integer`);
  }
  return value;
}

/**
 * @typedef {object} DutyDoor 票 09: duty runtime 暴露给 service 的三条门。
 * @property {(employeeId: number) => "on" | "grace" | "off"} phaseForEmployee
 * @property {(companyId: number, mode: "on" | "off") => { phase: "on" | "grace" | "off" }} applyOverride
 * @property {() => Promise<number>} pauseAll
 *
 * @typedef {(engine: string) => { resumes: boolean }} EngineCapabilities
 *   票 10: 引擎能力声明（宁可给重跑 —— 拿不到 true 就按「不能续跑」办）。
 *
 * @param {{
 *   store: ReturnType<import("./store.mjs").openStore>,
 *   hostInfo: { pid: number, startedAt: string },
 *   runManager?: ReturnType<import("./engine/run-manager.mjs").createRunManager>,
 *   git?: Pick<import("./git/reader.mjs").GitReader, "head" | "audit">,
 *   duty?: DutyDoor,
 *   engineProbe?: { startProbe(engine: string): Promise<{ status: string }> },
 *   engineFacts?: (engine: string) => { configured: boolean },
 *   engineCapabilities?: EngineCapabilities,
 *   notifyDomain?: (payload: Record<string, unknown>) => void,
 * }} deps
 */
export function createService({ store, hostInfo, runManager, git, duty, engineProbe, engineFacts, engineCapabilities, notifyDomain }) {
  /** 引擎运行方法共用同一道闸门：没有 run manager 就没有 run.*。 */
  function requireRunManager() {
    if (!runManager) throw appError("engine_unavailable", "引擎运行时未启动");
    return runManager;
  }

  /** 工单方法共用同一道闸门：没有 git 门就没有 task.*。 */
  function requireGit() {
    if (!git) throw appError("git_unavailable", "git 访问未配置：工单需要 git 工作区才能记录起点。");
    return git;
  }

  /**
   * 下班闸门（票 09）：下班中的公司不开新的引擎运行 — 「暂停期间不再产生
   * 新的工具调用」的另一半（前一半是引擎 abort）。宽限相位允许：那是给
   * 收尾的窗口。没有接 duty（老测试/降级宿主）时闸门不存在。
   *
   * @param {number} employeeId
   */
  function gateOffDuty(employeeId) {
    if (duty && duty.phaseForEmployee(employeeId) === "off") {
      throw appError("off_duty", "公司正在下班中：先在「上下班」面板点「立即上班」，或等时间表到点自动上班。");
    }
  }

  /** @param {number} companyId */
  function requireCompany(companyId) {
    const exists = store
      .officeSnapshot()
      .companies.some((/** @type {{ id: number }} */ c) => c.id === companyId);
    if (!exists) throw appError("unknown_company", `no company with id ${companyId}`);
  }

  /**
   * 票 10 的中断形状门：任务存在、最近一轮 task_session 是 interrupted、任务
   * 还停在 open（开库自愈落回待办）或 running（09 自愈豁免的形状）。三选
   * （续跑/重跑/放弃）都从这道门进；别的形状诚实报 not_interrupted。
   *
   * @param {number} taskId
   */
  function requireInterruptedShape(taskId) {
    const task = store.taskById(taskId);
    if (!task) throw appError("unknown_task", `no task with id ${taskId}`);
    const latest = store.latestTaskSessionForTask(taskId);
    const shaped = latest?.status === "interrupted" && (task.status === "open" || task.status === "running");
    if (!shaped) {
      throw appError("not_interrupted", "这张工单不在「中断」形状：只有崩溃/强杀留下的 interrupted 任务可以三选。");
    }
    return { task, latest };
  }

  /**
   * 票 10 canResume：两道都过才给「续跑」——
   *   ① 引擎能力声明 resumes=true（没有声明 = 没有能力，宁可给重跑）；
   *   ② 恢复指针在场：pi 的指针是会话文件（当场 existsSync），codex 的
   *      thread:<uuid> 活在引擎私有 CODEX_HOME 里、无法廉价的查文件，
   *      按「有指针就信」。指针 null/空（首轮崩溃且从没落过指针）→ 只能重跑。
   *
   * @param {string} engine
   * @param {string | null | undefined} pointer
   * @returns {{ canResume: boolean, hint: string | null }}
   */
  function resumableVerdict(engine, pointer) {
    const resumes = engineCapabilities?.(engine)?.resumes === true;
    if (!resumes) {
      return { canResume: false, hint: `引擎 ${engine} 没有声明「可恢复会话」：这张只能重跑。` };
    }
    if (pointer === null || pointer === undefined || String(pointer).length === 0) {
      return { canResume: false, hint: "引擎会话的恢复指针不在（这一轮从没跑完过）：只能重跑。" };
    }
    if (!String(pointer).startsWith("thread:") && !existsSync(String(pointer))) {
      return { canResume: false, hint: "引擎的会话文件已经不在了：只能重跑。" };
    }
    return { canResume: true, hint: null };
  }

  /**
   * The resume pointer as the run manager will use it: the interrupted
   * round's employee-session row (same engine ⇒ same row — resume continues
   * exactly that engine session).
   *
   * @param {number} employeeSessionId
   * @returns {string | null}
   */
  function pointerOfEmployeeSession(employeeSessionId) {
    return store.employeeSessionById(employeeSessionId)?.sessionFile ?? null;
  }

  /**
   * @type {Record<string, (payload: unknown) => { payload: unknown, event?: Record<string, unknown> } | Promise<{ payload: unknown, event?: Record<string, unknown> }>>}
   */
  const methods = {
    "office.get"(payload) {
      return { payload: { ...store.officeSnapshot(), host: hostInfo } };
    },

    "company.create"(payload) {
      const name = requireName(payload, "name");
      const company = store.createCompany({ name });
      // Creating is intending: the office follows what the user just made.
      store.setActive({ companyId: company.id });
      return { payload: company, event: { reason: "company.create", companyId: company.id } };
    },

    "projectGroup.create"(payload) {
      const companyId = requirePositiveId(payload, "companyId");
      const name = requireName(payload, "name");
      const group = store.createProjectGroup({ companyId, name });
      store.setActive({ companyId, groupId: group.id });
      const desks = store.listDesks({ groupId: group.id });
      return {
        payload: { group, desks },
        event: { reason: "projectGroup.create", groupId: group.id },
      };
    },

    "role.list"() {
      return { payload: { roles: store.listRoles() } };
    },

    // — engines (ticket 11: 徽章三态 / 准入探针 / 手动带风险启用 / 切换) —

    "engine.list"() {
      const engines = store.listEngineStates().map((state) => ({
        ...state,
        badge: deriveEngineBadge({
          installed: state.installed,
          configured: engineFacts?.(state.engine)?.configured ?? false,
        }),
        installGuide: state.installed !== true ? installGuide(state.engine) : null,
      }));
      return { payload: { engines } };
    },

    "engine.enable"(payload) {
      const engine = requireName(payload, "engine");
      const manualOverride = Boolean(/** @type {Record<string, unknown>} */ (payload ?? {}).manualOverride);
      const state = store.engineState(engine);
      if (!state) throw appError("unknown_engine", `no engine ${engine}`);
      // 只有探针通过才可无脑启用；否则必须显式带风险手动启用。
      if (!manualOverride && state.probeStatus !== "passed") {
        throw appError("probe_required", "引擎尚未通过准入探针；如仍要启用，请勾选「带风险启用」。");
      }
      store.setEngineEnabled({ engine, enabled: true, manualOverride: state.probeStatus !== "passed" });
      return {
        payload: { engine: store.engineState(engine) },
        event: { reason: "engine.enable", engine, manualOverride },
      };
    },

    "engine.probe"(payload) {
      const engine = requireName(payload, "engine");
      if (!engineProbe) throw appError("engine_unavailable", "探针运行时未启动");
      const state = store.engineState(engine);
      if (!state) throw appError("unknown_engine", `no engine ${engine}`);
      if (state.probeStatus === "running") throw appError("engine_probe_running", `${engine} 的探针正在运行`);
      // The reply only says "started"; the probe runs several engine turns and
      // lands its verdict through the store + a later domain.changed.
      store.setEngineProbeResult({ engine, status: "running" });
      engineProbe
        .startProbe(engine)
        .then((result) => {
          notifyDomain?.({ reason: "engine.probe", engine, status: result.status });
        })
        .catch((err) => {
          notifyDomain?.({ reason: "engine.probe", engine, status: "failed", error: err instanceof Error ? err.message : String(err) });
        });
      return { payload: { started: true, engine }, event: { reason: "engine.probe.start", engine } };
    },

    "employee.setEngine"(payload) {
      const employeeId = requirePositiveId(payload, "employeeId");
      const engine = requireName(payload, "engine");
      const state = store.engineState(engine);
      if (!state) throw appError("unknown_engine", `no engine ${engine}`);
      if (!state.enabled) {
        throw appError("engine_not_admitted", `${engine} 尚未准入（未通过探针且未手动启用）`);
      }
      if (!store.employeeById(employeeId)) throw appError("unknown_employee", `no employee with id ${employeeId}`);
      const employee = store.setEmployeeEngine({ employeeId, engine });
      return { payload: { employee }, event: { reason: "employee.setEngine", employeeId, engine } };
    },

    "employee.hire"(payload) {
      const deskId = requirePositiveId(payload, "deskId");
      const roleId = requirePositiveId(payload, "roleId");
      const rawName = /** @type {Record<string, unknown>} */ (payload ?? {}).name;
      if (rawName !== undefined && rawName !== null && typeof rawName !== "string") {
        throw appError("invalid_payload", "name must be a string");
      }
      const { employee, desk } = store.hireEmployee({ deskId, roleId, name: /** @type {string | undefined} */ (rawName ?? undefined) });
      return {
        payload: { employee, desk },
        event: { reason: "employee.hire", employeeId: employee.id, deskId },
      };
    },

    // — engine runs (ticket 04) — the reply only starts/answers; engine
    //   events arrive on the run.event topic, streamed by the run manager.

    "run.start"(payload) {
      const employeeId = requirePositiveId(payload, "employeeId");
      const text = requireName(payload, "text");
      gateOffDuty(employeeId);
      const { run, session } = requireRunManager().start({ employeeId, text });
      return { payload: { run, session } };
    },

    "run.abort"(payload) {
      const employeeId = requirePositiveId(payload, "employeeId");
      // validation is synchronous; the engine cancel handshake settles later
      void requireRunManager().abort({ employeeId });
      return { payload: { ok: true, employeeId } };
    },

    "run.history"(payload) {
      const employeeId = requirePositiveId(payload, "employeeId");
      return { payload: requireRunManager().history({ employeeId }) };
    },

    // — work orders (ticket 05: 工单与产出) —

    /**
     * One sentence in, an editable contract out: which playbook, what the
     * goal is, which acceptance criteria — the 工单台 prefills its form
     * from this and the boss edits anything before dispatch.
     */
    "task.draft"(payload) {
      const text = requireName(payload, "text");
      return { payload: draftTask(text) };
    },

    "task.create"(payload) {
      const employeeId = requirePositiveId(payload, "employeeId");
      const text = requireName(payload, "text");
      const employee = store.employeeById(employeeId);
      if (!employee) throw appError("unknown_employee", `no employee with id ${employeeId}`);
      const groupId = store.groupOfEmployee(employeeId);
      if (groupId === null) throw appError("no_desk", `employee ${employeeId} has no desk — seat them first`);

      const draft = draftTask(text);
      const record = /** @type {Record<string, unknown>} */ (payload ?? {});
      const goal = typeof record.goal === "string" && record.goal.trim().length > 0 ? record.goal.trim() : draft.goal;
      const playbook =
        typeof record.playbook === "string" && ["feature", "bugfix", "docs", "free"].includes(record.playbook)
          ? record.playbook
          : draft.playbook;
      const acceptance = Array.isArray(record.acceptance)
        ? record.acceptance.map((line) => String(line).trim()).filter((line) => line.length > 0)
        : draft.acceptance;

      // The git door decides usability BEFORE a task exists: an
      // unversioned workspace cannot record a start HEAD (票 05 验收 5).
      const workspaceDir = enginePaths(store.dataDir, employee.roleSnapshot.manifest.engine || "pi", employeeId)
        .workspaceDir;
      const head = requireGit().head(workspaceDir);
      if (!head.ok) throw appError(head.code, head.message);

      const task = store.createTask({
        groupId,
        employeeId,
        workspaceDir,
        title: text,
        goal,
        playbook,
        acceptance,
        baseHead: head.sha,
        // 票 12: 角色 cost 的每任务预算在开单时抄进任务行（之后 +50% 只改这一行）。
        tokenBudget: readRoleTokenBudget(employee.roleSnapshot),
      });
      return { payload: { task }, event: { reason: "task.create", taskId: task.id } };
    },

    "task.dispatch"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      const task = store.taskById(taskId);
      if (!task) throw appError("unknown_task", `no task with id ${taskId}`);
      if (task.status === "running") throw appError("task_running", `task ${taskId} is already being worked on`);
      // 待验收/完成 are not dispatch entry points (票 06: 不可跳过): a review
      // task goes through task.reject, a done task is closed for good.
      if (task.status === "review" || task.status === "done") {
        throw appError("invalid_transition", `这张工单当前是「${task.status === "review" ? "待验收" : "完成"}」：${task.status === "review" ? "请点通过或打回。" : "已完成的工单不再开工。"}`);
      }
      gateOffDuty(task.employeeId);
      // open may be dispatched; failed may retry (retry = a fresh task session)
      const { run, session } = requireRunManager().start({
        employeeId: task.employeeId,
        text: taskPrompt(task),
        task: { id: task.id },
      });
      return { payload: { run, session }, event: { reason: "task.dispatch", taskId } };
    },

    /**
     * 验收通过: the only way a task reaches 完成 (票 06 验收 2). Legality is
     * the store's transition map — review → done, nothing else.
     */
    "task.accept"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      if (!store.taskById(taskId)) throw appError("unknown_task", `no task with id ${taskId}`);
      const task = store.setTaskStatus(taskId, "done");
      return { payload: { task }, event: { reason: "task.accept", taskId } };
    },

    /**
     * 打回: NOT a new task — the same task gets one more iteration session,
     * on the same employee session (history stays continuous), and the
     * boss's 打回意见 rides into the engine prompt (票 06 验收 3).
     */
    "task.reject"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      const task = store.taskById(taskId);
      if (!task) throw appError("unknown_task", `no task with id ${taskId}`);
      // Check before opening anything: a refused 打回 must not leave a
      // dangling task_session row behind.
      if (task.status !== "review") {
        throw appError("invalid_transition", "只有「待验收」的工单能打回。");
      }
      gateOffDuty(task.employeeId);
      const rawReason = /** @type {Record<string, unknown>} */ (payload ?? {}).reason;
      if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") {
        throw appError("invalid_payload", "reason must be a string");
      }
      const { run, session } = requireRunManager().start({
        employeeId: task.employeeId,
        text: rejectPrompt(task, /** @type {string | undefined} */ (rawReason ?? undefined)),
        task: { id: task.id },
      });
      return { payload: { run, session }, event: { reason: "task.reject", taskId } };
    },

    /**
     * 取消: terminate the live engine run; the run settles as 'aborted',
     * its task session follows, and the task lands at 失败 (票 06 验收 4).
     */
    "task.cancel"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      const task = store.taskById(taskId);
      if (!task) throw appError("unknown_task", `no task with id ${taskId}`);
      if (task.status !== "running") {
        throw appError("invalid_transition", "只有「进行中」的工单能取消。");
      }
      // validation is synchronous; the engine cancel handshake settles later
      void requireRunManager().abort({ employeeId: task.employeeId });
      return { payload: { ok: true, taskId }, event: { reason: "task.cancel", taskId } };
    },

    "task.list"(payload) {
      const record = /** @type {Record<string, unknown>} */ (payload ?? {});
      // 票 08: 右把手按公司看全量（跨组）；工单台仍按组。两个都走同一扇门。
      if (typeof record.companyId === "number") {
        const companyId = requirePositiveId(payload, "companyId");
        const companyExists = store
          .officeSnapshot()
          .companies.some((/** @type {{ id: number }} */ c) => c.id === companyId);
        if (!companyExists) throw appError("unknown_company", `no company with id ${companyId}`);
        return { payload: { tasks: store.listTasksForCompany({ companyId }) } };
      }
      const groupId =
        typeof record.groupId === "number" ? requirePositiveId(payload, "groupId") : store.officeSnapshot().activeGroupId;
      if (groupId === null) return { payload: { tasks: [] } };
      return { payload: { tasks: store.listTasks({ groupId }) } };
    },

    "task.detail"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      const task = store.taskById(taskId);
      if (!task) throw appError("unknown_task", `no task with id ${taskId}`);
      // iteration = position in the task's session history (票 06 验收 3:
      // 历史连续且迭代次数可见); tokens = every run's usage, summed (验收 2).
      const sessions = store.listTaskSessions(taskId).map((session, index) => ({
        ...session,
        iteration: index + 1,
      }));
      // 票 10: the 工单台 detail renders the 三选 from this verdict — same
      // conservative canResume rule as task.interrupted.list (capability +
      // pointer), so bench and handle never disagree about what is offered.
      const latest = sessions.at(-1) ?? null;
      const shaped =
        latest?.status === "interrupted" && (task.status === "open" || task.status === "running");
      const verdict = shaped
        ? resumableVerdict(latest.engine, pointerOfEmployeeSession(latest.employeeSessionId))
        : null;
      return {
        payload: {
          task,
          sessions,
          artifacts: store.listArtifacts({ taskId }),
          tokens: store.taskTokenSummary(taskId),
          iterations: sessions.length,
          // 票 12: 预算与「到顶/黄点」判定的原料一起上信封（判定纯函数在渲染层镜像）；
          // failure.reason = 最近一轮失败会话的人话原因（store 已折叠，视图不重derive）。
          budget: task.tokenBudget,
          failure: { reason: store.latestFailReasonForTask(taskId) },
          ...(verdict ? { interrupted: { canResume: verdict.canResume, resumeHint: verdict.hint } } : {}),
        },
      };
    },

    /**
     * 「+50%」 (票 12 验收 4): the exhausted task's budget grows to 1.5× and
     * the task续跑 through the 票 09 resume channel (append a session — no
     * sixth task state). The raise lands even when the resume cannot start
     * (下班中 / 员工还在跑) — the reply says why, honestly, and the UI shows it.
     */
    "task.extendBudget"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      const task = store.taskById(taskId);
      if (!task) throw appError("unknown_task", `no task with id ${taskId}`);
      if (task.status !== "running") {
        throw appError("invalid_transition", "只有「进行中」（含预算到顶暂停）的工单能加预算。");
      }
      const raised = extendBudgetBy50(task.tokenBudget);
      const updated = store.setTaskTokenBudget(taskId, raised);

      let resumed = false;
      let resumeNote = "";
      if (duty && duty.phaseForEmployee(task.employeeId) === "off") {
        resumeNote = "公司正在下班中：预算已提高，等上班（到点自动或「立即上班」）后会自己续跑。";
      } else {
        try {
          requireRunManager().start({
            employeeId: task.employeeId,
            text: budgetResumePrompt(task, raised),
            task: { id: task.id },
            resume: true,
          });
          resumed = true;
        } catch (err) {
          const code = /** @type {{ code?: string }} */ (err ?? {}).code ?? "unknown";
          resumeNote =
            code === "employee_busy"
              ? "员工这一轮还在跑：新预算已生效，这一轮继续按新预算跑，不需要续跑。"
              : `预算已提高，但续跑没起来：${code}`;
        }
      }
      return {
        payload: { task: updated, budget: raised, resumed, resumeNote },
        event: { reason: "task.extendBudget", taskId },
      };
    },

    /**
     * Evidence for "应用全程未执行 git 写操作": every git command this host
     * process ran, in order — the git door only ever executes its read-only
     * allow-list (test/git-reader.test.mjs).
     */
    "task.gitAudit"() {
      return { payload: { commands: requireGit().audit() } };
    },

    // — 崩溃恢复 (ticket 10: 强杀后重启 → 中断的任务三选；不静默自动续跑) —

    /**
     * The 中断的任务 list: tasks whose LATEST task_session ended 'interrupted'
     * by a crash (the store's open-store heal creates this shape; 票 09's
     * paused story never does). Each row carries the resume verdict so the UI
     * can offer 续跑 only when the engine declares it can resume AND the
     * session pointer still exists — when either fails, the honest door is
     * 重跑 (票面: 「不支持恢复的引擎给出重跑选项」). 放弃 is always offered;
     * it just lands the task at 失败 with its history intact.
     */
    "task.interrupted.list"(payload) {
      const companyId = requirePositiveId(payload, "companyId");
      requireCompany(companyId);
      const tasks = store.listInterruptedTasks({ companyId }).map((row) => {
        const verdict = resumableVerdict(row.engine, row.sessionFile);
        return { ...row, canResume: verdict.canResume, resumeHint: verdict.hint };
      });
      return { payload: { tasks } };
    },

    /**
     * 续跑: the 09 resume channel (追加 task_session, same employee session,
     * engine continues from its own pointer). Legality: the task must be in
     * the interrupted shape; the engine must declare it can resume and its
     * pointer must exist; 下班中 refused like any new engine work. The five-
     * state map is untouched — the run manager performs the legal open→running
     * transition (or skips it for the 09 heal-exempt 进行中 shape).
     */
    "task.resume"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      const { task, latest } = requireInterruptedShape(taskId);
      gateOffDuty(task.employeeId);
      const verdict = resumableVerdict(latest.engine, pointerOfEmployeeSession(latest.employeeSessionId));
      if (!verdict.canResume) throw appError("engine_not_resumable", verdict.hint ?? "这个引擎不能续跑");
      const { run, session } = requireRunManager().start({
        employeeId: task.employeeId,
        text: resumePrompt(task),
        task: { id: task.id },
        resume: true,
      });
      return { payload: { run, session }, event: { reason: "task.resume", taskId } };
    },

    /**
     * 重跑: a fresh task_session on the original contract (06's retry semantics,
     * no resume pointer). For the shape the 09 heal keeps 进行中 (crash after
     * 上班续跑), the interrupted attempt first lands at 失败 (running→failed,
     * the same edge 取消 uses) and the rerun goes through the 06 failed→running
     * exit — the transition map stays the single door.
     */
    "task.rerun"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      const { task } = requireInterruptedShape(taskId);
      gateOffDuty(task.employeeId);
      if (task.status === "running") store.setTaskStatus(taskId, "failed");
      const { run, session } = requireRunManager().start({
        employeeId: task.employeeId,
        text: taskPrompt(task),
        task: { id: task.id },
      });
      return { payload: { run, session }, event: { reason: "task.rerun", taskId } };
    },

    /**
     * 放弃: the boss explicitly gives up on an interrupted ticket → 失败归档.
     * History is never touched (task_session / artifact rows stay as they are).
     * This is the ONLY edge ticket 10 added to the transition map (open→failed)
     * — and this door is what keeps it honest: only the interrupted shape may
     * take it. No off-duty gate: abandoning spawns no tool calls.
     */
    "task.abandon"(payload) {
      const taskId = requirePositiveId(payload, "taskId");
      requireInterruptedShape(taskId);
      const task = store.setTaskStatus(taskId, "failed");
      return { payload: { task }, event: { reason: "task.abandon", taskId } };
    },

    /**
     * 引擎中心（票 08 外壳）：引擎名 + 配置目录路径。引擎卡徽章 / 可用性探针
     * 属票 11 — 这里只把「有哪些引擎、配置放哪」这条查询立起来，卡片插槽留给
     * 它。引擎集合从角色 manifest 里出现过的引擎去重（预设全是 pi；将来
     * 招聘 codex 员工，它的引擎自然进列表）。
     */
    "engine.overview"() {
      /** @type {{ name: string, configDir: string }[]} */
      const engines = [];
      const seen = new Set();
      for (const role of store.listRoles()) {
        const name = role.manifest.engine && role.manifest.engine.length > 0 ? role.manifest.engine : "pi";
        if (seen.has(name)) continue;
        seen.add(name);
        engines.push({ name, configDir: engineConfigDir(store.dataDir, name) });
      }
      return { payload: { engines, dataDir: store.dataDir } };
    },

    "office.setActive"(payload) {
      const companyId = requirePositiveId(payload, "companyId");
      const record = /** @type {Record<string, unknown>} */ (payload ?? {});
      const rawGroup = record.groupId;
      // Validate against real rows so the UI can't wedge the selection.
      const companyExists = store
        .officeSnapshot()
        .companies.some((/** @type {{ id: number }} */ c) => c.id === companyId);
      if (!companyExists) throw appError("unknown_company", `no company with id ${companyId}`);
      if (rawGroup !== undefined && rawGroup !== null) {
        const groupId = requirePositiveId(payload, "groupId");
        const groupExists = store
          .listGroups({ companyId })
          .some((/** @type {{ id: number }} */ g) => g.id === groupId);
        if (!groupExists) throw appError("unknown_group", `no group ${groupId} in company ${companyId}`);
        store.setActive({ companyId, groupId });
      } else {
        store.setActive({ companyId });
      }
      return { payload: { ok: true }, event: { reason: "office.setActive", companyId } };
    },

    // — 上下班 (ticket 09) — 配置行 vs override 记录 vs 相位，三条独立状态。

    /**
     * The company's timetable (defaulted when never configured), its manual
     * override record, and the current duty phase — everything 上下班面板
     * shows, from the store (single writer).
     */
    "schedule.get"(payload) {
      const companyId = requirePositiveId(payload, "companyId");
      requireCompany(companyId);
      const row = store.getCompanySchedule(companyId);
      const status = store.getDutyStatus(companyId);
      return {
        payload: {
          schedule: row
            ? { workStart: row.workStart, workEnd: row.workEnd, graceSeconds: row.graceSeconds }
            : { workStart: DEFAULT_SCHEDULE.workStart, workEnd: DEFAULT_SCHEDULE.workEnd, graceSeconds: DEFAULT_SCHEDULE.graceSeconds },
          configured: row !== null,
          override: store.getDutyOverride(companyId),
          status: status ?? { phase: "on", phaseSince: null, graceUntil: null },
        },
      };
    },

    /**
     * 可配上下班时刻（验收 1）：每公司一份配置行，落库可改。合法性由
     * duty/schedule 的 validateSchedule 定；被拒不动已存配置。
     */
    "schedule.set"(payload) {
      const companyId = requirePositiveId(payload, "companyId");
      requireCompany(companyId);
      const record = /** @type {Record<string, unknown>} */ (payload ?? {});
      const stored = store.getCompanySchedule(companyId);
      const graceSeconds =
        record.graceSeconds === undefined ? (stored?.graceSeconds ?? DEFAULT_SCHEDULE.graceSeconds) : record.graceSeconds;
      const checked = validateSchedule({ workStart: record.workStart, workEnd: record.workEnd, graceSeconds });
      if (!checked.ok) throw appError("invalid_payload", checked.reason);
      const row = store.upsertCompanySchedule({ companyId, ...checked.schedule });
      return { payload: { schedule: row }, event: { reason: "schedule.set", companyId } };
    },

    /**
     * 手动上下班（验收 2）：写 override 记录 + 立即生效（duty runtime 的
     * 立即通道），时间表一个字节不动。
     */
    "duty.override"(payload) {
      const companyId = requirePositiveId(payload, "companyId");
      const record = /** @type {Record<string, unknown>} */ (payload ?? {});
      const mode = record.mode;
      if (mode !== "on" && mode !== "off") throw appError("invalid_payload", "mode must be on/off");
      if (!duty) throw appError("duty_unavailable", "上下班调度未启动");
      const { phase } = duty.applyOverride(companyId, mode);
      return { payload: { phase }, event: { reason: "duty.override", companyId } };
    },

    /**
     * 退出「直接退」的地基：把全部在跑的 run 下班落盘（paused），等每一
     * 个引擎收尾 promise 回来才回答 — main 据此才 kill host，重启后这些
     * paused 行还在（store seam 钉死）。
     */
    async "host.pauseAll"() {
      if (!duty) throw appError("duty_unavailable", "上下班调度未启动");
      const paused = await duty.pauseAll();
      return { payload: { paused } };
    },

    /** 退出「等完成」的地基：等 run 池安静再回答。 */
    async "host.awaitQuiet"() {
      await requireRunManager().whenQuiet();
      return { payload: { ok: true } };
    },
  };

  /**
   * 内部：跑一个 handler；同步方法给结果对象，异步方法（host.pauseAll /
   * host.awaitQuiet — 退出流程的两扇门）给结果 promise。
   *
   * @param {InvokeEnvelope} invoke
   * @returns {HandleResult | Promise<HandleResult>}
   */
  function run(invoke) {
    const method = methods[invoke.method];
    if (!method) {
      return {
        reply: createErrorReply(invoke, {
          code: "unknown_method",
          message: `AgentHost has no handler for ${invoke.method}`,
        }),
        events: [],
      };
    }
    const toResult = (/** @type {{ payload: unknown, event?: Record<string, unknown> }} */ outcome) => {
      const events = outcome.event ? [createEvent(TOPICS.domainChanged, outcome.event)] : [];
      return { reply: createReply(invoke, outcome.payload), events };
    };
    const failure = (/** @type {unknown} */ err) => {
      const code = /** @type {{ code?: string }} */ (err ?? {}).code ?? "internal";
      const message = err instanceof Error ? err.message : String(err);
      return { reply: createErrorReply(invoke, { code, message }), events: [] };
    };
    let outcome;
    try {
      outcome = method(invoke.payload);
    } catch (err) {
      return failure(err);
    }
    if (outcome && typeof /** @type {unknown} */ (/** @type {Promise<unknown>} */ (outcome).then) === "function") {
      return Promise.resolve(/** @type {Promise<{ payload: unknown, event?: Record<string, unknown> }>} */ (outcome)).then(toResult, failure);
    }
    return toResult(/** @type {{ payload: unknown, event?: Record<string, unknown> }} */ (outcome));
  }

  return {
    /**
     * 同步门面（测试与所有同步方法的正门）：如果撞上异步 handler，
     * 诚实报 async_required — 宿主入口走 handleEnvelope，不会撞。
     *
     * @param {InvokeEnvelope} invoke
     * @returns {HandleResult}
     */
    handle(invoke) {
      const result = run(invoke);
      if (typeof /** @type {unknown} */ (/** @type {Promise<HandleResult>} */ (result).then) === "function") {
        return {
          reply: createErrorReply(invoke, {
            code: "async_required",
            message: `${invoke.method} 是异步方法，请走 handleEnvelope`,
          }),
          events: [],
        };
      }
      return /** @type {HandleResult} */ (result);
    },

    /**
     * 异步门面（entry.cjs 的唯一门）：无论同步异步都包成 promise，
     * 错误照样装进错误信封（contextBridge 纯对象规矩）。
     *
     * @param {InvokeEnvelope} invoke
     * @returns {Promise<HandleResult>}
     */
    handleEnvelope(invoke) {
      return Promise.resolve(run(invoke));
    },
  };
}
