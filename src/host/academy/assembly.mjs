/**
 * 票 a02 — resource assembly: the role's skills + MCP land in ONE employee's
 * own engine root, so roles never see each other.
 *
 * The assembled set is NOT recomputed here: `neo materialize --json` (the
 * vendored CLI, vendor/README.md) computes it through Neo's single render
 * path, and this module mirrors the result into the employee's engine root as
 * LINKS (Windows junction / POSIX symlink — same strategy as neo's link
 * port):
 *
 *   <dataDir>/engines/<engine>/employee-<id>/agent/
 *     neo-materialized/        the `neo materialize --out` product (machine-local;
 *                              exported with --no-auth --agent-models: no
 *                              credentials, no neo model config — never in git)
 *     skills/<name>            junction/symlink → the role skill content
 *     academy-mcp.json         canonical MCP in env:VAR REFERENCE shape (票 a04)
 *     mcp.json / config.toml   adapters resolve the refs at open into the
 *                              employee's engine config — machine-local files
 *                              that DO carry resolved values (0600 on POSIX)
 *
 * Timing: assembly runs per dispatch, right before an engine session opens
 * (run-manager calls `assemble`), so every run reflects the academy's current
 * state; the returned fingerprint retires a live engine session when the
 * assembled set changed (skill content hash included).
 *
 * Employees whose role is not a Neo projection (presets, probe rows) assemble
 * to null — their behavior stays exactly as before this ticket.
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { appError } from "../../shared/apperror.mjs";
import { enginePaths } from "../engine/paths.mjs";
import { removeLinkOnly, removeTreeJunctionSafe } from "./link-safe-remove.mjs";
import { runMaterialize } from "./neo-cli.mjs";
import { readRoleMcpServers } from "./neo-mcp.mjs";
import { resolveNeoHome } from "./neo-roles.mjs";

/**
 * @typedef {object} AssemblyOutcome
 * @property {string} fingerprint            changes when the assembled set changes (drives live-session retire)
 * @property {string} roleKey
 * @property {{ name: string, hash: string, source: string }[]} skills
 * @property {{ name: string, transport: string }[]} mcp         rendered servers (names only here)
 *
 * @typedef {import("./neo-cli.mjs").MaterializeManifest} MaterializeManifest
 */

/**
 * Directory link, neo link-port semantics: junction on Windows (absolute
 * target, no privileges), symlink on POSIX. lstat sees a link; unlink removes
 * only the reparse point, never the target's content.
 *
 * @param {string} target @param {string} linkPath
 */
async function linkDir(target, linkPath) {
  await fs.symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

/**
 * Remove a link itself (junction/symlink). Never recurses, never touches the
 * target. Mirrors neo nodeLinkPort.unlink (older Windows junctions need rmdir).
 *
 * a04 hardening: on this machine a junction CREATED INSIDE ELECTRON carries
 * `\??\Global\` reparse data and node's lstat/readlink report it as a plain
 * directory (EINVAL on readlink). fs.rmdir on such a link FOLLOWS it and would
 * delete the TARGET — never use it here. `cmd /c rmdir` (no /s) removes only
 * the junction itself, which is the safe last door for links node can't see.
 *
 * @param {string} linkPath
 */
async function unlinkOnly(linkPath) {
  try {
    await fs.unlink(linkPath);
    return;
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR")) {
      const stat = await fs.lstat(linkPath).catch(() => null);
      if (stat?.isSymbolicLink() === true) {
        // node-visible junction: rmdir removes only the reparse link.
        await fs.rmdir(linkPath);
        return;
      }
      const real = await fs.realpath(linkPath).catch(() => null);
      if (real !== null && path.resolve(real) !== path.resolve(linkPath)) {
        // electron-created junction invisible to node: the shared link-safe
        // door (cmd rmdir — plain fs.rmdir would FOLLOW it into the target).
        await removeLinkOnly(linkPath);
        return;
      }
    }
    throw err;
  }
}

/**
 * Resolve a link's first hop. readlink is the primary door; on Windows it is
 * complemented by realpath, which also sees through junctions node's lstat
 * cannot identify (electron-created `\??\Global\` reparse data, see unlinkOnly).
 *
 * @param {string} p
 * @returns {Promise<string | null>} resolved target, null when p is not a link
 */
async function resolveFirstHop(p) {
  try {
    const raw = await fs.readlink(p);
    return path.resolve(path.dirname(p), raw);
  } catch {
    // not readable as a link — try the realpath door
  }
  if (process.platform === "win32") {
    const real = await fs.realpath(p).catch(() => null);
    if (real !== null && path.resolve(real) !== path.resolve(p)) return path.resolve(real);
  }
  return null;
}

/**
 * @param {object} options
 * @param {string} options.dataDir app data root (engine roots hang under it)
 * @param {string} options.nodeBinary executable for the vendored CLI child (see neo-cli.mjs)
 * @param {string} options.cliEntry path of vendor/neo/bin/neo.js
 * @param {Record<string, string | undefined>} [options.env] full child env (NEO_HOME override + env:VAR secrets); the app passes process.env, tests pass a fixture env
 */
export function createAcademyAssembler({ dataDir, nodeBinary, cliEntry, env = process.env }) {
  /**
   * @param {{ employee: any, engine: string }} input
   * @returns {Promise<AssemblyOutcome | null>} null when the employee's role is not a Neo projection
   */
  async function assemble({ employee, engine }) {
    const roleRow = employee?.role;
    if (!roleRow || roleRow.source !== "neo") return null;
    const roleKey = String(employee?.roleSnapshot?.roleKey ?? "");
    if (roleKey.length === 0) {
      throw appError("academy_assembly_no_role", `员工 ${employee?.id ?? "?"} 的角色快照没有 roleKey，无法装配`);
    }

    const neoHome = resolveNeoHome({ env });
    const { agentDir } = enginePaths(dataDir, engine, Number(employee.id));
    await fs.mkdir(agentDir, { recursive: true });
    const outDir = path.join(agentDir, "neo-materialized");

    // 1) ask Neo (the single rule owner) for the role×agent resource root.
    //    a04 defect workaround (see link-safe-remove.mjs): materialize's own
    //    swap-out of a previous --out follows electron-created junctions that
    //    node cannot see and deletes their TARGETS (the academy content).
    //    Cubicle therefore clears the old product junction-safely first, so
    //    materialize always lands on a clean directory.
    await removeTreeJunctionSafe(outDir);
    const manifest = await runMaterialize({
      nodeBinary,
      cliEntry,
      role: roleKey,
      agent: engine,
      out: outDir,
      ...(env !== undefined ? { env: { ...env } } : {}),
    });

    // 2) mirror the skill set into this employee's skills dir as links.
    const skillsRoot = path.join(agentDir, "skills");
    await fs.mkdir(skillsRoot, { recursive: true });
    for (const skill of manifest.skills) {
      const slot = path.join(skillsRoot, skill.name);
      const staged = path.join(outDir, "skills", skill.name);
      // The staged entry is neo's own link into the winner's content dir;
      // resolve its first hop so the employee links straight to real content
      // (readlink primary, realpath fallback — see resolveFirstHop).
      const target = (await resolveFirstHop(staged)) ?? staged;
      const info = await fs.lstat(slot).catch(() => null);
      if (info === null) {
        await linkDir(target, slot);
        continue;
      }
      if (info.isSymbolicLink()) {
        const current = path.resolve(path.dirname(slot), await fs.readlink(slot));
        if (current !== target) {
          await unlinkOnly(slot);
          await linkDir(target, slot);
        }
        continue;
      }
      // lstat says "real directory". That is either the user's data (refuse)
      // or OUR OWN electron-created junction that this machine's node cannot
      // identify through stat/readlink (a04 field finding). realpath tells
      // them apart: it still sees through the junction to the content dir.
      const current = await resolveFirstHop(slot);
      if (current === null) {
        // A real directory where a link belongs: never silently destroy it.
        throw appError(
          "academy_slot_not_link",
          `${slot} 是一个真实目录而不是链接；为避免吞掉数据，装配中止（请手工移除后重试）`,
        );
      }
      if (current !== target) {
        await unlinkOnly(slot);
        await linkDir(target, slot);
      }
    }
    // Skills the role dropped: unlink the employee slot (dangling/copy-free —
    // no stale content survives a role-side deletion).
    const desired = new Set(manifest.skills.map((skill) => skill.name));
    for (const entry of await fs.readdir(skillsRoot, { withFileTypes: true })) {
      if (desired.has(entry.name)) continue;
      const slot = path.join(skillsRoot, entry.name);
      const info = await fs.lstat(slot);
      if (info.isSymbolicLink() || (await resolveFirstHop(slot)) !== null) await unlinkOnly(slot);
      // non-link leftovers are Cubicle's or the user's: left in place, never used.
    }

    // 3) MCP wiring (票 a04 contract, vendored pin 894e5bf):
    //    the manifest lists `mcp.envRefs` (server → key → variable NAME, no
    //    values), and the export no longer requires those variables to exist
    //    (the old T2 hard-fail is gone at this pin). Cubicle keeps only
    //    REFERENCES on disk (academy-mcp.json holds `env:VAR` shapes; assembly
    //    writes no values), and the engine adapters resolve them at engine open
    //    — pi mirrors values into <agentDir>/mcp.json, codex into config.toml
    //    (both machine-local, 0600 on POSIX), dsh keeps them in memory
    //    (session/new). Missing values fail there, readably, before the model
    //    is asked anything. The literal-secret gate stays on
    //    the mcp.yaml reader (readRoleMcpServers). Emergency opt-out that
    //    behaves exactly like "no academy MCP": CUBICLE_ACADEMY_MCP=0.
    const mcpEnabled = env.CUBICLE_ACADEMY_MCP !== "0";
    const rawServers = mcpEnabled ? await readRoleMcpServers(neoHome, roleKey) : {};
    if (mcpEnabled) crossCheckEnvRefs(roleKey, rawServers, manifest.mcp.envRefs ?? {});
    const canonPath = path.join(agentDir, "academy-mcp.json");
    const piMcpPath = path.join(agentDir, "mcp.json");
    const serverNames = Object.keys(rawServers).sort();
    if (serverNames.length > 0) {
      await fs.writeFile(
        canonPath,
        `${JSON.stringify(
          { version: 2, roleKey, manifestHash: manifest.hash, envRefs: manifest.mcp.envRefs ?? {}, servers: rawServers },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } else {
      await fs.rm(canonPath, { force: true });
      // stale pi render from an older assembly (engine adapters also clear it
      // at open; clearing here keeps the file layer honest between runs)
      await fs.rm(piMcpPath, { force: true });
    }

    // Fingerprint: everything a live engine session would need to re-open for.
    // The manifest hash covers skill content; MCP rides as name/transport +
    // command shape (secret VALUES never enter the fingerprint).
    const mcpShape = JSON.stringify(
      Object.entries(rawServers)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, server]) =>
          server.transport === "stdio"
            ? { name, transport: "stdio", command: server.command, args: server.args, env: server.env ?? {} }
            : { name, transport: "http", url: server.url, headers: server.headers ?? {} },
        ),
    );
    return {
      fingerprint: `${roleKey}|${engine}|${manifest.hash}|${hashOf(mcpShape)}`,
      roleKey,
      skills: manifest.skills.map((skill) => ({ name: skill.name, hash: skill.hash, source: skill.source })),
      mcp: serverNames.map((name) => ({ name, transport: rawServers[name].transport })),
    };
  }

  return { assemble };
}

/**
 * Cross-check the two views of the same truth: the mcp.yaml Cubicle reads
 * (literal secrets already rejected there) and the manifest's `mcp.envRefs`
 * computed by Neo's own merge at export time. A mismatch means the role was
 * edited between materialize and this read (or one door reads the shape
 * wrong) — refusing beats rendering a half-truth.
 *
 * @param {string} roleKey
 * @param {import("./neo-mcp.mjs").McpServers} servers   reference-shape (env values are `env:VAR`)
 * @param {Record<string, Record<string, string>>} envRefs
 */
function crossCheckEnvRefs(roleKey, servers, envRefs) {
  /** @type {Record<string, Record<string, string>>} */
  const yamlRefs = {};
  for (const [name, server] of Object.entries(servers)) {
    const map = server.transport === "stdio" ? server.env : server.headers;
    /** @type {Record<string, string>} */
    const refs = {};
    for (const [key, value] of Object.entries(map ?? {})) {
      const match = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
      if (match !== null) refs[key] = match[1];
    }
    if (Object.keys(refs).length > 0) yamlRefs[name] = refs;
  }
  const norm = (/** @type {Record<string, Record<string, string>>} */ m) =>
    JSON.stringify(
      Object.keys(m)
        .sort()
        .map((name) => [name, Object.keys(m[name]).sort().map((k) => [k, m[name][k]])]),
    );
  if (norm(yamlRefs) !== norm(envRefs)) {
    throw appError(
      "academy_mcp_refs_mismatch",
      `角色「${roleKey}」的 mcp.yaml 引用与 materialize 清单的 mcp.envRefs 不一致（装配前后角色被改过或导出形状变了）；本次派工中止，重派即可收敛`,
    );
  }
}

/** @param {string} text @returns {string} */
function hashOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
