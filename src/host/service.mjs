/**
 * AgentHost command/query bus.
 *
 * The host's only door: main forwards typed invoke envelopes in, this answers
 * with a reply envelope plus any domain events that the mutation produced.
 * Handlers never touch processes or transport — just the store.
 */
import { createReply, createErrorReply, createEvent, TOPICS } from "../shared/envelope.mjs";
import { appError } from "../shared/apperror.mjs";
import { draftTask, rejectPrompt, taskPrompt } from "./task/playbook.mjs";
import { enginePaths } from "./engine/paths.mjs";

/**
 * @typedef {import("../shared/envelope.mjs").InvokeEnvelope} InvokeEnvelope
 * @typedef {import("../shared/envelope.mjs").ReplyEnvelope} ReplyEnvelope
 * @typedef {import("../shared/envelope.mjs").EventEnvelope} EventEnvelope
 *
 * @typedef {{ reply: ReplyEnvelope, events: EventEnvelope[] }} HandleResult
 */

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
 * @param {{ store: ReturnType<import("./store.mjs").openStore>, hostInfo: { pid: number, startedAt: string }, runManager?: ReturnType<import("./engine/run-manager.mjs").createRunManager>, git?: Pick<import("./git/reader.mjs").GitReader, "head" | "audit"> }} deps
 */
export function createService({ store, hostInfo, runManager, git }) {
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
   * @type {Record<string, (payload: unknown) => { payload: unknown, event?: Record<string, unknown> }>}
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
      return {
        payload: {
          task,
          sessions,
          artifacts: store.listArtifacts({ taskId }),
          tokens: store.taskTokenSummary(taskId),
          iterations: sessions.length,
        },
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
  };

  return {
    /**
     * @param {InvokeEnvelope} invoke
     * @returns {HandleResult}
     */
    handle(invoke) {
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
      try {
        const { payload, event } = method(invoke.payload);
        const events = event ? [createEvent(TOPICS.domainChanged, event)] : [];
        return { reply: createReply(invoke, payload), events };
      } catch (err) {
        const code = /** @type {{ code?: string }} */ (err ?? {}).code ?? "internal";
        const message = err instanceof Error ? err.message : String(err);
        return { reply: createErrorReply(invoke, { code, message }), events: [] };
      }
    },
  };
}
