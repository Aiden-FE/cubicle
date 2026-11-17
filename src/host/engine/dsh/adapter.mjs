/**
 * DSH Desktop adapter (ticket 14) — ACP over stdio.
 *
 * Cubicle launches the *installed* DeepSeek Harness desktop binary in Node
 * mode (`ELECTRON_RUN_AS_NODE=1`) with the dsh launcher inside its app.asar,
 * under a Cubicle-owned `DSH_HOME`. The user's `~/.dsh` is never read or
 * written.
 *
 * 票 a02 角色隔离: the shared `engines/dsh/home` is DEAD. Each employee gets
 * their own ACP server process under their own DSH_HOME
 * (`engines/dsh/employee-<id>/agent`) — the same folder the academy assembler
 * links the employee's role skills into (`<DSH_HOME>/skills`), with
 * `DSH_AGENTS_HOME` redirected to a private empty dir so the machine's global
 * `~/.agents/skills` never leaks in. Two employees running in parallel cannot
 * see each other's skills. (Rationale for per-employee home vs customSkillDirs
 * is in the ticket Answer.)
 *
 * ACP gives us persistent sessions, per-session model/reasoning options and
 * semantic updates. Each employee session is addressed by its ACP session id
 * inside that employee's server.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { appError } from "../../../shared/apperror.mjs";
import { toAcpMcpServers } from "../../academy/neo-mcp.mjs";
import { readModelLibrary, ensureDshProfile, resolveModelForManifest } from "../../models/library.mjs";

/**
 * @param {string} dataDir
 */
function defaultDesktopPaths(dataDir) {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Local");
  const exe = process.env.CUBICLE_DSH_EXE || path.join(localAppData, "Programs", "DeepSeek Harness", "DeepSeek Harness.exe");
  const entry =
    process.env.CUBICLE_DSH_ENTRY ||
    path.join(path.dirname(exe), "resources", "app.asar", "dsh", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  return { exe, entry };
}

/**
 * @typedef {object} AcpSessionState
 * @property {string} acpSessionId
 * @property {(event: import("../events.mjs").NormalizedEvent) => void} onEvent
 * @property {string} ref
 *
 * @typedef {object} DshServer
 * @property {number} employeeId
 * @property {string} home            the employee's DSH_HOME (their engine agent dir)
 * @property {any} child
 * @property {Promise<void> | null} starting
 * @property {number} nextId
 * @property {Map<number, { resolve: (value: any) => void, reject: (err: Error) => void, timer: any }>} pending
 * @property {Map<string, AcpSessionState>} sessions
 * @property {Map<string, any>} configOptions
 * @property {string} serverFingerprint
 * @property {readline.Interface | null} lines
 *
 * @param {{ dataDir: string, dshExe?: string, dshEntry?: string }} options
 */
export function createDshAdapter({ dataDir, dshExe, dshEntry }) {
  const paths = defaultDesktopPaths(dataDir);
  const exe = dshExe || paths.exe;
  const entry = dshEntry || paths.entry;

  /** one ACP server per employee (票 a02: never a shared home/process) */
  /** @type {Map<number, DshServer>} */
  const servers = new Map();

  function libraryFingerprint() {
    try {
      const stat = statSync(path.join(dataDir, "settings", "models.json"));
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "";
    }
  }

  function installed() {
    return existsSync(exe) && existsSync(entry);
  }

  /** @param {DshServer} srv */
  function stopServer(srv) {
    for (const [, entry] of srv.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("dsh ACP server stopped"));
    }
    srv.pending.clear();
    srv.sessions.clear();
    srv.configOptions.clear();
    if (srv.lines) {
      srv.lines.close();
      srv.lines = null;
    }
    if (srv.child) {
      try {
        srv.child.stdin?.end();
      } catch {
        // already closed
      }
      try {
        srv.child.kill();
      } catch {
        // already gone
      }
      srv.child = null;
    }
    srv.starting = null;
  }

  /** @param {DshServer} srv @param {any} message */
  function send(srv, message) {
    if (!srv.child?.stdin) throw appError("engine_unavailable", "dsh ACP 进程未启动");
    srv.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * @param {DshServer} srv
   * @param {string} method
   * @param {any} params
   * @param {number} [timeoutMs]
   */
  function request(srv, method, params, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = srv.nextId++;
      const timer = setTimeout(() => {
        srv.pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, timeoutMs);
      srv.pending.set(id, { resolve, reject, timer });
      try {
        send(srv, { jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        srv.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Answer server->client requests (permissions + fs shims). @param {DshServer} srv @param {any} message */
  function answerServerRequest(srv, message) {
    let result = {};
    if (message.method === "session/request_permission") {
      const options = message.params?.options ?? [];
      const allow = options.find((/** @type {any} */ option) => option.kind === "allow_once" || option.optionId === "allow-once");
      result = { outcome: { outcome: "selected", optionId: allow?.optionId ?? options[0]?.optionId ?? "allow-once" } };
    } else if (message.method === "fs/read_text_file") {
      result = { content: "" };
    } else if (message.method === "fs/write_text_file") {
      result = {};
    }
    send(srv, { jsonrpc: "2.0", id: message.id, result });
  }

  /** @param {DshServer} srv @param {any} message */
  function routeUpdate(srv, message) {
    const params = message.params ?? {};
    const acpSessionId = String(params.sessionId ?? "");
    const state = srv.sessions.get(acpSessionId);
    if (!state) return;
    const update = params.update ?? {};
    const type = String(update.sessionUpdate ?? "");
    if (type === "agent_message_chunk") {
      if (update.content?.type === "text") state.onEvent({ type: "text_delta", text: String(update.content.text ?? "") });
      return;
    }
    if (type === "agent_thought_chunk") {
      if (update.content?.type === "text") state.onEvent({ type: "thinking_delta", text: String(update.content.text ?? "") });
      return;
    }
    if (type === "tool_call") {
      state.onEvent({
        type: "tool_execution_start",
        toolCallId: String(update.toolCallId ?? update.tool_call_id ?? "unknown"),
        toolName: String(update.kind ?? update.title ?? "tool"),
        args: update.rawInput ?? update.raw_input,
      });
      return;
    }
    if (type === "tool_call_update") {
      const status = String(update.status ?? "");
      if (status !== "completed" && status !== "failed") return;
      state.onEvent({
        type: "tool_execution_end",
        toolCallId: String(update.toolCallId ?? update.tool_call_id ?? "unknown"),
        toolName: String(update.kind ?? update.title ?? "tool"),
        isError: status === "failed",
        result: update.rawOutput ?? update.raw_output,
      });
      return;
    }
    if (type === "config_option_update" && Array.isArray(update.configOptions)) {
      srv.configOptions.set(acpSessionId, update.configOptions);
    }
  }

  /** @param {DshServer} srv @param {any} message */
  function routeMessage(srv, message) {
    if (message.id !== undefined && message.method === undefined) {
      const waiter = srv.pending.get(message.id);
      if (!waiter) return;
      srv.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${message.error.message ?? "ACP error"}`));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined) {
      answerServerRequest(srv, message);
      return;
    }
    if (message.method === "session/update") routeUpdate(srv, message);
  }

  /** Start (or return the in-flight start of) one employee's ACP server. */
  async function startServer(srv) {
    if (srv.child && srv.starting === null) return;
    if (srv.starting) return srv.starting;
    srv.starting = (async () => {
      if (!installed()) {
        throw appError(
          "engine_not_installed",
          "没找到 DeepSeek Harness desktop：安装桌面版，或设置 CUBICLE_DSH_EXE / CUBICLE_DSH_ENTRY。",
        );
      }
      const library = readModelLibrary(dataDir);
      const profile = ensureDshProfile(dataDir, library, srv.employeeId);
      if (!profile) throw appError("engine_not_configured", "dsh 还没有可用模型：去「设置 → 模型」添加供应商和模型。");
      mkdirSync(profile.profile, { recursive: true });
      // 票 a02: mask the machine's shared agents root (~/.agents/skills —
      // 串味) behind a per-employee empty dir; the only skills dsh can see are
      // the academy-linked ones under <DSH_HOME>/skills.
      const agentsMask = path.join(srv.home, "agents-home");
      mkdirSync(agentsMask, { recursive: true });
      srv.serverFingerprint = libraryFingerprint();
      const env = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_NO_ASAR: undefined,
        DSH_HOME: srv.home,
        DSH_AGENTS_HOME: agentsMask,
        ...profile.env,
      };
      delete env.ELECTRON_NO_ASAR;
      const proc = spawn(exe, ["--expose-internals", entry, "--profile", "acp"], {
        cwd: profile.profile,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      srv.child = proc;
      proc.stderr?.setEncoding?.("utf8");
      proc.stderr?.on("data", (chunk) => process.stderr.write(`dsh[${srv.employeeId}]: ${String(chunk).slice(-2000)}`));
      srv.lines = readline.createInterface({ input: proc.stdout });
      srv.lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        routeMessage(srv, message);
      });
      proc.on("exit", (code) => {
        const wasStarting = srv.starting !== null;
        srv.child = null;
        srv.starting = null;
        if (wasStarting) return;
        for (const [, waiter] of srv.pending) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error(`dsh ACP 退出（${code ?? "?"}）`));
        }
        srv.pending.clear();
        srv.sessions.clear();
      });
      await request(srv, "initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      srv.starting = null;
    })().catch((err) => {
      stopServer(srv);
      throw err;
    });
    return srv.starting;
  }

  /**
   * @param {number} employeeId
   * @param {string} home the employee's engine agent dir = DSH_HOME
   * @returns {Promise<DshServer>}
   */
  async function ensureServerCurrent(employeeId, home) {
    let srv = servers.get(employeeId);
    if (!srv) {
      srv = {
        employeeId,
        home,
        child: null,
        starting: null,
        nextId: 1,
        pending: new Map(),
        sessions: new Map(),
        configOptions: new Map(),
        serverFingerprint: "",
        lines: null,
      };
      servers.set(employeeId, srv);
    }
    if (srv.child && libraryFingerprint() !== srv.serverFingerprint) {
      // Model-library changed: this employee's ACP process still holds the old
      // provider catalog. Restart it; persistent sessions survive on disk.
      stopServer(srv);
    }
    await startServer(srv);
    return srv;
  }

  /**
   * 票 a02 MCP: the academy assembler renders the role's servers into the
   * employee's academy-mcp.json (values already env:VAR-resolved); ACP takes
   * them per session. No file / empty → [] exactly as today.
   *
   * @param {string} agentDir
   * @returns {unknown[]}
   */
  function acpMcpServersFor(agentDir) {
    const file = path.join(agentDir, "academy-mcp.json");
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return [];
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      throw appError(
        "academy_mcp_invalid",
        `${file} 不是合法 JSON（academy 装配的产物）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const serversDoc = doc?.servers;
    if (typeof serversDoc !== "object" || serversDoc === null || Array.isArray(serversDoc)) return [];
    return toAcpMcpServers(/** @type {import("../../academy/neo-mcp.mjs").McpServers} */ (serversDoc));
  }

  /**
   * @param {DshServer} srv
   * @param {string} acpSessionId
   * @param {any[]} options
   * @param {string} providerKey
   * @param {string} modelId
   */
  async function setModel(srv, acpSessionId, options, providerKey, modelId) {
    const modelOption = options.find((/** @type {any} */ option) => option.id === "model");
    const wanted = JSON.stringify([providerKey, modelId]);
    const choice = modelOption?.options
      ?.flatMap((/** @type {any} */ group) => group.options ?? [])
      .find((/** @type {any} */ option) => option.value === wanted);
    if (!choice) {
      throw appError("engine_model_missing", `dsh 的 ACP 模型选项里没有 ${providerKey}/${modelId}：检查设置里的模型库`);
    }
    const result = await request(srv, "session/set_config_option", {
      sessionId: acpSessionId,
      configId: "model",
      value: wanted,
    });
    return result?.configOptions ?? options;
  }

  /**
   * @param {DshServer} srv
   * @param {string} acpSessionId
   * @param {any[]} options
   * @param {string | null} effort
   */
  async function setReasoning(srv, acpSessionId, options, effort) {
    if (!effort) return options;
    const reasoning = options.find((/** @type {any} */ option) => option.id === "reasoning_effort");
    const offered = reasoning?.options?.some((/** @type {any} */ option) => option.value === effort);
    if (!offered) return options;
    const result = await request(srv, "session/set_config_option", {
      sessionId: acpSessionId,
      configId: "reasoning_effort",
      value: effort,
    });
    return result?.configOptions ?? options;
  }

  /**
   * @param {{ employee: any, session: import("../../store.mjs").EmployeeSessionRow, onEvent: (event: any) => void }} input
   * @returns {Promise<{ prompt(text: string): Promise<void>, abort(): Promise<void>, sessionFile(): string | null }>}
   */
  async function open({ employee, session, onEvent }) {
    const library = readModelLibrary(dataDir);
    // 票 a01: model choice is pinned on the snapshot itself (v1 kept it under manifest).
    const pins = /** @type {Record<string, unknown>} */ (employee?.roleSnapshot ?? {});
    const resolved = resolveModelForManifest(library, "dsh", pins);
    const srv = await ensureServerCurrent(session.employeeId, session.agentDir);
    const mcpServers = acpMcpServersFor(session.agentDir);

    const previous = typeof session.sessionFile === "string" && session.sessionFile.startsWith("acp:")
      ? session.sessionFile.slice("acp:".length)
      : null;
    /** @type {any} */
    let created = null;
    /** @type {string | null} */
    let resumedId = null;
    if (previous) {
      try {
        created = await request(srv, "session/resume", {
          sessionId: previous,
          cwd: session.workspaceDir,
          mcpServers,
        });
        // ACP's resume reply carries configOptions, not a new sessionId.
        resumedId = previous;
      } catch {
        created = null;
      }
    }
    if (!created) {
      created = await request(srv, "session/new", { cwd: session.workspaceDir, mcpServers });
    }
    const acpSessionId = String(resumedId ?? created.sessionId);
    srv.configOptions.set(acpSessionId, created.configOptions ?? []);
    srv.sessions.set(acpSessionId, { acpSessionId, onEvent, ref: resolved.ref });
    const options = await setModel(srv, acpSessionId, created.configOptions ?? [], resolved.provider.key, resolved.model.id);
    await setReasoning(srv, acpSessionId, options, resolved.reasoningEffort);

    let settled = false;
    let aborted = false;

    return {
      async prompt(text) {
        settled = false;
        aborted = false;
        try {
          const result = await request(
            srv,
            "session/prompt",
            { sessionId: acpSessionId, prompt: [{ type: "text", text }] },
            30 * 60_000,
          );
          const stopReason = String(result?.stopReason ?? "end_turn");
          const ok = stopReason === "end_turn";
          if (!settled) {
            settled = true;
            onEvent({ type: "turn_end", status: ok ? "ok" : "failed" });
            onEvent({ type: "agent_end", status: ok ? "ok" : "failed" });
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            onEvent({
              type: "error",
              code: "engine_failed",
              message: err instanceof Error ? err.message : String(err),
            });
            onEvent({ type: "agent_end", status: "failed" });
          }
        }
      },
      async abort() {
        aborted = true;
        // ACP cancel is a notification (the server answers by settling the
        // in-flight prompt with stopReason=cancelled).
        try {
          send(srv, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: acpSessionId } });
        } catch {
          // process already gone
        }
        if (!settled) {
          settled = true;
          onEvent({ type: "turn_end", status: "failed" });
          onEvent({ type: "agent_end", status: "failed" });
        }
      },
      sessionFile() {
        return `acp:${acpSessionId}`;
      },
    };
  }

  return {
    open,
    resumes: true,
    installed,
    /**
     * Synchronous best-effort cleanup for host exit — every employee's server.
     */
    shutdown() {
      for (const [, srv] of servers) stopServer(srv);
      servers.clear();
    },
    configFingerprint() {
      return libraryFingerprint();
    },
  };
}
