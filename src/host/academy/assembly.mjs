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
 *                              carries credential copies — never in git)
 *     skills/<name>            junction/symlink → the role skill content
 *     mcp.json / academy-mcp.json   rendered per-engine MCP (ticket 02's MCP part)
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
import path from "node:path";

import { appError } from "../../shared/apperror.mjs";
import { enginePaths } from "../engine/paths.mjs";
import { runMaterialize } from "./neo-cli.mjs";
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
 * @param {string} linkPath
 */
async function unlinkOnly(linkPath) {
  try {
    await fs.unlink(linkPath);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR")) {
      const stat = await fs.lstat(linkPath).catch(() => null);
      if (stat?.isSymbolicLink() === true) {
        await fs.rmdir(linkPath);
        return;
      }
    }
    throw err;
  }
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
      // resolve its first hop so the employee links straight to real content.
      let target = staged;
      try {
        const raw = await fs.readlink(staged);
        target = path.resolve(path.dirname(staged), raw);
      } catch {
        // not a link (future neo shape) — linking the staged entry still works.
      }
      const info = await fs.lstat(slot).catch(() => null);
      if (info === null) {
        await linkDir(target, slot);
        continue;
      }
      if (!info.isSymbolicLink()) {
        // A real directory where a link belongs: never silently destroy it.
        throw appError(
          "academy_slot_not_link",
          `${slot} 是一个真实目录而不是链接；为避免吞掉数据，装配中止（请手工移除后重试）`,
        );
      }
      const current = path.resolve(path.dirname(slot), await fs.readlink(slot));
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
      if (info.isSymbolicLink()) await unlinkOnly(slot);
      // non-link leftovers are Cubicle's or the user's: left in place, never used.
    }

    return {
      fingerprint: `${roleKey}|${engine}|${manifest.hash}`,
      roleKey,
      skills: manifest.skills.map((skill) => ({ name: skill.name, hash: skill.hash, source: skill.source })),
      mcp: [],
    };
  }

  return { assemble };
}
