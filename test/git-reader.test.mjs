import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createGitReader } from "../src/host/git/reader.mjs";

/**
 * Real-git tests: the reader speaks to an actual repository in a temp dir
 * (plain Node test process may spawn git; the allow-list is what gates the
 * app). Expected commit shas come from git's own commit output — an
 * independent source, not re-derived through the reader.
 *
 * @param {string} name
 */
async function withRepo(name) {
  const root = await mkdtemp(path.join(tmpdir(), `cubicle-git-${name}-`));
  const workspace = path.join(root, "workspace");
  mkdir(workspace, { recursive: true });
  const git = (/** @type {string[]} */ args) =>
    execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
  if (name !== "plain" && name !== "empty") {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.name", "fixture"]);
    git(["config", "user.email", "fixture@example.test"]);
  }
  return { workspace, git, dispose: () => rm(root, { recursive: true, force: true }) };
}

/**
 * @param {(args: string[]) => string} git
 * @param {string} message
 */
function commitAll(git, message) {
  git(["add", "-A"]);
  const out = git(["commit", "-m", message]);
  const match = /\[.*?\s([0-9a-f]{7,})\]/.exec(out);
  assert.ok(match, `commit output unexpectedly had no sha: ${out}`);
  return /** @type {string} */ (match[1]);
}

test("head resolves the current commit of a real repository", async () => {
  const { workspace, git, dispose } = await withRepo("head");
  const reader = createGitReader();
  try {
    await writeFile(path.join(workspace, "a.txt"), "one\n", "utf8");
    const short = commitAll(git, "initial");
    const result = reader.head(workspace);
    assert.equal(result.ok, true);
    assert.equal(/** @type {{ sha: string }} */ (result).sha.startsWith(short.slice(0, 7)), true);
    assert.equal(/** @type {{ sha: string }} */ (result).sha.length, 40);
  } finally {
    await dispose();
  }
});

test("head on a plain directory says it is not a git workspace", async () => {
  const { workspace, dispose } = await withRepo("plain");
  const reader = createGitReader();
  try {
    const result = reader.head(workspace);
    assert.equal(result.ok, false);
    assert.equal(/** @type {{ code: string }} */ (result).code, "not_a_git_workspace");
  } finally {
    await dispose();
  }
});

test("head on a repository without commits is reported distinctly", async () => {
  const { workspace, git, dispose } = await withRepo("empty");
  const reader = createGitReader();
  try {
    git(["init", "-q", "-b", "main"]);
    const result = reader.head(workspace);
    assert.equal(result.ok, false);
    assert.equal(/** @type {{ code: string }} */ (result).code, "no_head_commit");
  } finally {
    await dispose();
  }
});

test("diffInfo lists everything changed since the recorded start HEAD, committed or not", async () => {
  const { workspace, git, dispose } = await withRepo("diff");
  const reader = createGitReader();
  try {
    git(["config", "user.name", "fixture"]);
    git(["config", "user.email", "fixture@example.test"]);
    await writeFile(path.join(workspace, "a.txt"), "one\n", "utf8");
    const base = commitAll(git, "base");

    // the employee's work: one committed edit, one committed add,
    // one still-uncommitted edit — the diff is relative to the base.
    await writeFile(path.join(workspace, "a.txt"), "one\ntwo\n", "utf8");
    commitAll(git, "edit a");
    await writeFile(path.join(workspace, "b.txt"), "new\n", "utf8");
    commitAll(git, "add b");
    await writeFile(path.join(workspace, "a.txt"), "one\ntwo\nthree\n", "utf8");

    const info = reader.diffInfo(workspace, base);
    assert.equal(info.ok, true);
    const result = /** @type {{ headNow: string, stat: string, nameStatus: { status: string, path: string }[], porcelain: string }} */ (info);
    assert.equal(result.headNow.length, 40);
    assert.notEqual(result.headNow, base);
    assert.deepEqual(result.nameStatus, [
      { status: "M", path: "a.txt" },
      { status: "A", path: "b.txt" },
    ]);
    assert.match(result.stat, /2 files? changed/);
    // the uncommitted edit is visible in status even though a.txt is also
    // listed in the committed diff
    assert.match(result.porcelain, /M\s+a\.txt/);
  } finally {
    await dispose();
  }
});

test("the reader refuses every non-read-only git command without spawning it", async () => {
  const { workspace, git, dispose } = await withRepo("gate");
  const reader = createGitReader();
  try {
    await writeFile(path.join(workspace, "a.txt"), "one\n", "utf8");
    git(["add", "-A"]);
    git(["commit", "-m", "base"]);

    for (const args of [["add", "-A"], ["commit", "-m", "app wrote this"], ["push"], ["reset", "--hard"]]) {
      assert.throws(
        () => reader.exec(args, workspace),
        (/** @type {{ code?: string }} */ err) => err.code === "git_write_forbidden",
      );
    }
    // no phantom commit was produced — HEAD is where the fixture left it
    const log = spawnSync("git", ["-C", workspace, "log", "--oneline"], { encoding: "utf8" });
    assert.equal(log.stdout.trim().split(/\r?\n/).length, 1);
  } finally {
    await dispose();
  }
});

test("git missing on the machine surfaces as git_unavailable, not a crash", () => {
  const reader = createGitReader({
    runCommand: () => ({ status: -1, stdout: "", stderr: "", failedToStart: true }),
  });
  const result = reader.head("C:\\somewhere");
  assert.equal(result.ok, false);
  assert.equal(/** @type {{ code: string }} */ (result).code, "git_unavailable");
});

test("every command the app ran is on the audit log, and all are read-only", async () => {
  const { workspace, git, dispose } = await withRepo("audit");
  const reader = createGitReader();
  try {
    git(["config", "user.name", "fixture"]);
    git(["config", "user.email", "fixture@example.test"]);
    await writeFile(path.join(workspace, "a.txt"), "one\n", "utf8");
    const base = commitAll(git, "base");
    await writeFile(path.join(workspace, "a.txt"), "one\ntwo\n", "utf8");
    commitAll(git, "second");
    reader.diffInfo(workspace, base);
    const commands = reader.audit();
    assert.ok(commands.length >= 3);
    assert.ok(commands.every((line) => line.startsWith(`git -C ${workspace} `)));
    assert.ok(
      commands.every((line) => /^git -C .+ (rev-parse|diff|status|log|show|ls-files)(\s|$)/.test(line)),
      commands.join(" | "),
    );
  } finally {
    await dispose();
  }
});
