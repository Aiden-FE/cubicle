/**
 * pi engine adapter — the SDK host form of decision 14's dual-host protocol.
 *
 * Runs the pi coding-agent SDK inside the AgentHost (utilityProcess), with
 * every path pinned inside the application's private data directory:
 *
 *   engines/pi/models.json      BYOK model config (never reads ~/.pi)
 *   engines/pi/auth.json        optional BYOK auth store
 *   engines/pi/employee-<id>/   agent dir + session dir + workspace
 *
 * Capability injection: the employee's role persona goes into the system
 * prompt, the role's tool list becomes the session allowlist, and 票 a02's
 * academy assembly lands the role's skills (links in `<agentDir>/skills`,
 * noSkills + additionalSkillPaths) and MCP (`<agentDir>/mcp.json` + built-in
 * MCP extension) — per employee, roles never see each other.
 *
 * Runtime policy (ticket 07): an inline pi extension runs the host policy
 * gate at every tool_call — a denied call never executes, and the verdict
 * rides the normalized stream as `policy_blocked` so the工位 can show it.
 * `noExtensions: true` only blocks FILE-based extensions (the user's ~/.pi
 * stays out); inline factories always load — verified against pi 1.5.0's
 * resource loader.
 *
 * The live session is reused across conversations: the resume pointer (pi's
 * session file) is re-opened after a host restart, so a conversation can
 * continue (票 04: 可续).
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

import { appError } from "../../../shared/apperror.mjs";
import { readModelLibrary, resolveModelForManifest } from "../../models/library.mjs";
import { decideToolAccess } from "../policy.mjs";
import { normalizePiEvent } from "./normalize.mjs";

/** The provider key the app's own models.json must declare (BYOK, decision 04). */
const PROVIDER_KEY = "cubicle";

/**
 * @typedef {import("../events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("../../store.mjs").EmployeeSessionRow} EmployeeSessionRow
 */

/**
 * @param {object} options
 * @param {string} options.dataDir the app data root
 * @param {() => Promise<any>} [options.moduleImporter] pi module loader (tests swap this)
 */
export function createPiAdapter({ dataDir, moduleImporter }) {
  /** @type {Promise<any> | null} */
  let piModule = null;

  function loadPi() {
    if (!piModule) {
      piModule = (moduleImporter ?? (() => import("@earendil-works/pi-coding-agent")))();
    }
    return piModule;
  }

  /**
   * Resolve the model for an employee: "default" picks the app-configured
   * provider's first model; "provider/id" (manifest.model) picks exactly.
   *
   * @param {any} modelRuntime
   * @param {string} requested
   */
  function pickModel(modelRuntime, requested) {
    if (requested && requested !== "default" && requested.includes("/")) {
      const [provider, ...rest] = requested.split("/");
      const model = modelRuntime.getModel(provider, rest.join("/"));
      if (!model) {
        throw appError("engine_model_missing", `model ${requested} is not configured in engines/pi/models.json`);
      }
      return model;
    }
    const mine = modelRuntime
      .getAllModels()
      .find((/** @type {{ provider: string }} */ m) => m.provider === PROVIDER_KEY);
    if (!mine) {
      throw appError(
        "engine_model_missing",
        `no models configured under provider "${PROVIDER_KEY}" in engines/pi/models.json`,
      );
    }
    return modelRuntime.getModel(mine.provider, mine.id);
  }

  /**
   * Inline extension: the policy gate bolted onto pi's tool_call hook.
   * Deny → the call never runs AND the refusal is announced on the
   * normalized stream (票 07: 被策略拒绝时工位有可见提示，不静默).
   *
   * @param {(event: import("../events.mjs").NormalizedEvent) => void} onEvent
   * @param {string} workspaceDir the employee workspace this session is pinned to
   * @returns {(piRuntime: any) => void}
   */
  function policyExtension(onEvent, workspaceDir) {
    return (piRuntime) => {
      piRuntime.on("tool_call", (/** @type {any} */ event) => {
        const verdict = decideToolAccess({ toolName: event.toolName, args: event.input, workspaceDir });
        if (verdict.verdict === "deny") {
          onEvent({
            type: "policy_blocked",
            toolCallId: String(event.toolCallId ?? "unknown"),
            toolName: String(event.toolName ?? "unknown"),
            rule: verdict.rule,
            reason: verdict.reason,
          });
          return { block: true, reason: `策略拦截（${verdict.rule}）：${verdict.reason}` };
        }
        return undefined;
      });
    };
  }

  /**
   * @param {{ employee: any, session: EmployeeSessionRow, onEvent: (event: NormalizedEvent) => void }} input
   * @returns {Promise<{ prompt(text: string): Promise<void>, abort(): Promise<void>, sessionFile(): string | null }>}
   */
  async function open({ employee, session, onEvent }) {
    // 票 a01: the frozen snapshot pins the model choice (engine / provider /
    // model / reasoning effort); persona and tools are role content and ride
    // the live projection-cache row (employee.role) the store attaches.
    const pins = /** @type {Record<string, any>} */ (employee?.roleSnapshot ?? {});
    const roleManifest = /** @type {Record<string, any>} */ (employee?.role?.manifest ?? {});

    const engineRoot = path.join(dataDir, "engines", "pi");
    const modelsPath = path.join(engineRoot, "models.json");
    const library = readModelLibrary(dataDir);
    const resolved = resolveModelForManifest(library, "pi", pins);
    if (!existsSync(modelsPath)) {
      throw appError(
        "engine_not_configured",
        "pi 的派生模型配置还没生成：去「设置 → 模型」保存一次模型。",
      );
    }
    const authPath = path.join(engineRoot, "auth.json");

    const pi = await loadPi();

    // Created per open so a model-library edit lands on the next conversation.
    const modelRuntime = await pi.ModelRuntime.create({
      modelsPath,
      authPath,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const model = pickModel(modelRuntime, resolved.ref);

    // Resume story (decision 14 lifecycle): re-open the stored session file;
    // otherwise continue the newest one in the employee's private dir; a
    // brand-new conversation file comes out of continueRecent when empty.
    const sessionManager =
      session.sessionFile && existsSync(session.sessionFile)
        ? pi.SessionManager.open(session.sessionFile, session.sessionsDir, session.workspaceDir)
        : pi.SessionManager.continueRecent(session.workspaceDir, session.sessionsDir);

    const persona = String(roleManifest.persona ?? "").trim();
    const roleLabel = String(employee?.roleName ?? employee?.role?.name ?? employee?.name ?? "员工");
    const employeeName = String(employee?.name ?? "员工");

    // 票 a02 角色隔离: pi's SDK otherwise folds in the machine's global skill
    // roots (~/.agents/skills & friends — 串味). `noSkills: true` turns every
    // default off; `additionalSkillPaths` re-enables exactly this employee's
    // skills dir — the junction links the academy assembler put there.
    const skillsDir = path.join(session.agentDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    // MCP: the assembler renders pi-native <agentDir>/mcp.json when the role
    // declares servers; the built-in MCP extension is only pulled in then, so
    // employees without MCP behave exactly as before this ticket.
    const mcpReady = existsSync(path.join(session.agentDir, "mcp.json"));
    const extensionFactories = [
      policyExtension(onEvent, session.workspaceDir),
      ...(mcpReady && typeof pi.createMcpExtension === "function" ? [pi.createMcpExtension()] : []),
    ];

    const resourceLoader = new pi.DefaultResourceLoader({
      cwd: session.workspaceDir,
      agentDir: session.agentDir,
      appendSystemPrompt: persona
        ? [`你是员工「${employeeName}」，角色：${roleLabel}。${persona}`]
        : [`你是员工「${employeeName}」，角色：${roleLabel}。`],
      noExtensions: true,
      noSkills: true,
      additionalSkillPaths: [skillsDir],
      extensionFactories,
    });
    await resourceLoader.reload();

    const tools = Array.isArray(roleManifest.tools) ? /** @type {string[]} */ (roleManifest.tools) : undefined;

    const created = await pi.createAgentSession({
      cwd: session.workspaceDir,
      agentDir: session.agentDir,
      modelRuntime,
      model,
      sessionManager,
      resourceLoader,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(resolved.reasoningEffort ? { thinkingLevel: /** @type {any} */ (resolved.reasoningEffort) } : {}),
    });
    const agentSession = created.session;

    agentSession.subscribe((/** @type {unknown} */ rawEvent) => {
      for (const event of normalizePiEvent(rawEvent)) onEvent(event);
    });

    return {
      async prompt(text) {
        await agentSession.prompt(text);
      },
      async abort() {
        await agentSession.abort();
      },
      sessionFile() {
        return agentSession.sessionFile ?? sessionManager.getSessionFile() ?? null;
      },
    };
  }

  return {
    open,
    /**
     * models.json 指纹：run-manager 用它判断已打开的 SDK 会话是否还代表
     * 当前 BYOK 配置（否则改模型后要到重启才生效）。
     *
     * @returns {string | null}
     */
    configFingerprint() {
      try {
        const stat = statSync(path.join(dataDir, "engines", "pi", "models.json"));
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return null;
      }
    },
    /**
     * 票 10 capability: pi persists its conversation as a session file and
     * re-opens it (SessionManager.open / continueRecent — proven across host
     * restarts since ticket 04), so a recorded pointer means 续跑 is real.
     */
    resumes: true,
    /** Load the pi module (and pay its import cost) before the first run. */
    warm() {
      void loadPi().catch(() => {
        piModule = null; // let the next open retry a failed load
      });
    },
  };
}
