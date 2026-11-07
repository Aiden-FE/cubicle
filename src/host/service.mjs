/**
 * AgentHost command/query bus.
 *
 * The host's only door: main forwards typed invoke envelopes in, this answers
 * with a reply envelope plus any domain events that the mutation produced.
 * Handlers never touch processes or transport — just the store.
 */
import { createReply, createErrorReply, createEvent, TOPICS } from "../shared/envelope.mjs";
import { appError } from "../shared/apperror.mjs";
import { deriveEngineBadge, installGuide } from "./engine/badge.mjs";

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
 * @param {{
 *   store: ReturnType<import("./store.mjs").openStore>,
 *   hostInfo: { pid: number, startedAt: string },
 *   runManager?: ReturnType<import("./engine/run-manager.mjs").createRunManager>,
 *   engineProbe?: { startProbe(engine: string): Promise<{ status: string }> },
 *   engineFacts?: (engine: string) => { configured: boolean },
 *   notifyDomain?: (payload: Record<string, unknown>) => void,
 * }} deps
 */
export function createService({ store, hostInfo, runManager, engineProbe, engineFacts, notifyDomain }) {
  /** 引擎运行方法共用同一道闸门：没有 run manager 就没有 run.*。 */
  function requireRunManager() {
    if (!runManager) throw appError("engine_unavailable", "引擎运行时未启动");
    return runManager;
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
