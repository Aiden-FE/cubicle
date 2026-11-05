/**
 * AgentHost command/query bus.
 *
 * The host's only door: main forwards typed invoke envelopes in, this answers
 * with a reply envelope plus any domain events that the mutation produced.
 * Handlers never touch processes or transport — just the store.
 */
import { createReply, createErrorReply, createEvent, TOPICS } from "../shared/envelope.mjs";
import { appError } from "../shared/apperror.mjs";

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
 * @param {{ store: ReturnType<import("./store.mjs").openStore>, hostInfo: { pid: number, startedAt: string } }} deps
 */
export function createService({ store, hostInfo }) {
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
      return { payload: company, event: { reason: "company.create", companyId: company.id } };
    },

    "projectGroup.create"(payload) {
      const companyId = Number(/** @type {Record<string, unknown>} */ (payload ?? {}).companyId);
      if (!Number.isInteger(companyId) || companyId <= 0) {
        throw appError("invalid_payload", "companyId must be a positive integer");
      }
      const name = requireName(payload, "name");
      const group = store.createProjectGroup({ companyId, name });
      const desks = store.listDesks({ groupId: group.id });
      return {
        payload: { group, desks },
        event: { reason: "projectGroup.create", groupId: group.id },
      };
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
