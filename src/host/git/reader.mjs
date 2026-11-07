/**
 * Read-only git access for the app (ticket 05 hard constraint:
 * 员工自主 commit，应用对 git 只读).
 *
 * One deep module stands between the app and the git binary:
 *
 *  - a subcommand allow-list gates every call (`git_write_forbidden` fires
 *    before anything spawns, so a write command is not "discouraged", it is
 *    impossible through this door);
 *  - every command it runs lands on an audit log the host can surface
 *    (`task.gitAudit`) — acceptance evidence that the app never wrote;
 *  - failures come back as typed results (`not_a_git_workspace`,
 *    `no_head_commit`, `git_unavailable`), so callers show honest UI text
 *    instead of swallowing stack traces.
 *
 * `runCommand` is injectable so tests can probe policy (a runner that fails
 * to start) while the real runner spawns git through `git -C <workspace>`.
 */
import { spawnSync } from "node:child_process";

import { appError } from "../../shared/apperror.mjs";

/** Commands this door ever lets through. Everything else is refused. */
const READ_ONLY_SUBCOMMANDS = new Set(["rev-parse", "diff", "status", "log", "show", "ls-files"]);

/**
 * @typedef {{ status: number, stdout: string, stderr: string, failedToStart: boolean }} GitResult
 * @typedef {{ ok: true, sha: string } | { ok: false, code: string, message: string }} HeadResult
 * @typedef {{ status: string, path: string }} NameStatusEntry
 * @typedef {{ ok: true, headNow: string, stat: string, nameStatus: NameStatusEntry[], porcelain: string } | { ok: false, code: string, message: string }} DiffInfoResult
 */

/**
 * @param {{ runCommand?: (args: string[], cwd: string) => GitResult }} [options]
 */
export function createGitReader({ runCommand } = {}) {
  /** @type {string[]} */
  const audit = [];

  /** @type {(args: string[], cwd: string) => GitResult} */
  const run =
    runCommand ??
    ((args, cwd) => {
      const result = spawnSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      });
      if (result.error) {
        return { status: -1, stdout: "", stderr: String(result.error.message ?? result.error), failedToStart: true };
      }
      return {
        status: result.status ?? -1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        failedToStart: false,
      };
    });

  /**
   * The one door: allow-list first, audit always, spawn last.
   *
   * @param {string[]} args git subcommand + flags (no -C; cwd is the argument)
   * @param {string} cwd workspace directory (absolute)
   * @returns {GitResult}
   */
  function exec(args, cwd) {
    const subcommand = String(args[0] ?? "");
    if (!READ_ONLY_SUBCOMMANDS.has(subcommand)) {
      throw appError("git_write_forbidden", `应用对 git 只读：拒绝执行 git ${subcommand || "(空命令)"}`);
    }
    audit.push(`git -C ${cwd} ${args.join(" ")}`);
    return run(args, cwd);
  }

  /**
   * @param {GitResult} result
   * @returns {{ code: string, message: string }}
   */
  function classifyFailure(result) {
    if (result.failedToStart) {
      return { code: "git_unavailable", message: "本机找不到 git 命令：工单需要 git 工作区才能记录起点。" };
    }
    if (/not a git repository/i.test(result.stderr)) {
      return { code: "not_a_git_workspace", message: "工作区不是 git 仓库：无法记录起点 HEAD，工单不可用。" };
    }
    return { code: "no_head_commit", message: "git 工作区还没有任何提交：先让第一次提交落地，再开工单。" };
  }

  /**
   * @param {string} workspaceDir
   * @returns {HeadResult}
   */
  function head(workspaceDir) {
    const result = exec(["rev-parse", "HEAD"], workspaceDir);
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
   * @returns {DiffInfoResult}
   */
  function diffInfo(workspaceDir, baseSha) {
    const headNow = head(workspaceDir);
    if (!headNow.ok) return headNow;
    const nameStatus = exec(["diff", "--name-status", baseSha], workspaceDir);
    if (nameStatus.status !== 0) {
      return {
        ok: false,
        code: "unknown_base_head",
        message: `起点 ${baseSha.slice(0, 7)} 在这个工作区里已经找不到了。`,
      };
    }
    const stat = exec(["diff", "--stat", baseSha], workspaceDir);
    const porcelain = exec(["status", "--porcelain"], workspaceDir);
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
    /** The commands this app process has run against git, in order. */
    audit() {
      return audit.slice();
    },
  };
}

/** @typedef {ReturnType<typeof createGitReader>} GitReader */
