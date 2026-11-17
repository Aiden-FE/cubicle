/**
 * Academy reader: the file contract between Neo (`~/.neo`) and Cubicle's cache.
 *
 * Neo is the fact source for roles (`~/.neo/roles/<role>/`) and their install
 * ledger (`~/.neo/state/locks/<role>.yaml`, schema v1: skills.<name>.hash is
 * the upstream computedHash). Cubicle reads — never writes — those files and
 * projects them into the local `role` table (see store.mjs). Formats follow
 * the Neo source of truth: docs/schema/neo-home.md + packages/core
 * (paths.ts / locks.ts / roles.ts / mcp.ts, @compass-aiden/neo 0.2.8).
 *
 * Nothing here may throw on a missing / empty / corrupt ~/.neo: the academy
 * shows an empty state and the app boots anyway.
 *
 * TODO(materialize): this direct read of `roles/` + `state/locks` is the
 * interim path while Neo's `materialize` (neo/.scratch/academy 01) is not
 * available. Once it ships, the assembled set + hashes come from
 * `neo materialize --json` and only NEO_HOME resolution stays here. Delete
 * this interim path in the follow-up iteration of the assembly ticket.
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * @typedef {object} NeoSkillProjection
 * @property {string} name            skill name = the directory name under skills/
 * @property {string} hash            version pin: lock hash when present, else content sha
 * @property {"lock" | "dir"} via      provenance of the hash (Neo ledger vs computed here)
 * @property {string} [sourceType]    lock entry's source type (git | local | wellknown)
 *
 * @typedef {object} NeoMcpSummary
 * @property {string} name
 * @property {string} transport       "stdio" | "http" | "unknown"
 *
 * @typedef {object} NeoRoleProjection
 * @property {string} key             Neo role name = directory name under roles/
 * @property {string} name            role.yaml display name, falls back to key
 * @property {string} tagline         role.yaml tagline, "" when absent
 * @property {string[]} domains       role.yaml domains (Neo 02 shape); [] when no file
 * @property {NeoSkillProjection[]} skills
 * @property {NeoMcpSummary[]} mcp
 * @property {string} persona         AGENTS.md body; the create-stub comment reads as ""
 */

/** Neo's role-name rule (schema §1 / core names.ts). */
const ROLE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One-shot upgrade marker for readers that follow materialize. */
export const INTERIM_DIRECT_READ = true;

/**
 * Resolve the Neo home, mirroring Neo's own rule (schema §2):
 * `NEO_HOME` env > `<homedir>/.neo`; the value expands a leading `~`;
 * blank counts as unset; the result must be absolute.
 *
 * @param {{ env?: Record<string, string | undefined>, homedir?: string }} [options]
 * @returns {string}
 */
export function resolveNeoHome(options = {}) {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const raw = env.NEO_HOME?.trim();
  const value = raw ? expandTilde(raw, homedir) : path.join(homedir, ".neo");
  if (!path.isAbsolute(value)) {
    throw new Error(`NEO_HOME must resolve to an absolute path, got: ${JSON.stringify(raw ?? value)}`);
  }
  return value;
}

/**
 * @param {string} value
 * @param {string} homedir
 * @returns {string}
 */
function expandTilde(value, homedir) {
  if (value === "~") return homedir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homedir, value.slice(2));
  }
  return value;
}

/**
 * Project every Neo role into the shape Cubicle's `role` cache stores.
 * Defensive by contract: unreadable files degrade (skip / fall back), never
 * throw, so an absent or half-written ~/.neo can not keep the office down.
 *
 * TODO(materialize): replaced by `neo materialize --json` output.
 *
 * @param {string} neoHome
 * @returns {Promise<NeoRoleProjection[]>}
 */
export async function readNeoRoleProjections(neoHome) {
  const names = await readableChildDirs(path.join(neoHome, "roles"));
  const projections = /** @type {NeoRoleProjection[]} */ ([]);
  for (const name of names) {
    if (!ROLE_NAME_PATTERN.test(name)) continue;
    projections.push(await readOneRole(neoHome, name));
  }
  // readdir order is not a contract; the projection must be deterministic.
  projections.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return projections;
}

/**
 * @param {string} neoHome
 * @param {string} role
 * @returns {Promise<NeoRoleProjection>}
 */
async function readOneRole(neoHome, role) {
  const roleDir = path.join(neoHome, "roles", role);
  const skillNames = (await readableChildDirs(path.join(roleDir, "skills"))).sort();
  const lock = await readRoleLock(neoHome, role);
  const skills = /** @type {NeoSkillProjection[]} */ ([]);
  for (const skillName of skillNames) {
    const entry = lock?.skills[skillName];
    if (entry && typeof entry.hash === "string" && entry.hash.length > 0) {
      skills.push({
        name: skillName,
        hash: entry.hash,
        via: "lock",
        ...(typeof entry.sourceType === "string" ? { sourceType: entry.sourceType } : {}),
      });
      continue;
    }
    // TODO(materialize): hashing directory content here duplicates Neo's
    // assembly math because the lock is missing; materialize removes the need.
    skills.push({ name: skillName, hash: await dirContentSha(path.join(roleDir, "skills", skillName)), via: "dir" });
  }

  const roleYaml = await readYamlObject(path.join(roleDir, "role.yaml"));
  const mcp = await readMcpSummary(path.join(roleDir, "mcp.yaml"));
  const persona = await readPersona(path.join(roleDir, "AGENTS.md"));

  return {
    key: role,
    name: typeof roleYaml?.name === "string" && roleYaml.name.trim().length > 0 ? roleYaml.name.trim() : role,
    tagline: typeof roleYaml?.tagline === "string" ? roleYaml.tagline.trim() : "",
    domains: toStringArray(roleYaml?.domains),
    skills,
    mcp,
    persona,
  };
}

/**
 * Read `state/locks/<role>.yaml` (Neo lock schema v1). Cubicle is a reader
 * and must not crash the office over a corrupt ledger: anything malformed
 * reads as "no lock" and hashes fall back to directory shas.
 *
 * @param {string} neoHome
 * @param {string} role
 * @returns {Promise<{ skills: Record<string, Record<string, unknown>> } | null>}
 */
async function readRoleLock(neoHome, role) {
  const raw = await readYamlObject(path.join(neoHome, "state", "locks", `${role}.yaml`));
  if (!raw) return null;
  if (raw.version !== 1) return null;
  const skills = raw.skills;
  if (typeof skills !== "object" || skills === null || Array.isArray(skills)) return null;
  /** @type {Record<string, Record<string, unknown>>} */
  const entries = {};
  for (const [name, value] of Object.entries(skills)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      entries[name] = /** @type {Record<string, unknown>} */ (value);
    }
  }
  return { skills: entries };
}

/**
 * The MCP summary the projection cache stores: server names + transports.
 * Commands, args and env references are engine-assembly business (ticket 02)
 * and secrets must not land in the cache, so only the summary crosses here.
 *
 * @param {string} mcpPath
 * @returns {Promise<NeoMcpSummary[]>}
 */
async function readMcpSummary(mcpPath) {
  const raw = await readYamlObject(mcpPath);
  const servers = raw?.servers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];
  const summary = /** @type {NeoMcpSummary[]} */ ([]);
  for (const [name, value] of Object.entries(servers)) {
    const transport =
      typeof value === "object" && value !== null && (value.transport === "stdio" || value.transport === "http")
        ? value.transport
        : "unknown";
    summary.push({ name, transport });
  }
  return summary;
}

/**
 * AGENTS.md is the role's persona for hiring today. The one-line comment stub
 * `neo create` leaves behind reads as "no persona", matching Neo's rule that
 * an empty prompt means the instruction file stays untouched.
 *
 * @param {string} agentsMdPath
 * @returns {Promise<string>}
 */
async function readPersona(agentsMdPath) {
  let text;
  try {
    text = await fs.readFile(agentsMdPath, "utf8");
  } catch {
    return "";
  }
  const stripped = text
    .split("\n")
    .filter((line) => !/^\s*<!--\s*neo:.*-->\s*$/.test(line))
    .join("\n")
    .trim();
  return stripped;
}

/**
 * Deterministic content hash for a skill directory: sorted rel paths
 * (POSIX separators, so the pin survives Windows) + per-file sha256.
 *
 * @param {string} dir
 * @returns {Promise<string>}
 */
async function dirContentSha(dir) {
  /** @type {{ rel: string, full: string }[]} */
  const files = [];
  await walkFiles(dir, "", files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const outer = createHash("sha256");
  for (const file of files) {
    const inner = createHash("sha256");
    try {
      inner.update(await fs.readFile(file.full));
    } catch {
      inner.update("<unreadable>");
    }
    outer.update(`${file.rel}\n${inner.digest("hex")}\n`);
  }
  return outer.digest("hex");
}

/**
 * @param {string} dir
 * @param {string} rel
 * @param {{ rel: string, full: string }[]} out
 */
async function walkFiles(dir, rel, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const entryRel = rel.length > 0 ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkFiles(full, entryRel, out);
    } else if (entry.isFile()) {
      out.push({ rel: entryRel, full });
    }
  }
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>} names of readable immediate sub-directories; [] when absent
 */
async function readableChildDirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * @param {string} file
 * @returns {Promise<Record<string, unknown> | null>} null on missing / unparseable / non-mapping
 */
async function readYamlObject(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = parseYaml(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}
