/**
 * codex engine adapter — the CLI host form of decision 14's dual-host
 * protocol (ticket 11). Same `open()` seam as the pi adapter:
 *
 *   open({ employee, session, onEvent }) → { prompt, abort, sessionFile }
 *
 * but the engine lives in a child process: one `codex exec --json` per
 * prompt, its JSONL normalized by ./normalize.mjs. Everything stays inside
 * the application's private data dir:
 *
 *   engines/codex/            CODEX_HOME (config.toml, sessions/, hooks/) —
 *                             never the user's ~/.codex
 *   engines/codex/models.json BYOK provider config the engine center writes
 *
 * Runtime policy (the 07 vocabulary, enforced here too): codex's PreToolUse
 * hook runs the host's policy.mjs (copied into the engine dir — one rule
 * table, both engines) and a deny is reported back over a loopback bridge
 * so it rides the same `policy_blocked` normalized event. A blocked call
 * never executes.
 *
 * Process reclamation (the CLI-host duty ticket 04 left here): every live
 * child is tracked; `abort()` and host `shutdown()` kill the process tree
 * (taskkill /T with a plain kill fallback), so no codex outlives its run.
 *
 * Injection channels proven against codex-cli 0.163.0: the role persona is
 * written into the employee's workspace AGENTS.md (codex folds it into its
 * instructions), and the policy hook is injected through CODEX_HOME config.
 */
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appError } from "../../../shared/apperror.mjs";
import { readAcademyMcpDocSync, renderCodexMcpToml, resolveMcpEnv } from "../../academy/neo-mcp.mjs";
import { readModelLibrary, resolveModelForManifest } from "../../models/library.mjs";
import { decideToolAccess } from "../policy.mjs";
import { startPolicyBridge } from "./bridge.mjs";
import { createCodexNormalizer } from "./normalize.mjs";
import { createPidLedger, engineLedgerFile } from "../child-ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The provider key the app's own models.json must declare (BYOK, like pi's). */
const PROVIDER_KEY = "cubicle";

/** How much codex stderr is kept to explain a run that died silently. */
const STDERR_TAIL_CHARS = 2000;

/** A single JSONL line above this is diagnostic noise, not a payload. */
const MAX_LINE_CHARS = 8 * 1024 * 1024;

/**
 * @typedef {import("../events.mjs").NormalizedEvent} NormalizedEvent
 * @typedef {import("../../store.mjs").EmployeeSessionRow} EmployeeSessionRow
 * @typedef {import("./bridge.mjs").PolicyVerdict} PolicyVerdict
 */

/**
 * @param {object} options
 * @param {string} options.dataDir the app data root
 * @param {string} [options.codexBinary] resolved codex path (tests/detection inject)
 * @param {(cmd: string, args: string[], opts: object) => any} [options.spawnProcess] child spawner (tests swap this)
 * @param {(pid: number) => void} [options.killTree] process-tree killer (tests swap this)
 */
export function createCodexAdapter({ dataDir, codexBinary = "codex", spawnProcess, killTree }) {
  const engineRoot = path.join(dataDir, "engines", "codex");
  // 票 10 crash hygiene: every spawned child lands in the ledger BEFORE it
  // works, and leaves it when it settles. A hard kill runs no exit hooks, so
  // the next launch reads this file and sweeps the orphans (sweepCrashResidue).
  const ledger = createPidLedger({ file: engineLedgerFile(dataDir, "codex") });
  const ledgerName = path.basename(String(codexBinary)).replace(/\.exe$/i, "").toLowerCase();

  /** @type {Promise<import("./bridge.mjs").PolicyBridge> | null} */
  let bridgePromise = null;
  /** the settled bridge, kept as a plain value so runOne spawns synchronously */
  /** @type {{ url: string, token: string } | null} */
  let bridgeInfo = null;
  /** threadId → the live session's event sink + workspace (verdicts/decisions route back) */
  /** @type {Map<string, { onEvent: (event: NormalizedEvent) => void, workspaceDir: string }>} */
  const streamsByThread = new Map();
  /** live child processes by employeeSessionId, for abort/shutdown */
  /** @type {Map<number, any>} */
  const liveChildren = new Map();
  /** children WE killed (abort / shutdown): their exit is not an engine error */
  /** @type {Set<any>} */
  const killedByUs = new Set();

  function bridge() {
    if (!bridgePromise) {
      bridgePromise = startPolicyBridge({
        onVerdict: (verdict) => {
          if (verdict.verdict !== "deny") return; // allow verdicts stay off the stream
          const entry = streamsByThread.get(String(verdict.session_id));
          if (!entry) return; // foreign or finished session — never invent events
          entry.onEvent({
            type: "policy_blocked",
            toolCallId: String(verdict.tool_use_id ?? "unknown"),
            toolName: String(verdict.tool_name ?? "unknown"),
            rule: String(verdict.rule ?? "policy"),
            reason: String(verdict.reason ?? "这次操作被策略拦下"),
          });
        },
        decide: (question) => {
          // The rule table lives here, not in the engine directory the agent
          // can edit. Unknown session/workspace = deny (fail closed).
          const entry = streamsByThread.get(String(question.session_id));
          if (!entry) return { verdict: "deny", rule: "unknown-session", reason: "策略无法判定：未知引擎会话" };
          return decideToolAccess({
            toolName: question.tool_name,
            args: question.tool_input,
            workspaceDir: entry.workspaceDir,
          });
        },
      })
        .then((b) => {
          bridgeInfo = { url: b.url, token: b.token };
          return b;
        })
        .catch((err) => {
          bridgePromise = null; // let the next open retry a failed bridge
          throw err;
        });
    }
    return bridgePromise;
  }

  /** The env every codex child gets (also handed to the policy hook it runs). */
  function bridgeEnv() {
    if (!bridgeInfo) return {}; // bridge down: the hook still blocks, just without telemetry
    return { CUBICLE_POLICY_BRIDGE_URL: bridgeInfo.url, CUBICLE_POLICY_TOKEN: bridgeInfo.token };
  }

  /**
   * Per-employee CODEX_HOME (ticket 14: one model per home).
   * @param {EmployeeSessionRow} session
   */
  function homeFor(session) {
    return session.agentDir;
  }

  /**
   * The academy assembler's engine-agnostic canonical MCP file for this
   * employee (票 a02, reference shape since a04): env:VAR references resolved
   * HERE, at engine open — Cubicle-side launch injection; missing secrets fail
   * with a readable academy_mcp_env_missing before codex ever starts. Missing
   * or empty file → null (today's behavior).
   *
   * @param {string} home
   * @returns {import("../../academy/neo-mcp.mjs").McpServers | null}
   */
  function readAcademyMcp(home) {
    return readAcademyMcpDocSync(path.join(home, "academy-mcp.json"));
  }

  /** @param {EmployeeSessionRow} session */
  function ensureHookInstall(session) {
    const hooksDir = path.join(homeFor(session), "hooks");
    mkdirSync(hooksDir, { recursive: true });
    // Only the thin client is copied. The rule table stays in the host and is
    // asked over /decide — copying policy.mjs here would let the agent edit
    // its own gate.
    copyFileSync(path.join(here, "policy-hook.mjs"), path.join(hooksDir, "policy-hook.mjs"));
  }

  /**
   * Resolve the employee's model from the app library, then render this
   * employee's private CODEX_HOME (models.json + config.toml) on every open.
   *
   * @param {EmployeeSessionRow} session
   * @param {any} employee
   * @returns {{ home: string, model: string, reasoningEffort: string | null }}
   */
  function writeEngineConfig(session, employee) {
    const library = readModelLibrary(dataDir);
    // 票 a01: model choice is pinned on the snapshot itself (v1 kept it under manifest).
    const pins = /** @type {Record<string, unknown>} */ (employee?.roleSnapshot ?? {});
    const resolved = resolveModelForManifest(library, "codex", pins);
    const home = homeFor(session);
    const reasoning = resolved.reasoningEffort && resolved.reasoningEffort !== "off" ? resolved.reasoningEffort : null;

    const hookPath = path.join(home, "hooks", "policy-hook.mjs");
    const hookPosix = hookPath.replace(/\\/g, "/");
    const hookWindows = hookPath.replace(/\\/g, "\\\\");
    const toml = [
      `model_provider = "${PROVIDER_KEY}"`,
      `model = ${JSON.stringify(resolved.model.id)}`,
      ...(reasoning ? [`model_reasoning_effort = ${JSON.stringify(reasoning)}`] : []),
      "",
      `[model_providers.${PROVIDER_KEY}]`,
      `name = "Cubicle"`,
      `base_url = "${resolved.provider.baseUrl.replace(/\\/g, "\\\\")}"`,
      `env_key = "CUBICLE_CODEX_KEY"`,
      `wire_api = "responses"`,
      `requires_openai_auth = false`,
      "",
      // The BYOK key is codex's own auth (env_key). The shell tool children
      // must not inherit it: the employee could print its environment into a
      // command artifact. Hooks keep the bridge vars (they need them).
      "[shell_environment_policy]",
      `inherit = "all"`,
      `exclude = ["CUBICLE_CODEX_KEY"]`,
      "",
      "[hooks]",
      "[[hooks.PreToolUse]]",
      "[[hooks.PreToolUse.hooks]]",
      'type = "command"',
      // codex 0.163 rejects a hook entry that lacks the generic `command`
      // field ("missing field `command` in `hooks`"), even though it is the
      // `commandWindows` variant that actually runs on this platform — both
      // must be present, and a bad config kills the run before any JSONL.
      `command = "node \\"${hookPosix}\\""`,
      `commandWindows = "node \\"${hookWindows}\\""`,
      "timeout = 15",
      "",
    ].join("\n");
    mkdirSync(home, { recursive: true });
    // 票 a04 (launch injection): the assembler leaves the canonical
    // academy-mcp.json in env:VAR REFERENCE shape; codex's [mcp_servers.*]
    // only eats literal values, so we resolve the references right here (this
    // employee's private config.toml is the only place a value lands, same
    // posture as models.json). No file → exactly today's config.
    const academy = readAcademyMcp(home);
    const withMcp = academy === null ? toml : `${toml}\n${renderCodexMcpToml(resolveMcpEnv(academy, process.env))}\n`;
    const configFile = path.join(home, "config.toml");
    writeFileSync(configFile, withMcp, "utf8");
    // resolved MCP secret values land here (machine-local): owner-only on POSIX
    if (process.platform !== "win32") chmodSync(configFile, 0o600);
    writeFileSync(
      path.join(home, "models.json"),
      `${JSON.stringify(
        {
          baseUrl: resolved.provider.baseUrl,
          apiKey: resolved.provider.apiKey,
          model: resolved.model.id,
          reasoningEffort: reasoning,
          providerKey: resolved.provider.key,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return { home, model: resolved.model.id, reasoningEffort: reasoning };
  }

  /**
   * Capability injection, codex style: the frozen role persona goes into
   * the employee's private workspace AGENTS.md, which codex folds into its
   * instructions for that cwd (proven end-to-end in the ticket-11 spike).
   *
   * @param {EmployeeSessionRow} session
   * @param {any} employee
   */
  function writePersonaFile(session, employee) {
    // 票 a01: persona / role label are role content — they ride the live role
    // row the store attaches (employee.role), not the version-pin snapshot.
    const roleManifest = /** @type {Record<string, any>} */ (employee?.role?.manifest ?? {});
    const persona = String(roleManifest.persona ?? "").trim();
    const roleLabel = String(employee?.roleName ?? employee?.role?.name ?? employee?.name ?? "员工");
    const employeeName = String(employee?.name ?? "员工");
    mkdirSync(session.workspaceDir, { recursive: true });
    writeFileSync(
      path.join(session.workspaceDir, "AGENTS.md"),
      [
        `# 员工「${employeeName}」（角色：${roleLabel}）的工作区约定`,
        "",
        persona || "按角色职责工作。",
        "",
        `- 你的专属工作目录就是这个目录；改动都发生在自己的工作区内。`,
        `- 引擎策略由 Cubicle 宿主注入并在每次工具调用前执行，被拦下的命令不会执行。`,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  /**
   * One `codex exec` (or `exec resume` once a thread exists) to completion.
   * `context.threadId` is an out-param: the caller reads back the thread id
   * this run established (fresh or resumed) for the next prompt's resume.
   *
   * @param {{ session: EmployeeSessionRow, onEvent: (event: NormalizedEvent) => void, text: string, threadId: string | null, context: { threadId: string | null }, home: string }} input
   * @returns {Promise<void>}
   */
  async function runOne({ session, onEvent, text, threadId, context, home }) {
    const models = JSON.parse(readFileSync(path.join(home, "models.json"), "utf8"));
    // --json / -s / -C are `codex exec` LEVEL options: placed after the
    // `resume` subcommand they are rejected ("unexpected argument '-s'"), so
    // the launch flags go first and the subcommand comes last.
    const launchFlags = [
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-hook-trust",
      "-s",
      "danger-full-access",
      "-C",
      session.workspaceDir,
    ];
    // A prompt that starts with "-" would be parsed as a CLI option. A leading
    // space keeps it positional and is invisible to the model.
    const promptArg = text.startsWith("-") ? ` ${text}` : text;
    const args = threadId
      ? ["exec", ...launchFlags, "resume", threadId, promptArg]
      : ["exec", ...launchFlags, promptArg];

    const env = {
      ...process.env,
      CODEX_HOME: home, // per-employee private home — never ~/.codex
      CUBICLE_CODEX_KEY: String(models.apiKey ?? ""),
      ...bridgeEnv(),
    };

    const spawnFn =
      spawnProcess ??
      ((/** @type {string} */ cmd, /** @type {string[]} */ a, /** @type {object} */ o) =>
        spawn(cmd, a, { ...o, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));

    let child;
    try {
      child = spawnFn(codexBinary, args, { cwd: session.workspaceDir, env });
    } catch (err) {
      throw appError("engine_spawn_failed", `codex 启动失败：${err instanceof Error ? err.message : err}`);
    }
    liveChildren.set(session.id, child);
    if (typeof child.pid === "number") {
      ledger.record({
        pid: child.pid,
        name: ledgerName,
        startedAt: new Date().toISOString(),
        commandLineHint: session.workspaceDir,
      });
    }

    return await new Promise((resolve, reject) => {
      const normalizer = createCodexNormalizer();
      let stdoutTail = "";
      let stderrTail = "";
      let emitted = 0;
      let settled = false;

      /** Forward one normalized event, counting what reached the stream. */
      /** @param {NormalizedEvent} event */
      const emit = (event) => {
        emitted += 1;
        onEvent(event);
      };

      /** @param {unknown} chunk */
      const noteStderr = (chunk) => {
        // Keep only the tail: it becomes the human-visible reason when codex
        // dies before its first JSONL line.
        stderrTail = `${stderrTail}${String(chunk)}`.slice(-STDERR_TAIL_CHARS);
      };

      /** Only clean up entries that still belong to THIS child. */
      const cleanup = () => {
        if (liveChildren.get(session.id) === child) liveChildren.delete(session.id);
        killedByUs.delete(child);
        if (typeof child.pid === "number") ledger.forget(child.pid);
        if (context.threadId && streamsByThread.get(context.threadId)?.onEvent === onEvent) {
          streamsByThread.delete(context.threadId);
        }
      };

      /** @param {string} chunk */
      const onStdout = (chunk) => {
        stdoutTail += String(chunk);
        // A command that prints a huge line without ever ending it must not
        // accumulate unboundedly (`+=` is quadratic on a growing string).
        if (stdoutTail.length > MAX_LINE_CHARS && !stdoutTail.includes("\n")) {
          stdoutTail = "";
          return;
        }
        const lines = stdoutTail.split(/\r?\n/);
        stdoutTail = lines.pop() ?? "";
        for (const line of lines) {
          // codex's thread.started is folded away as a session_start event —
          // run-manager owns the timeline's single 会话开始 line; here it is
          // the resume pointer and the bridge's correlation key.
          if (line.includes('"thread.started"')) {
            try {
              const record = JSON.parse(line.trim());
              if (record?.type === "thread.started" && typeof record.thread_id === "string") {
                streamsByThread.set(record.thread_id, { onEvent, workspaceDir: session.workspaceDir });
                context.threadId = record.thread_id;
              }
            } catch {
              // the normalizer counts it as noise
            }
          }
          // Forward as the line lands: the 工位 animates while codex works.
          for (const event of normalizer.push(line)) {
            if (event.type === "session_start") continue; // folded (see above)
            emit(event);
          }
        }
      };

      const finish = (/** @type {number | null} */ exitCode) => {
        if (settled) return;
        settled = true;
        const killed = killedByUs.has(child);
        const cleanExit = killed || exitCode === 0;
        if (!cleanExit) {
          // A non-zero exit is a failed run even if some turns already
          // completed: a partial success must not land as 'completed'.
          emit({
            type: "error",
            code: "engine_exec_failed",
            message: `codex exec 退出码 ${exitCode ?? "?"}：${stderrTail.trim().slice(0, 400) || "（无 stderr 输出）"}`,
          });
        }
        for (const event of normalizer.end(cleanExit)) {
          if (event.type === "session_start") continue; // folded (see above)
          emit(event);
        }
        cleanup();
        resolve();
      };

      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", onStdout);
      child.stderr?.on("data", noteStderr);
      child.on("close", finish);
      child.on("error", (/** @type {any} */ err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(appError("engine_spawn_failed", `codex 进程故障：${err?.message ?? err}`));
      });
    });
  }

  /**
   * @param {{ employee: any, session: EmployeeSessionRow, onEvent: (event: NormalizedEvent) => void }} input
   * @returns {Promise<{ prompt(text: string): Promise<void>, abort(): Promise<void>, sessionFile(): string | null }>}
   */
  async function open({ employee, session, onEvent }) {
    writeEngineConfig(session, employee); // validates library, renders this employee's CODEX_HOME
    ensureHookInstall(session);
    await bridge(); // the verdict endpoint every codex child (and its hook) gets

    const context = {
      threadId:
        typeof session.sessionFile === "string" && session.sessionFile.startsWith("thread:")
          ? session.sessionFile.slice("thread:".length)
          : null,
    };
    // A resumed thread is known before its first line lands: map it now, so a
    // hook verdict can never arrive for a session this run considers foreign.
    if (context.threadId) {
      streamsByThread.set(context.threadId, { onEvent, workspaceDir: session.workspaceDir });
    }

    return {
      async prompt(text) {
        // Re-copy the gate immediately before the engine runs: a model that
        // edited hooks/ or config.toml between prompts gets the host's copy
        // back. (The real boundary is still OS-level; this closes the cheap
        // self-uninstall path.)
        const current = writeEngineConfig(session, employee);
        ensureHookInstall(session);
        writePersonaFile(session, employee);
        await runOne({ session, onEvent, text, threadId: context.threadId, context, home: current.home });
      },
      async abort() {
        const child = liveChildren.get(session.id);
        if (!child) return;
        // Resolve only after the child is really closed. Returning when
        // taskkill is merely launched is what allowed a late agent_end to be
        // attributed to the NEXT run after a cancel + immediate redispatch.
        /** @type {Promise<void>} */
        const closed = new Promise((resolve) => {
          if (typeof child.exitCode === "number" || child.signalCode) {
            resolve(undefined);
            return;
          }
          if (typeof child.once === "function") child.once("close", () => resolve(undefined));
          else resolve(undefined);
        });
        killChild(child);
        await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
      },
      sessionFile() {
        return context.threadId ? `thread:${context.threadId}` : null;
      },
    };
  }

  /**
   * A cheap fingerprint of the BYOK config. Live sessions are reused across
   * conversations; without this, editing models.json's model/base_url never
   * reaches the already-open engine session.
   *
   * @returns {string | null}
   */
  function configFingerprint() {
    try {
      const stat = statSync(path.join(dataDir, "settings", "models.json"));
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  }

  /** @param {any} child */
  function killChild(child) {
    if (!child) return;
    killedByUs.add(child);
    if (process.platform === "win32" && child.pid) {
      // The CLI tree (codex + git + shell helpers) must die with the session.
      try {
        (killTree ?? defaultKillTree)(child.pid);
      } catch {
        // fall through to the direct kill
      }
    }
    if (typeof child.kill === "function") {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
  }

  /** @param {number} pid */
  function defaultKillTree(pid) {
    try {
      // taskkill works on this machine where tasklist is unreliable; if the
      // spawn itself is refused, the direct child.kill() below still lands.
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // ignored: the direct kill follows
    }
  }

  /** Kill every live codex child (sync; taskkill for the tree is fire-and-forget). */
  function killAllChildren() {
    for (const child of liveChildren.values()) killChild(child);
    liveChildren.clear();
  }

  return {
    open,
    configFingerprint,
    bridgeEnv,
    /** 票 10 capability: codex keeps its thread under CODEX_HOME and resumes
     *  it via `codex exec resume <thread_id>` (proven end-to-end in ticket 11). */
    resumes: true,
    /**
     * Synchronous, best-effort: kill every live codex child. Registered on the
     * host's `exit` so even an abrupt SIGTERM (supervisor stop → kill) leaves
     * no codex process parented under the AgentHost (票 04 留的回收义务).
     * A hard kill (taskkill /F) never runs this — that path is covered by the
     * children.json ledger + sweepCrashResidue at next launch (票 10).
     */
    killChildrenSync: killAllChildren,
    /** Host exit: no codex child may outlive the AgentHost (also closes the bridge). */
    async shutdown() {
      killAllChildren();
      if (bridgePromise) {
        const b = await bridgePromise.catch(() => null);
        await b?.close();
        bridgePromise = null;
      }
    },
  };
}
