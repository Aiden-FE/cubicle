/**
 * 票 a02: the pi adapter's skill/MCP wiring at the SDK seam —
 * `noSkills: true` + `additionalSkillPaths = [that employee's skills dir]`
 * (otherwise the SDK also reads ~/.agents/skills — 串味), and the built-in MCP
 * extension only when the employee's canonical academy-mcp.json resolves to
 * servers — env:VAR references are resolved AT OPEN (票 a04 launch injection).
 *
 * The pi module itself is faked: this test asserts the OPTIONS the adapter
 * hands the SDK, not pi's internals.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPiAdapter } from "../src/host/engine/pi/adapter.mjs";
import { readModelLibrary, saveModel, saveProvider, writePiModels } from "../src/host/models/library.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

/** @param {string} name */
function withDir(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `cubicle-piadapter-${name}-`));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** @param {string} dataDir */
function seedModels(dataDir) {
  saveProvider(dataDir, {
    displayName: "Acme",
    key: "acme",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    protocol: "openai-completions",
  });
  saveModel(dataDir, "acme", { id: "acme-max", displayName: "Acme Max", contextWindow: 100000, maxTokens: 8000, input: ["text"], reasoning: false });
  const library = readModelLibrary(dataDir);
  writePiModels(dataDir, library);
  return library;
}

/**
 * A fake pi module recording what the adapter configures.
 * @returns {{ module: any, captured: { loaderOptions?: any, sessionOptions?: any, factories: any[] } }}
 */
function fakePiModule() {
  const captured = {
    factories: /** @type {any[]} */ ([]),
    loaderOptions: /** @type {any} */ (null),
    sessionOptions: /** @type {any} */ (null),
  };
  const model = { provider: "acme", id: "acme-max" };
  const module = {
    ModelRuntime: {
      async create() {
        return {
          getAllModels: () => [{ provider: "acme", id: "acme-max" }],
          getModel: (/** @type {string} */ p, /** @type {string} */ id) => ({ ...model, provider: p, id }),
        };
      },
    },
    SessionManager: {
      open: () => ({}),
      continueRecent: () => ({}),
      // adapter may call this on the returned object
    },
    DefaultResourceLoader: class {
      /** @param {any} options */
      constructor(options) {
        captured.loaderOptions = options;
      }
      async reload() {}
    },
    createAgentSession: async (/** @type {any} */ options) => {
      captured.sessionOptions = options;
      return {
        session: {
          subscribe: () => {},
          async prompt() {},
          async abort() {},
          sessionFile: null,
        },
      };
    },
    // the adapter adds this factory only when MCP is assembled for the employee
    createMcpExtension: () => {
      const factory = () => {};
      factory.__mcp = true;
      return factory;
    },
  };
  return { module, captured };
}

/** @param {any} loaderOptions @returns {number} how many MCP extension factories the adapter wired in */
function mcpFactories(loaderOptions) {
  return (loaderOptions.extensionFactories ?? []).filter((/** @type {any} */ f) => f && f.__mcp === true).length;
}

/** @param {string} dataDir @param {number} employeeId */
function sessionRow(dataDir, employeeId) {
  const dirs = enginePaths(dataDir, "pi", employeeId);
  mkdirSync(dirs.agentDir, { recursive: true });
  mkdirSync(dirs.sessionsDir, { recursive: true });
  mkdirSync(dirs.workspaceDir, { recursive: true });
  return {
    id: 1,
    employeeId,
    engine: "pi",
    agentDir: dirs.agentDir,
    sessionsDir: dirs.sessionsDir,
    workspaceDir: dirs.workspaceDir,
    sessionFile: null,
    updatedAt: "2026-11-17T00:00:00.000Z",
  };
}

test("pi adapter isolates skills: noSkills + only this employee's skills dir", async () => {
  const { dir, dispose } = withDir("skills");
  try {
    seedModels(dir);
    const { module, captured } = fakePiModule();
    const adapter = createPiAdapter({ dataDir: dir, moduleImporter: async () => module });
    const employee = {
      id: 1,
      name: "小 Pi",
      roleName: "dev",
      roleSnapshot: { roleKey: "dev", domains: [], locks: {}, engine: "pi", model: "acme/acme-max" },
      role: { key: "dev", name: "dev", source: "neo", manifest: { persona: "写代码" } },
    };
    const session = sessionRow(dir, 1);
    await adapter.open({ employee, session, onEvent: () => {} });

    assert.equal(captured.loaderOptions.noSkills, true, "SDK defaults (incl. ~/.agents/skills) must be off");
    assert.deepEqual(captured.loaderOptions.additionalSkillPaths, [path.join(session.agentDir, "skills")]);
  } finally {
    dispose();
  }
});

test("pi adapter open(): 票 a04 launch injection — env:VAR refs resolve at open, stale renders cleared, missing secret fails fast", async () => {
  const { dir, dispose } = withDir("mcp");
  try {
    seedModels(dir);
    const { module, captured } = fakePiModule();
    const adapter = createPiAdapter({ dataDir: dir, moduleImporter: async () => module });
    const employee = {
      id: 1,
      name: "小 Pi",
      roleName: "dev",
      roleSnapshot: { roleKey: "dev", domains: [], locks: {}, engine: "pi", model: "acme/acme-max" },
      role: { key: "dev", name: "dev", source: "neo", manifest: {} },
    };
    const session = sessionRow(dir, 1);
    const agentDir = session.agentDir;
    const mcpFile = path.join(agentDir, "mcp.json");
    const academyFile = path.join(agentDir, "academy-mcp.json");
    const open = () => adapter.open({ employee, session, onEvent: () => {} });

    // 1) No academy MCP at all → today's behavior: no MCP extension.
    await open();
    assert.equal(mcpFactories(captured.loaderOptions), 0, "no MCP today means no MCP extension today");

    // 2) A stale pi render from an older run + an EMPTY academy doc → the
    //    adapter removes the stale mcp.json at open and opens without MCP.
    writeFileSync(mcpFile, JSON.stringify({ mcpServers: { ghost: { command: "npx" } } }), "utf8");
    writeFileSync(academyFile, JSON.stringify({ version: 2, roleKey: "dev", envRefs: {}, servers: {} }), "utf8");
    await open();
    assert.equal(existsSync(mcpFile), false, "stale mcp.json removed at open when no academy servers");
    assert.equal(mcpFactories(captured.loaderOptions), 0);

    // 3) Canonical REFERENCE shape (the assembler's job since a04): the secret
    //    VALUE never sits on disk; open() resolves it against the host env
    //    (Cubicle-side launch injection) and only then renders + activates.
    writeFileSync(
      academyFile,
      JSON.stringify({
        version: 2,
        roleKey: "dev",
        envRefs: { github: { GITHUB_TOKEN: "A04_PI_TOKEN" } },
        servers: {
          github: { transport: "stdio", command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "env:A04_PI_TOKEN" } },
        },
      }),
      "utf8",
    );
    process.env.A04_PI_TOKEN = "tok-9";
    try {
      await open();
      assert.equal(mcpFactories(captured.loaderOptions), 1, "extension on once servers resolve");
      const doc = JSON.parse(readFileSync(mcpFile, "utf8"));
      assert.deepEqual(doc.mcpServers.github, { command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "tok-9" } });

      // 4) Missing secret → readable failure at open; pi is never launched
      //    half-configured, and no engine-native render is left behind.
      delete process.env.A04_PI_TOKEN;
      rmSync(mcpFile, { force: true });
      await assert.rejects(open, (/** @type {{ code?: string }} */ err) => err.code === "academy_mcp_env_missing");
      assert.equal(existsSync(mcpFile), false);
    } finally {
      delete process.env.A04_PI_TOKEN;
    }
  } finally {
    dispose();
  }
});
