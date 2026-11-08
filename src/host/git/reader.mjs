/**
 * Read-only git access for the app (ticket 05 hard constraint:
 * 员工自主 commit，应用对 git 只读).
 *
 * One deep module stands between the app and the git binary:
 *
 *  - a subcommand allow-list gates every call (`git_write_forbidden` fires
 *    before anything spawns, so a write command is not "discouraged", it is
 *    impossible through this door);
 *  - every command it runs lands on a bounded audit log the host can surface
 *    (`task.gitAudit`) — acceptance evidence that the app never wrote;
 *  - failures come back as typed results (`not_a_git_workspace`,
 *    `no_head_commit`, `git_unavailable`, `git_output_overflow`, `git_timeout`),
 *    so callers show honest UI text instead of swallowing stack traces;
 *  - commands are ASYNC. `spawnSync` here used to freeze the single-writer host
 *    for up to 4 × 15s while artifacts were collected — every engine event and
 *    the 1s duty tick waited with it.
 *
 * `runCommand` is injectable so tests can probe policy (a runner that fails
 * to start) while the real runner spawns git through `git -C <workspace>`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { appError } from "../../shared/apperror.mjs";

const execFileAsync = promisify(execFile);

/** Commands this door ever lets through. Everything else is refused. */
const READ_ONLY_SUBCOMMANDS = new Set(["rev-parse", "diff", "status", "log", "show", "ls-files"]);

/** Bound the audit trail: a long-lived host must not keep every command forever. */
const AUDIT_CAP = 200;

/**
 * @typedef {{ status: number, stdout: string, stderr: string, failedToStart: boolean, errorCode?: string | null }} GitResult
 * @typedef {{ ok: true, sha: string } | { ok: false, code: string, message: string }} HeadResult
 * @typedef {{ status: string, path: string }} NameStatusEntry
 * @typedef {{ ok: true, headNow: string, stat: string, nameStatus: NameStatusEntry[], porcelain: string } | { ok: false, code: string, message: string }} DiffInfoResult
 */

/**
 * @param {{ runCommand?: (args: string[], cwd: string) => GitResult | Promise<GitResult> }} [options]
 */
export function createGitReader({ runCommand } = {}) {
  /** @type {string[]} */
  const audit = [];

  /** @type {(args: string[], cwd: string) => Promise<GitResult>} */
  const defaultRun = async (args, cwd) => {
    try {
      const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          // Chinese/non-ASCII paths come out as "\344\270..." octets by
          // default; the artifacts are for humans, not for git plumbing.
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.quotepath",
          GIT_CONFIG_VALUE_0: "false",
        },
      });
      return { status: 0, stdout: String(stdout), stderr: String(stderr), failedToStart: false, errorCode: null };
    } catch (err) {
      const error = /** @type {any} */ (err);
      const code = typeof error?.code === "string" ? error.code : null;
      if (code === "ENOENT") {
        return { status: -1, stdout: "", stderr: "git executable not found", failedToStart: true, errorCode: "ENOENT" };
      }
      return {
        status: typeof error?.status === "number" ? error.status : -1,
        stdout: typeof error?.stdout === "string" ? error.stdout : "",
        stderr: typeof error?.stderr === "string" ? error.stderr : String(error?.message ?? error),
        failedToStart: false,
        errorCode: code,
      };
    }
  };

  /** @type {(args: string[], cwd: string) => Promise<GitResult>} */
  const run = async (args, cwd) => (runCommand ? await runCommand(args, cwd) : await defaultRun(args, cwd));

  /**
   * The one door: allow-list first (synchronously, so a write command throws
   * before anything is spawned), audit always, spawn last.
   *
   * @param {string[]} args git subcommand + flags (no -C; cwd is the argument)
   * @param {string} cwd workspace directory (absolute)
   * @returns {Promise<GitResult>}
   */
  function exec(args, cwd) {
    const subcommand = String(args[0] ?? "");
    if (!READ_ONLY_SUBCOMMANDS.has(subcommand)) {
      throw appError("git_write_forbidden", `应用对 git 只读：拒绝执行 git ${subcommand || "(空命令)"}`);
    }
    audit.push(`git -C ${cwd} ${args.join(" ")}`);
    while (audit.length > AUDIT_CAP) audit.shift();
    return Promise.resolve()
      .then(() => run(args, cwd))
      .catch((err) => ({
        status: -1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        failedToStart: false,
        errorCode: "runner_threw",
      }));
  }

  /**
   * @param {GitResult} result
   * @returns {{ code: string, message: string }}
   */
  function classifyFailure(result) {
    if (result.failedToStart) {
      return { code: "git_unavailable", message: "本机找不到 git 命令：工单需要 git 工作区才能记录起点。" };
    }
    if (result.errorCode === "ENOBUFS" || result.errorCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { code: "git_output_overflow", message: "git 输出超过 8 MiB：先清理工作区或缩小 diff 范围，再重试。" };
    }
    if (result.errorCode === "ETIMEDOUT") {
      return { code: "git_timeout", message: "git 在 8 秒内没有返回：工作区可能过大或磁盘被占用。" };
    }
    if (/not a git repository|cannot change to|No such file or directory/i.test(result.stderr)) {
      return { code: "not_a_git_workspace", message: "工作区不是 git 仓库：无法记录起点 HEAD，工单不可用。" };
    }
    return { code: "no_head_commit", message: "git 工作区还没有任何提交：先让第一次提交落地，再开工单。" };
  }

  /**
   * @param {string} workspaceDir
   * @returns {Promise<HeadResult>}
   */
  async function head(workspaceDir) {
    const result = await exec(["rev-parse", "HEAD"], workspaceDir);
    if (result.status !== 0) return { ok: false, ...classifyFailure(result) };
    const sha = result.stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, ...classifyFailure(result) };
    return { ok: true, sha };
  }

  /**
   * Parse `git diff --name-status` output: `M\tpath`, `A\tpath`, `D\tpath`,
   * renames `R100\told\tnew` (the new path is the one that exists now).
   *
   * @param {string} output
   * @returns {NameStatusEntry[]}
   */
  function parseNameStatus(output) {
    /** @type {NameStatusEntry[]} */
    const entries = [];
    for (const line of output.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      const parts = line.split("\t");
      const status = String(parts[0] ?? "").charAt(0);
      const file = status === "R" || status === "C" ? parts[2] : parts[1];
      if (status && file) entries.push({ status, path: file });
    }
    return entries;
  }

  /**
   * Everything that changed since the recorded start HEAD: committed and
   * uncommitted alike (`git diff <base>` compares the working tree).
   *
   * @param {string} workspaceDir
   * @param {string} baseSha
   * @returns {Promise<DiffInfoResult>}
   */
  async function diffInfo(workspaceDir, baseSha) {
    const headNow = await head(workspaceDir);
    if (!headNow.ok) return headNow;
    // Three independent reads run concurrently: async git keeps the host
    // responsive; parallel keeps the artifact latency low.
    const [nameStatus, stat, porcelain] = await Promise.all([
      exec(["diff", "--name-status", baseSha], workspaceDir),
      exec(["diff", "--stat", baseSha], workspaceDir),
      exec(["status", "--porcelain"], workspaceDir),
    ]);
    if (nameStatus.status !== 0) {
      return {
        ok: false,
        code: "unknown_base_head",
        message: `起点 ${baseSha.slice(0, 7)} 在这个工作区里已经找不到了。`,
      };
    }
    return {
      ok: true,
      headNow: headNow.sha,
      stat: stat.stdout.trim(),
      nameStatus: parseNameStatus(nameStatus.stdout),
      porcelain: porcelain.stdout.trim(),
    };
  }

  return {
    exec,
    head,
    diffInfo,
    /** The commands this app process has run against git, in order (bounded). */
    audit() {
      return audit.slice();
    },
  };
}

/** @typedef {ReturnType<typeof createGitReader>} GitReader */
