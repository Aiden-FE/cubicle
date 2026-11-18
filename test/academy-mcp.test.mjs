/**
 * 票 a02: the MCP half of assembly — reading a Neo role's mcp.yaml (full
 * servers, unlike a01's summary) with Cubicle's stricter secret rule, and
 * rendering each engine's native shape.
 *
 * Secret rule (lead decision): only `env:VAR` references are accepted; a
 * literal token/key in mcp.yaml is REJECTED with a readable error, so no
 * hand-written secret can slip into an engine config on disk.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readRoleMcpServers,
  resolveMcpEnv,
  readAcademyMcpDocSync,
  renderPiMcpJson,
  renderCodexMcpToml,
  toAcpMcpServers,
} from "../src/host/academy/neo-mcp.mjs";

/** @param {string} name */
async function withTempDir(name) {
  const dir = await mkdtemp(path.join(tmpdir(), `cubicle-a02mcp-${name}-`));
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}

/** @param {string} neoHome @param {string} role @param {string} yaml */
async function seedMcpYaml(neoHome, role, yaml) {
  const roleDir = path.join(neoHome, "roles", role);
  await mkdir(roleDir, { recursive: true });
  await writeFile(path.join(roleDir, "mcp.yaml"), yaml, "utf8");
}

const VALID = [
  "version: 1",
  "servers:",
  "  github:",
  "    transport: stdio",
  "    command: npx",
  "    args: ['-y', '@modelcontextprotocol/server-github']",
  "    env:",
  "      GITHUB_TOKEN: env:GITHUB_TOKEN",
  "  remote:",
  "    transport: http",
  "    url: https://mcp.example.com/mcp",
  "    headers:",
  "      Authorization: env:MCP_TOKEN",
  "",
].join("\n");

test("mcp.yaml with env:VAR refs reads clean", async () => {
  const { dir, dispose } = await withTempDir("valid");
  try {
    await seedMcpYaml(dir, "dev", VALID);
    const servers = await readRoleMcpServers(dir, "dev");
    const anyServers = /** @type {Record<string, any>} */ (servers);
    assert.deepEqual(Object.keys(servers).sort(), ["github", "remote"]);
    assert.equal(anyServers.github.command, "npx");
    assert.deepEqual(anyServers.github.args, ["-y", "@modelcontextprotocol/server-github"]);
    assert.equal(anyServers.github.env.GITHUB_TOKEN, "env:GITHUB_TOKEN");
    assert.equal(anyServers.remote.headers.Authorization, "env:MCP_TOKEN");
  } finally {
    await dispose();
  }
});

test("literal secret in env is rejected with a readable error", async () => {
  const { dir, dispose } = await withTempDir("literal-env");
  try {
    await seedMcpYaml(dir, "dev", ["servers:", "  github:", "    transport: stdio", "    command: npx", "    env:", "      GITHUB_TOKEN: ghp_liveSecret123", ""].join("\n"));
    await assert.rejects(() => readRoleMcpServers(dir, "dev"), (/** @type {{ code?: string, message?: string }} */ err) => {
      assert.equal(err.code, "academy_mcp_invalid");
      assert.match(err.message ?? "", /github/);
      assert.match(err.message ?? "", /GITHUB_TOKEN/);
      assert.match(err.message ?? "", /env:/);
      return true;
    });
  } finally {
    await dispose();
  }
});

test("literal token in http headers is rejected", async () => {
  const { dir, dispose } = await withTempDir("literal-header");
  try {
    await seedMcpYaml(dir, "dev", ["servers:", "  remote:", "    transport: http", "    url: https://mcp.example.com/mcp", "    headers:", "      Authorization: Bearer sk-live-token", ""].join("\n"));
    await assert.rejects(() => readRoleMcpServers(dir, "dev"), (/** @type {{ code?: string, message?: string }} */ err) => {
      assert.equal(err.code, "academy_mcp_invalid");
      assert.match(err.message ?? "", /remote/);
      assert.match(err.message ?? "", /Authorization/);
      return true;
    });
  } finally {
    await dispose();
  }
});

test("missing role mcp.yaml reads as no servers (same as today)", async () => {
  const { dir, dispose } = await withTempDir("absent");
  try {
    const servers = await readRoleMcpServers(dir, "nobody");
    assert.deepEqual(servers, {});
  } finally {
    await dispose();
  }
});

test("role servers merge over the default role's, same name wins role-side", async () => {
  const { dir, dispose } = await withTempDir("merge");
  try {
    await seedMcpYaml(dir, "default", ["servers:", "  shared:", "    transport: stdio", "    command: default-cmd", ""].join("\n"));
    await seedMcpYaml(dir, "dev", ["servers:", "  shared:", "    transport: stdio", "    command: role-cmd", "  own:", "    transport: stdio", "    command: own-cmd", ""].join("\n"));
    const servers = await readRoleMcpServers(dir, "dev");
    const anyServers = /** @type {Record<string, any>} */ (servers);
    assert.equal(anyServers.shared.command, "role-cmd");
    assert.equal(anyServers.own.command, "own-cmd");
  } finally {
    await dispose();
  }
});

test("env:VAR resolution reads the launch env; a missing var fails readably", () => {
  /** @type {import("../src/host/academy/neo-mcp.mjs").McpServers} */
  const servers = {
    github: { transport: "stdio", command: "npx", args: [], env: { GITHUB_TOKEN: "env:GITHUB_TOKEN" } },
  };
  const resolved = resolveMcpEnv(servers, { GITHUB_TOKEN: "tok-42" });
  assert.equal(/** @type {Record<string, any>} */ (resolved).github.env.GITHUB_TOKEN, "tok-42");
  assert.throws(() => resolveMcpEnv(servers, {}), (/** @type {{ code?: string, message?: string }} */ err) => {
    assert.equal(err.code, "academy_mcp_env_missing");
    assert.match(err.message ?? "", /GITHUB_TOKEN/);
    return true;
  });
});

test("pi render: agent-dir mcp.json shape with resolved values", () => {
  /** @type {import("../src/host/academy/neo-mcp.mjs").McpServers} */
  const servers = {
    github: { transport: "stdio", command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "env:GITHUB_TOKEN" } },
    remote: { transport: "http", url: "https://x/mcp", headers: { Authorization: "env:MCP_TOKEN" } },
  };
  const resolved = resolveMcpEnv(servers, { GITHUB_TOKEN: "tok", MCP_TOKEN: "hdr" });
  const doc = JSON.parse(renderPiMcpJson(resolved));
  assert.deepEqual(doc.mcpServers.github, { command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "tok" } });
  assert.deepEqual(doc.mcpServers.remote, { url: "https://x/mcp", headers: { Authorization: "hdr" } });
});

test("codex render: config.toml [mcp_servers.*] blocks", () => {
  /** @type {import("../src/host/academy/neo-mcp.mjs").McpServers} */
  const servers = {
    github: { transport: "stdio", command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "env:GITHUB_TOKEN" } },
  };
  const resolved = resolveMcpEnv(servers, { GITHUB_TOKEN: "tok" });
  const toml = renderCodexMcpToml(resolved);
  assert.match(toml, /\[mcp_servers\.github\]/);
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /args = \["-y", "srv"\]/);
  assert.match(toml, /env = \{ GITHUB_TOKEN = "tok" \}/);
});

test("dsh render: ACP session mcpServers entries (ordered name/value pairs)", () => {
  /** @type {import("../src/host/academy/neo-mcp.mjs").McpServers} */
  const servers = {
    github: { transport: "stdio", command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "env:GITHUB_TOKEN" } },
    remote: { transport: "http", url: "https://x/mcp", headers: { Authorization: "env:MCP_TOKEN" } },
  };
  const resolved = resolveMcpEnv(servers, { GITHUB_TOKEN: "tok", MCP_TOKEN: "hdr" });
  const acp = toAcpMcpServers(resolved);
  assert.deepEqual(acp, [
    { name: "github", command: "npx", args: ["-y", "srv"], env: [{ name: "GITHUB_TOKEN", value: "tok" }] },
    { type: "http", name: "remote", url: "https://x/mcp", headers: [{ name: "Authorization", value: "hdr" }] },
  ]);
});

// ── 票 a04: the canonical academy-mcp.json reader (reference shape) ──

test("academy-mcp.json reader: missing file → null (engine behaves as no MCP)", () => {
  assert.equal(readAcademyMcpDocSync(path.join(tmpdir(), "cubicle-definitely-absent", "academy-mcp.json")), null);
});

test("academy-mcp.json reader: empty servers → null even when the file exists", async () => {
  const { dir, dispose } = await withTempDir("doc-empty");
  try {
    const file = path.join(dir, "academy-mcp.json");
    await writeFile(file, JSON.stringify({ version: 2, roleKey: "dev", envRefs: {}, servers: {} }), "utf8");
    assert.equal(readAcademyMcpDocSync(file), null);
  } finally {
    await dispose();
  }
});

test("academy-mcp.json reader: malformed JSON → readable academy_mcp_invalid, never a silent half-config", async () => {
  const { dir, dispose } = await withTempDir("doc-bad");
  try {
    const file = path.join(dir, "academy-mcp.json");
    await writeFile(file, "{version: 2, oops", "utf8");
    assert.throws(
      () => readAcademyMcpDocSync(file),
      (/** @type {{ code?: string }} */ err) => err.code === "academy_mcp_invalid",
    );
  } finally {
    await dispose();
  }
});

test("academy-mcp.json reader: v2 reference shape passes through untouched (values stay in the host env)", async () => {
  const { dir, dispose } = await withTempDir("doc-refs");
  try {
    const file = path.join(dir, "academy-mcp.json");
    const doc = {
      version: 2,
      roleKey: "dev",
      envRefs: { github: { GITHUB_TOKEN: "GITHUB_TOKEN" } },
      servers: { github: { transport: "stdio", command: "npx", args: [], env: { GITHUB_TOKEN: "env:GITHUB_TOKEN" } } },
    };
    await writeFile(file, JSON.stringify(doc), "utf8");
    const servers = readAcademyMcpDocSync(file);
    assert.deepEqual(servers, doc.servers);
    // …and the OPEN-side resolver is what turns the reference into a value.
    const resolved = resolveMcpEnv(servers, { GITHUB_TOKEN: "tok-7" });
    if (resolved.github.transport !== "stdio") throw new Error("expected a stdio server");
    assert.equal(resolved.github.env?.GITHUB_TOKEN, "tok-7");
  } finally {
    await dispose();
  }
});
