/**
 * DSH Desktop adapter (ticket 14) — ACP over stdio.
 *
 * Cubicle launches the *installed* DeepSeek Harness desktop binary in Node
 * mode (`ELECTRON_RUN_AS_NODE=1`) with the dsh launcher inside its app.asar,
 * under a Cubicle-owned `DSH_HOME` (`<dataDir>/engines/dsh/home`). The user's
 * `~/.dsh` is never read or written.
 *
 * ACP gives us persistent sessions, per-session model/reasoning options and
 * semantic updates. One server process hosts all employees; each employee
 * session is addressed by its ACP session id.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { appError } from "../../../shared/apperror.mjs";
import { readModelLibrary, ensureDshProfile, resolveModelForManifest } from "../../models/library.mjs";

const PROVIDER_ENV_PREFIX = "CUBICLE_DSH_KEY_";

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
 * @param {{ dataDir: string, dshExe?: string, dshEntry?: string }} options
 */
export function createDshAdapter({ dataDir, dshExe, dshEntry }) {
  const paths = defaultDesktopPaths(dataDir);
  const exe = dshExe || paths.exe;
  const entry = dshEntry || paths.entry;
  const engineRoot = path.join(dataDir, "engines", "dsh");
  const home = path.join(engineRoot, "home");

  /** @type {any} */
  let child = null;
  /** @type {Promise<void> | null} */
  let starting = null;
  let nextId = 1;
  /** @type {Map<number, { resolve: (value: any) => void, reject: (err: Error) => void, timer: any }>} */
  const pending = new Map();
  /** @type {Map<string, AcpSessionState>} */
  const sessions = new Map();
  /** @type {Map<string, any>} */
  const configOptions = new Map();
  let serverFingerprint = "";
  /** @type {readline.Interface | null} */
  let lines = null;

  function installed() {
    return existsSync(exe) && existsSync(entry);
  }

  function libraryFingerprint() {
    try {
      const stat = statSync(path.join(dataDir, "settings", "models.json"));
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "";
    }
  }

  function stopServer() {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("dsh ACP server stopped"));
    }
    pending.clear();
    sessions.clear();
    configOptions.clear();
    if (lines) {
      lines.close();
      lines = null;
    }
    if (child) {
      try {
        child.stdin?.end();
      } catch {
        // already closed
      }
      try {
        child.kill();
      } catch {
        // already gone
      }
      child = null;
    }
    starting = null;
  }

  /** @param {any} message */
  function send(message) {
    if (!child?.stdin) throw appError("engine_unavailable", "dsh ACP 进程未启动");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * @param {string} method
   * @param {any} params
   * @param {number} [timeoutMs]
   */
  function request(method, params, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        send({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Answer server->client requests (permissions + fs shims). */
  function answerServerRequest(/** @type {any} */ message) {
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
    send({ jsonrpc: "2.0", id: message.id, result });
  }

  /** @param {any} message */
  function routeUpdate(message) {
    const params = message.params ?? {};
    const acpSessionId = String(params.sessionId ?? "");
    const state = sessions.get(acpSessionId);
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
      configOptions.set(acpSessionId, update.configOptions);
    }
  }

  /** @param {any} message */
  function routeMessage(message) {
    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${message.error.message ?? "ACP error"}`));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined) {
      answerServerRequest(message);
      return;
    }
    if (message.method === "session/update") routeUpdate(message);
  }

  async function startServer() {
    if (child && starting === null) return;
    if (starting) return starting;
    starting = (async () => {
      if (!installed()) {
        throw appError(
          "engine_not_installed",
          "没找到 DeepSeek Harness desktop：安装桌面版，或设置 CUBICLE_DSH_EXE / CUBICLE_DSH_ENTRY。",
        );
      }
      const library = readModelLibrary(dataDir);
      const profile = ensureDshProfile(dataDir, library);
      if (!profile) throw appError("engine_not_configured", "dsh 还没有可用模型：去「设置 → 模型」添加供应商和模型。");
      mkdirSync(profile.profile, { recursive: true });
      serverFingerprint = libraryFingerprint();
      const env = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_NO_ASAR: undefined,
        DSH_HOME: profile.home,
        ...profile.env,
      };
      delete env.ELECTRON_NO_ASAR;
      const proc = spawn(exe, ["--expose-internals", entry, "--profile", "acp"], {
        cwd: profile.profile,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child = proc;
      proc.stderr?.setEncoding?.("utf8");
      proc.stderr?.on("data", (chunk) => process.stderr.write(`dsh: ${String(chunk).slice(-2000)}`));
      lines = readline.createInterface({ input: proc.stdout });
      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        routeMessage(message);
      });
      proc.on("exit", (code) => {
        const wasStarting = starting !== null;
        child = null;
        starting = null;
        if (wasStarting) return;
        for (const [, waiter] of pending) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error(`dsh ACP 退出（${code ?? "?"}）`));
        }
        pending.clear();
        sessions.clear();
      });
      await request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      starting = null;
    })().catch((err) => {
      stopServer();
      throw err;
    });
    return starting;
  }

  function ensureServerCurrent() {
    const fingerprint = libraryFingerprint();
    if (child && fingerprint !== serverFingerprint) {
      // Model-library changed: the running ACP process still holds the old
      // provider catalog. Restart it; persistent sessions survive on disk.
      stopServer();
    }
    return startServer();
  }

  /**
   * @param {string} acpSessionId
   * @param {any[]} options
   * @param {string} providerKey
   * @param {string} modelId
   */
  async function setModel(acpSessionId, options, providerKey, modelId) {
    const modelOption = options.find((/** @type {any} */ option) => option.id === "model");
    const wanted = JSON.stringify([providerKey, modelId]);
    const choice = modelOption?.options
      ?.flatMap((/** @type {any} */ group) => group.options ?? [])
      .find((/** @type {any} */ option) => option.value === wanted);
    if (!choice) {
      throw appError("engine_model_missing", `dsh 的 ACP 模型选项里没有 ${providerKey}/${modelId}：检查设置里的模型库`);
    }
    const result = await request("session/set_config_option", {
      sessionId: acpSessionId,
      configId: "model",
      value: wanted,
    });
    return result?.configOptions ?? options;
  }

  /**
   * @param {string} acpSessionId
   * @param {any[]} options
   * @param {string | null} effort
   */
  async function setReasoning(acpSessionId, options, effort) {
    if (!effort) return options;
    const reasoning = options.find((/** @type {any} */ option) => option.id === "reasoning_effort");
    const offered = reasoning?.options?.some((/** @type {any} */ option) => option.value === effort);
    if (!offered) return options;
    const result = await request("session/set_config_option", {
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
    const manifest = /** @type {Record<string, unknown>} */ (employee?.roleSnapshot?.manifest ?? {});
    const resolved = resolveModelForManifest(library, "dsh", manifest);
    await ensureServerCurrent();

    const previous = typeof session.sessionFile === "string" && session.sessionFile.startsWith("acp:")
      ? session.sessionFile.slice("acp:".length)
      : null;
    /** @type {any} */
    let created = null;
    /** @type {string | null} */
    let resumedId = null;
    if (previous) {
      try {
        created = await request("session/resume", {
          sessionId: previous,
          cwd: session.workspaceDir,
          mcpServers: [],
        });
        // ACP's resume reply carries configOptions, not a new sessionId.
        resumedId = previous;
      } catch {
        created = null;
      }
    }
    if (!created) {
      created = await request("session/new", { cwd: session.workspaceDir, mcpServers: [] });
    }
    const acpSessionId = String(resumedId ?? created.sessionId);
    configOptions.set(acpSessionId, created.configOptions ?? []);
    sessions.set(acpSessionId, { acpSessionId, onEvent, ref: resolved.ref });
    const options = await setModel(acpSessionId, created.configOptions ?? [], resolved.provider.key, resolved.model.id);
    await setReasoning(acpSessionId, options, resolved.reasoningEffort);

    let settled = false;
    let aborted = false;

    return {
      async prompt(text) {
        settled = false;
        aborted = false;
        try {
          const result = await request(
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
          send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: acpSessionId } });
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
     * Synchronous best-effort cleanup for host exit.
     */
    shutdown() {
      stopServer();
    },
    configFingerprint() {
      return libraryFingerprint();
    },
  };
}
