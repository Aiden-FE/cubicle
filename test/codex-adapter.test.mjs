import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createCodexAdapter } from "../src/host/engine/codex/adapter.mjs";

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "cubicle-codex-"));
}

/**
 * A fake codex child process: the test pushes JSONL lines and closes the
 * streams; the adapter must normalize them like the real CLI's output.
 */
function fakeChild() {
  /** @type {any} */
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  /** @type {string[]} */
  child.killCalls = [];
  child.kill = (/** @type {string} */ signal) => {
    child.killCalls.push(String(signal ?? "SIGTERM"));
    // a killed CLI closes its streams
    child.stdout.end();
    child.stderr.end();
    setTimeout(() => child.emit("close", null), 5);
  };
  return child;
}

/** @param {string} dir */
function seedModels(dir) {
  const engineRoot = path.join(dir, "engines", "codex");
  mkdirSync(engineRoot, { recursive: true });
  writeFileSync(
    path.join(engineRoot, "models.json"),
    JSON.stringify({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "test-key", model: "cubicle-e2e-model" }),
    "utf8",
  );
  return engineRoot;
}

/** @param {string} dir @param {number} [employeeId] */
function sessionFixture(dir, employeeId = 1) {
  const workspaceDir = path.join(dir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  return {
    id: 11,
    employeeId,
    engine: "codex",
    agentDir: path.join(dir, "engines", "codex", "employee-1", "agent"),
    sessionsDir: path.join(dir, "engines", "codex", "employee-1", "sessions"),
    workspaceDir,
    sessionFile: null,
    updatedAt: new Date().toISOString(),
  };
}

test("open without models.json reports engine_not_configured", async () => {
  const dir = tempDir();
  try {
    const adapter = createCodexAdapter({ dataDir: dir, spawnProcess: () => fakeChild() });
    await assert.rejects(
      () => adapter.open({ employee: { name: "甲", roleSnapshot: { manifest: {} } }, session: sessionFixture(dir), onEvent: () => {} }),
      (/** @type {any} */ err) => err.code === "engine_not_configured",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prompt streams codex JSONL into normalized events and resolves on close", async () => {
  const dir = tempDir();
  try {
    seedModels(dir);
    const events = /** @type {any[]} */ ([]);
    let spawned = /** @type {any} */ (null);
    const adapter = createCodexAdapter({
      dataDir: dir,
      killTree: () => {}, spawnProcess: (_cmd, _args, _opts) => {
        spawned = fakeChild();
        return spawned;
      },
    });
    const live = await adapter.open({
      employee: { name: "甲", roleSnapshot: { name: "程序员", manifest: { persona: "严谨务实", tools: ["read"] } } },
      session: sessionFixture(dir),
      onEvent: (event) => events.push(event),
    });

    const done = live.prompt("读一下 hello.txt");
    spawned.stdout.write('{"type":"thread.started","thread_id":"thread-77"}\n');
    spawned.stdout.write('{"type":"turn.started"}\n');
    spawned.stdout.write('{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"cmd /c type hello.txt","aggregated_output":"","exit_code":null,"status":"in_progress"}}\n');
    spawned.stdout.write('{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"cmd /c type hello.txt","aggregated_output":"hi\\n","exit_code":0,"status":"completed"}}\n');
    spawned.stdout.write('{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"里面写了 hi"}}\n');
    spawned.stdout.write('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}\n');
    spawned.stdout.end();
    spawned.stderr.end();
    spawned.emit("close", 0);
    await done;

    assert.deepEqual(
      events.map((e) => e.type),
      ["turn_start", "tool_execution_start", "tool_execution_end", "text_delta", "turn_end", "agent_end"],
    );
    assert.equal(events.at(-1).status, "ok");
    // The adapter swallows codex's thread.started as session_start but keeps
    // it as the resume pointer (run-manager owns the timeline session_start).
    assert.equal(live.sessionFile(), "thread:thread-77");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI launch keeps the app-private CODEX_HOME, absolute -C, and the hook bridge env", async () => {
  const dir = tempDir();
  try {
    const engineRoot = seedModels(dir);
    let captured = /** @type {any} */ (null);
    const adapter = createCodexAdapter({
      dataDir: dir,
      killTree: () => {}, spawnProcess: (cmd, args, opts) => {
        captured = { cmd, args, opts };
        const child = fakeChild();
        setTimeout(() => {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0);
        }, 0);
        return child;
      },
    });
    const session = sessionFixture(dir);
    const live = await adapter.open({
      employee: { name: "甲", roleSnapshot: { name: "程序员", manifest: { persona: "persona-text" } } },
      session,
      onEvent: () => {},
    });
    await live.prompt("说一句");

    assert.match(captured.cmd, /codex$/);
    assert.deepEqual(captured.args.slice(0, 2), ["exec", "--json"]);
    assert.ok(captured.args.includes("-C"));
    assert.equal(captured.args[captured.args.indexOf("-C") + 1], session.workspaceDir);
    assert.ok(path.isAbsolute(captured.args[captured.args.indexOf("-C") + 1]));
    assert.equal(captured.opts.env.CODEX_HOME, engineRoot); // never ~/.codex
    assert.equal(captured.opts.env.CUBICLE_CODEX_KEY, "test-key");
    assert.ok(captured.opts.env.CUBICLE_POLICY_BRIDGE_URL?.startsWith("http://127.0.0.1:"));
    assert.ok(captured.opts.env.CUBICLE_POLICY_TOKEN?.length >= 16);

    // config.toml carries our provider AND the PreToolUse hook block.
    const config = readFileSync(path.join(engineRoot, "config.toml"), "utf8");
    assert.ok(config.includes("cubicle"));
    assert.ok(config.includes("PreToolUse"));
    assert.ok(existsSync(path.join(engineRoot, "hooks", "policy-hook.mjs")));
    assert.ok(existsSync(path.join(engineRoot, "hooks", "policy.mjs")));

    // The persona injection landed in the employee's private workspace.
    const agents = readFileSync(path.join(session.workspaceDir, "AGENTS.md"), "utf8");
    assert.ok(agents.includes("persona-text"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second prompt continues the same engine thread (exec resume)", async () => {
  const dir = tempDir();
  try {
    seedModels(dir);
    /** @type {{args: string[]}[]} */
    const launches = /** @type {any[]} */ ([]);
    const adapter = createCodexAdapter({
      dataDir: dir,
      killTree: () => {}, spawnProcess: (_cmd, args, _opts) => {
        launches.push({ args });
        const child = fakeChild();
        setTimeout(() => {
          child.stdout.write('{"type":"thread.started","thread_id":"thread-77"}\n');
          child.stdout.write('{"type":"turn.started"}\n');
          child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n');
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0);
        }, 0);
        return child;
      },
    });
    const live = await adapter.open({
      employee: { name: "甲", roleSnapshot: { manifest: {} } },
      session: sessionFixture(dir),
      onEvent: () => {},
    });
    await live.prompt("第一句");
    await live.prompt("第二句");

    assert.equal(launches[0].args[0], "exec");
    assert.equal(launches[1].args[0], "exec");
    assert.equal(launches[1].args[1], "resume");
    assert.ok(launches[1].args.includes("thread-77"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("abort kills the codex process; the run still ends with exactly one agent_end", async () => {
  const dir = tempDir();
  try {
    seedModels(dir);
    const events = /** @type {any[]} */ ([]);
    let spawned = /** @type {any} */ (null);
    const adapter = createCodexAdapter({
      dataDir: dir,
      killTree: () => {}, spawnProcess: () => {
        spawned = fakeChild();
        return spawned;
      },
    });
    const live = await adapter.open({
      employee: { name: "甲", roleSnapshot: { manifest: {} } },
      session: sessionFixture(dir),
      onEvent: (event) => events.push(event),
    });
    const done = live.prompt("慢慢说");
    spawned.stdout.write('{"type":"turn.started"}\n');
    await live.abort();
    assert.ok(spawned.killCalls.length > 0);
    await done;

    const ends = events.filter((e) => e.type === "agent_end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].status, "unknown"); // silent settle — honest unknown
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a deny verdict from the injected policy hook rides the stream as policy_blocked", async () => {
  const dir = tempDir();
  /** @type {null | { shutdown(): Promise<void> }} */
  let adapterRef = null;
  try {
    seedModels(dir);
    const events = /** @type {any[]} */ ([]);
    let spawned = /** @type {any} */ (null);
    const adapter = createCodexAdapter({
      dataDir: dir,
      killTree: () => {}, spawnProcess: () => {
        spawned = fakeChild();
        return spawned;
      },
    });
    adapterRef = adapter;
    const live = await adapter.open({
      employee: { name: "甲", roleSnapshot: { manifest: {} } },
      session: sessionFixture(dir),
      onEvent: (event) => events.push(event),
    });
    const bridgeEnv = adapter.bridgeEnv();
    assert.ok(bridgeEnv.CUBICLE_POLICY_BRIDGE_URL);

    const done = live.prompt("跑一下删除命令");
    spawned.stdout.write('{"type":"thread.started","thread_id":"thread-99"}\n');

    // The hook (here: the test) posts the verdict with its session id.
    const post = await fetch(`${bridgeEnv.CUBICLE_POLICY_BRIDGE_URL}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cubicle-token": bridgeEnv.CUBICLE_POLICY_TOKEN },
      body: JSON.stringify({
        session_id: "thread-99",
        tool_use_id: "call_rm",
        tool_name: "Bash",
        verdict: "deny",
        rule: "recursive-force-delete",
        reason: "工位上禁止递归强制删除（会连工作区一起毁掉）",
      }),
    });
    assert.equal(post.status, 200);

    // A verdict for an unknown/foreign session must not touch this stream.
    const stray = await fetch(`${bridgeEnv.CUBICLE_POLICY_BRIDGE_URL}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cubicle-token": bridgeEnv.CUBICLE_POLICY_TOKEN },
      body: JSON.stringify({ session_id: "other-thread", verdict: "deny", rule: "r", reason: "x" }),
    });
    assert.equal(stray.status, 200);

    // An unauthenticated post is refused.
    const hostile = await fetch(`${bridgeEnv.CUBICLE_POLICY_BRIDGE_URL}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cubicle-token": "nope" },
      body: JSON.stringify({ session_id: "thread-99", verdict: "deny" }),
    });
    assert.equal(hostile.status, 401);

    spawned.stdout.end();
    spawned.stderr.end();
    spawned.emit("close", 0);
    await done;

    const blocked = events.filter((e) => e.type === "policy_blocked");
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].toolCallId, "call_rm");
    assert.equal(blocked[0].rule, "recursive-force-delete");
  } finally {
    await adapterRef?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shutdown kills live codex children (host exit reclamation)", async () => {
  const dir = tempDir();
  try {
    seedModels(dir);
    let spawned = /** @type {any} */ (null);
    const adapter = createCodexAdapter({
      dataDir: dir,
      killTree: () => {}, spawnProcess: () => {
        spawned = fakeChild();
        return spawned;
      },
    });
    const live = await adapter.open({
      employee: { name: "甲", roleSnapshot: { manifest: {} } },
      session: sessionFixture(dir),
      onEvent: () => {},
    });
    void live.prompt("永远说下去");
    await adapter.shutdown();
    assert.ok(spawned.killCalls.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
