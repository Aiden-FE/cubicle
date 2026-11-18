/**
 * 票 a02 — the MCP half of assembly.
 *
 * Reads the Neo role's FULL `mcp.yaml` (a01 only cached the name+transport
 * summary — secrets never cross into the SQLite cache) and renders it into
 * each engine's native config. Formats follow Neo's own schema (core/mcp.ts)
 * with one deliberate tightening (lead decision):
 *
 *   ONLY `env:VAR` references are accepted for secret fields (stdio `env`
 *   values, http `headers` values). A literal token/key in mcp.yaml is
 *   rejected with a readable error — Cubicle never renders a hand-written
 *   secret into an on-disk engine config.
 *
 * Values are resolved from the AgentHost environment at assembly time; the
 * resolved result lands only inside the machine-local employee agent dir
 * (same posture as the BYOK models.json files).
 */
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { appError } from "../../shared/apperror.mjs";

/**
 * @typedef {object} McpStdioServer
 * @property {"stdio"} transport
 * @property {string} command
 * @property {string[]} args
 * @property {Record<string, string>} [env]   values are `env:VAR` references (pre-resolution)
 *
 * @typedef {object} McpHttpServer
 * @property {"http"} transport
 * @property {string} url
 * @property {Record<string, string>} [headers]  values are `env:VAR` references
 *
 * @typedef {McpStdioServer | McpHttpServer} McpServer
 * @typedef {Record<string, McpServer>} McpServers
 */

const ENV_REF = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;

/** @param {string} role @param {string} where @param {string} message */
function invalid(role, where, message) {
  return appError("academy_mcp_invalid", `角色「${role}」的 mcp.yaml：${where} ${message}`);
}

/**
 * Parse one server entry, enforcing the env:VAR-only secret rule.
 * @param {string} role @param {string} name @param {unknown} raw
 * @returns {McpServer}
 */
function parseServer(role, name, raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalid(role, `servers.${name}`, "必须是映射（mapping）");
  }
  const entry = /** @type {Record<string, unknown>} */ (raw);
  const transport = entry.transport;
  if (transport !== "stdio" && transport !== "http") {
    throw invalid(role, `servers.${name}.transport`, `只支持 "stdio" 或 "http"，读到 ${JSON.stringify(transport)}`);
  }

  /** @param {unknown} value @param {string} field */
  const secretMap = (value, field) => {
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw invalid(role, `servers.${name}.${field}`, "必须是映射（mapping）");
    }
    /** @type {Record<string, string>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string" || !ENV_REF.test(item)) {
        throw invalid(
          role,
          `servers.${name}.${field}.${key}`,
          `密钥只接受 env:VAR 引用（例如 env:${key}），不接受字面值——把 token/key 写进 mcp.yaml 会被拒绝`,
        );
      }
      out[key] = item;
    }
    return out;
  };

  if (transport === "stdio") {
    const command = entry.command;
    if (typeof command !== "string" || command.length === 0) {
      throw invalid(role, `servers.${name}.command`, "stdio 需要 command");
    }
    const args = entry.args;
    if (args !== undefined && (!Array.isArray(args) || args.some((item) => typeof item !== "string"))) {
      throw invalid(role, `servers.${name}.args`, "必须是字符串数组");
    }
    const env = secretMap(entry.env, "env");
    return {
      transport,
      command,
      args: (args ?? []).slice(),
      ...(env !== undefined ? { env } : {}),
    };
  }

  const url = entry.url;
  if (typeof url !== "string" || url.length === 0) {
    throw invalid(role, `servers.${name}.url`, "http 需要 url");
  }
  const headers = secretMap(entry.headers, "headers");
  return { transport, url, ...(headers !== undefined ? { headers } : {}) };
}

/** @param {string} file @param {string} role @returns {Promise<McpServers>} */
async function readOneMcpYaml(file, role) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === "ENOENT") return {};
    throw appError("academy_mcp_invalid", `角色「${role}」的 mcp.yaml 读不出来：${err instanceof Error ? err.message : String(err)}`);
  }
  let raw;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw invalid(role, "", `不是合法 YAML（${err instanceof Error ? err.message : String(err)}）`);
  }
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(role, "", "顶层必须是映射（mapping）");
  const doc = /** @type {Record<string, unknown>} */ (raw);
  if (doc.version !== undefined && doc.version !== 1) {
    throw invalid(role, "version", `只支持版本 1，读到 ${String(doc.version)}`);
  }
  if (doc.servers === undefined) return {};
  if (typeof doc.servers !== "object" || doc.servers === null || Array.isArray(doc.servers)) {
    throw invalid(role, "servers", "必须是「名称 → server」的映射");
  }
  /** @type {McpServers} */
  const servers = {};
  for (const [name, value] of Object.entries(doc.servers)) {
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      throw invalid(role, `servers.${name}`, "保留属性名不允许作为 server 名");
    }
    servers[name] = parseServer(role, name, value);
  }
  return servers;
}

/**
 * Read the assembled MCP set for a role: the `default` role's servers merged
 * with the role's own (role wins same names) — the same merge Neo's render
 * path applies, applied to the reader Cubicle needs for its own rendering.
 *
 * @param {string} neoHome @param {string} role
 * @returns {Promise<McpServers>}
 */
export async function readRoleMcpServers(neoHome, role) {
  const base = await readOneMcpYaml(path.join(neoHome, "roles", "default", "mcp.yaml"), "default");
  if (role === "default") return base;
  const own = await readOneMcpYaml(path.join(neoHome, "roles", role, "mcp.yaml"), role);
  return { ...base, ...own };
}

/**
 * Resolve `env:VAR` references against the host environment. A referenced
 * variable that is unset/empty is a hard, readable failure — silently passing
 * an empty secret would just move the confusion into the MCP server.
 *
 * @param {McpServers} servers
 * @param {Record<string, string | undefined>} env
 * @returns {McpServers} the same shape with concrete values
 */
export function resolveMcpEnv(servers, env) {
  /** @param {string} ref @param {string} where */
  const resolve = (ref, where) => {
    const match = ENV_REF.exec(ref);
    if (match === null) return ref; // literals were rejected at read time; pass through defensively
    const name = match[1];
    const value = env[name];
    if (value === undefined || value.length === 0) {
      throw appError(
        "academy_mcp_env_missing",
        `${where} 引用 env:${name}，但 AgentHost 的环境里没有设置 ${name}（在启动 Cubicle 的环境里导出它，或改角色的 mcp.yaml）`,
      );
    }
    return value;
  };
  /** @type {McpServers} */
  const out = {};
  for (const [name, server] of Object.entries(servers)) {
    if (server.transport === "stdio") {
      /** @type {Record<string, string>} */
      const resolvedEnv = {};
      for (const [key, value] of Object.entries(server.env ?? {})) {
        resolvedEnv[key] = resolve(value, `mcp ${name}.env.${key}`);
      }
      out[name] = {
        transport: "stdio",
        command: server.command,
        args: [...server.args],
        ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
      };
      continue;
    }
    /** @type {Record<string, string>} */
    const resolvedHeaders = {};
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      resolvedHeaders[key] = resolve(value, `mcp ${name}.headers.${key}`);
    }
    out[name] = { transport: "http", url: server.url, ...(Object.keys(resolvedHeaders).length > 0 ? { headers: resolvedHeaders } : {}) };
  }
  return out;
}

/**
 * Read the academy assembler's engine-agnostic canonical MCP file
 * (`<agentDir>/academy-mcp.json`). Since 票 a04 the stored `servers` keep
 * `env:VAR` **references** (secret values never sit on disk); each adapter
 * resolves them with `resolveMcpEnv` at engine open — that's where Cubicle
 * injects the values. Missing file / empty servers → null (engine behaves
 * exactly as an employee with no MCP). Malformed JSON → a readable failure,
 * never a silently half-configured engine.
 *
 * @param {string} file
 * @returns {McpServers | null}
 */
export function readAcademyMcpDocSync(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
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
  const servers = doc?.servers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return null;
  return Object.keys(servers).length > 0 ? /** @type {McpServers} */ (servers) : null;
}

/**
 * pi native config: `<agentDir>/mcp.json` (the pi built-in MCP extension reads
 * exactly this path inside the redirected agent dir).
 *
 * @param {McpServers} resolved
 * @returns {string}
 */
export function renderPiMcpJson(resolved) {
  const mcpServers = Object.fromEntries(
    Object.entries(resolved).map(([name, server]) =>
      server.transport === "stdio"
        ? [name, { command: server.command, args: [...server.args], ...(server.env ? { env: { ...server.env } } : {}) }]
        : [name, { url: server.url, ...(server.headers ? { headers: { ...server.headers } } : {}) }],
    ),
  );
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}

const escapeToml = (/** @type {string} */ value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const tomlString = (/** @type {string} */ value) => `"${escapeToml(value)}"`;

/**
 * codex native config fragment: `[mcp_servers.<name>]` blocks appended to the
 * employee's CODEX_HOME/config.toml (the adapter owns that file; it embeds
 * this fragment). Values are already resolved.
 *
 * @param {McpServers} resolved
 * @returns {string}
 */
export function renderCodexMcpToml(resolved) {
  const lines = [];
  for (const [name, server] of Object.entries(resolved)) {
    if (server.transport === "stdio") {
      lines.push(`[mcp_servers.${name}]`, `command = ${tomlString(server.command)}`);
      if (server.args.length > 0) lines.push(`args = [${server.args.map(tomlString).join(", ")}]`);
      if (server.env && Object.keys(server.env).length > 0) {
        lines.push(`env = { ${Object.entries(server.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ")} }`);
      }
      lines.push("");
      continue;
    }
    lines.push(`[mcp_servers.${name}]`, `url = ${tomlString(server.url)}`);
    if (server.headers && Object.keys(server.headers).length > 0) {
      lines.push(`http_headers = { ${Object.entries(server.headers).map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ")} }`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * dsh native shape: ACP session `mcpServers` (ordered name/value entries per
 * the agentclientprotocol schema the DSH server validates).
 *
 * @param {McpServers} resolved
 * @returns {unknown[]}
 */
export function toAcpMcpServers(resolved) {
  return Object.entries(resolved).map(([name, server]) =>
    server.transport === "stdio"
      ? {
          name,
          command: server.command,
          args: [...server.args],
          env: Object.entries(server.env ?? {}).map(([n, value]) => ({ name: n, value })),
        }
      : {
          type: "http",
          name,
          url: server.url,
          headers: Object.entries(server.headers ?? {}).map(([n, value]) => ({ name: n, value })),
        },
  );
}
