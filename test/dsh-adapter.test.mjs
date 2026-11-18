/**
 * 票 a02 acceptance 3: dsh no longer shares ONE `engines/dsh/home` — every
 * employee runs their own ACP server under their own DSH_HOME (per-employee
 * skills land there), and two employees running in parallel never see each
 * other's skills. Also asserts the ACP session keeps passing empty mcpServers
 * when no MCP was assembled, and the mapped shape when it was.
 *
 * The "dsh binary" is a scripted fake ACP server (plain node) — the adapter's
 * protocol side is real JSON-RPC over stdio; the model side is the normal
 * library fixture.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDshAdapter } from "../src/host/engine/dsh/adapter.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";
import { ensureDshProfile, saveModel, saveProvider, readModelLibrary } from "../src/host/models/library.mjs";

const FAKE_ACP = `
import fs from "node:fs";
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += String(c);
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    handle(m);
  }
});
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
function handle(m) {
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: 1 } });
  else if (m.method === "session/new") {
    fs.appendFileSync(process.env.FAKE_DUMP, JSON.stringify({
      env: { DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME },
      params: m.params,
    }) + "\\n");
    send({ jsonrpc: "2.0", id: m.id, result: { sessionId: "acp-" + process.pid, configOptions: [
      { id: "model", options: [{ options: [{ value: process.env.FAKE_MODEL_VALUE }] }] },
    ] } });
  } else if (m.method === "session/set_config_option") send({ jsonrpc: "2.0", id: m.id, result: { configOptions: [] } });
  else if (m.method === "session/prompt") send({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } });
}
`;

/** @param {string} name */
function withDir(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `cubicle-dshadapter-${name}-`));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** @param {string} dir */
function seedLibrary(dir) {
  saveProvider(dir, { displayName: "Acme", key: "acme", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-test", protocol: "openai-responses" });
  saveModel(dir, "acme", { id: "acme-max", displayName: "Acme Max", contextWindow: 100000, maxTokens: 8000, input: ["text"], reasoning: false });
  return readModelLibrary(dir);
}

/**
 * @param {string} dir data dir
 * @param {number} employeeId
 * @param {string} engine
 */
function sessionRowFor(dir, employeeId, engine = "dsh") {
  const dirs = enginePaths(dir, engine, employeeId);
  mkdirSync(dirs.agentDir, { recursive: true });
  mkdirSync(dirs.sessionsDir, { recursive: true });
  mkdirSync(dirs.workspaceDir, { recursive: true });
  return {
    id: 100 + employeeId,
    employeeId,
    engine,
    agentDir: dirs.agentDir,
    sessionsDir: dirs.sessionsDir,
    workspaceDir: dirs.workspaceDir,
    sessionFile: null,
    updatedAt: new Date().toISOString(),
  };
}

test("dsh runs one ACP server per employee with its OWN DSH_HOME — no shared home", async () => {
  const { dir, dispose } = withDir("per-home");
  try {
    const library = seedLibrary(dir);
    const fakeEntry = path.join(dir, "fake-acp.mjs");
    writeFileSync(fakeEntry, FAKE_ACP, "utf8");
    const dump = path.join(dir, "dump.jsonl");
    process.env.FAKE_DUMP = dump;
    process.env.FAKE_MODEL_VALUE = JSON.stringify(["acme", "acme-max"]);
    try {
      const adapter = createDshAdapter({ dataDir: dir, dshExe: process.execPath, dshEntry: fakeEntry });
      const e1 = { id: 1, name: "A", roleSnapshot: { roleKey: "alpha-role", domains: [], locks: {}, engine: "dsh", model: "acme/acme-max" }, role: { key: "alpha-role", source: "neo", manifest: {} } };
      const e2 = { id: 2, name: "B", roleSnapshot: { roleKey: "beta-role", domains: [], locks: {}, engine: "dsh", model: "acme/acme-max" }, role: { key: "beta-role", source: "neo", manifest: {} } };

      const s1 = sessionRowFor(dir, 1);
      const s2 = sessionRowFor(dir, 2);
      const live1 = await adapter.open({ employee: e1, session: s1, onEvent: () => {} });
      const live2 = await adapter.open({ employee: e2, session: s2, onEvent: () => {} });
      await live1.prompt("干活");
      await live2.prompt("干活");
      adapter.shutdown();

      const rows = readFileSync(dump, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(rows.length, 2, "two employees produced two server sessions");
      const homes = new Set(rows.map((r) => r.env.DSH_HOME));
      assert.equal(homes.size, 2, "each employee got a distinct DSH_HOME");
      const home1 = path.join(enginePaths(dir, "dsh", 1).agentDir);
      const home2 = path.join(enginePaths(dir, "dsh", 2).agentDir);
      assert.ok(homes.has(home1) && homes.has(home2));
      // the old shared home is gone for good
      assert.equal(rmSyncSafe(path.join(dir, "engines", "dsh", "home")), false, "no shared engines/dsh/home was created");
      // DSH_AGENTS_HOME is redirected per employee (masks the machine's ~/.agents/skills)
      const agentHomes = new Set(rows.map((r) => r.env.DSH_AGENTS_HOME));
      assert.equal(agentHomes.size, 2);
      // The ACP session still receives the session-scoped cwd + mcpServers list.
      for (const row of rows) {
        assert.ok(Array.isArray(row.params.mcpServers));
      }
    } finally {
      delete process.env.FAKE_DUMP;
      delete process.env.FAKE_MODEL_VALUE;
    }
  } finally {
    dispose();
  }
});

/** @param {string} p @returns {boolean} true when the path exists (was created) */
function rmSyncSafe(p) {
  try {
    rmSync(p, { recursive: true, force: false });
    return true;
  } catch {
    return false;
  }
}

test("dsh session/new keeps mcpServers empty without assembly, mapped when academy MCP was assembled", async () => {
  const { dir, dispose } = withDir("mcp-acp");
  try {
    seedLibrary(dir);
    const fakeEntry = path.join(dir, "fake-acp.mjs");
    writeFileSync(fakeEntry, FAKE_ACP, "utf8");
    const dump = path.join(dir, "dump.jsonl");
    process.env.FAKE_DUMP = dump;
    process.env.FAKE_MODEL_VALUE = JSON.stringify(["acme", "acme-max"]);
    try {
      const adapter = createDshAdapter({ dataDir: dir, dshExe: process.execPath, dshEntry: fakeEntry });
      const s1 = sessionRowFor(dir, 1);
      const employee = { id: 1, name: "A", roleSnapshot: { roleKey: "dev", domains: [], locks: {}, engine: "dsh", model: "acme/acme-max" }, role: { key: "dev", source: "neo", manifest: {} } };

      // 1) no academy MCP → identical to today: empty list.
      const live1 = await adapter.open({ employee, session: s1, onEvent: () => {} });
      await live1.prompt("一轮");

      // 2) the assembler's canonical REFERENCE file for the SAME employee →
      //    values resolved AT OPEN, mapped ACP entries on the next session
      //    (the running server is reused).
      writeFileSync(
        path.join(s1.agentDir, "academy-mcp.json"),
        JSON.stringify({
          version: 2,
          roleKey: "dev",
          envRefs: { github: { GITHUB_TOKEN: "A04_DSH_TOKEN" }, remote: { Authorization: "A04_DSH_HDR" } },
          servers: {
            github: { transport: "stdio", command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "env:A04_DSH_TOKEN" } },
            remote: { transport: "http", url: "https://x/mcp", headers: { Authorization: "env:A04_DSH_HDR" } },
          },
        }),
        "utf8",
      );
      process.env.A04_DSH_TOKEN = "tok";
      process.env.A04_DSH_HDR = "hdr";
      const live2 = await adapter.open({ employee, session: s1, onEvent: () => {} });
      await live2.prompt("二轮");
      adapter.shutdown();

      const rows = readFileSync(dump, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(rows[0].params.mcpServers, []);
      assert.deepEqual(rows[1].params.mcpServers, [
        { name: "github", command: "npx", args: ["-y", "srv"], env: [{ name: "GITHUB_TOKEN", value: "tok" }] },
        { type: "http", name: "remote", url: "https://x/mcp", headers: [{ name: "Authorization", value: "hdr" }] },
      ]);
    } finally {
      delete process.env.FAKE_DUMP;
      delete process.env.FAKE_MODEL_VALUE;
      delete process.env.A04_DSH_TOKEN;
      delete process.env.A04_DSH_HDR;
    }
  } finally {
    dispose();
  }
});

test("ensureDshProfile writes a per-employee home (the shared home is retired)", () => {
  const { dir, dispose } = withDir("profile");
  try {
    const library = seedLibrary(dir);
    const p1 = ensureDshProfile(dir, library, 1);
    const p2 = ensureDshProfile(dir, library, 2);
    assert.ok(p1 && p2);
    assert.notEqual(p1.home, p2.home);
    assert.equal(p1.home, path.join(enginePaths(dir, "dsh", 1).agentDir));
    assert.ok(readFileSync(path.join(p1.profile, "cordis.patch.yml"), "utf8").includes("provider: \"acme\""));
  } finally {
    dispose();
  }
});
