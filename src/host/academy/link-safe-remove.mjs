/**
 * 票 a04 — junction-safe tree removal.
 *
 * Why this exists (本机实录, vendored neo@894e5bf under ELECTRON_RUN_AS_NODE):
 * a junction CREATED INSIDE ELECTRON carries `\??\Global\` reparse data; node's
 * lstat/readlink report it as a plain directory, and fs.rmdir/rm FOLLOW it —
 * deleting the TARGET's content, not the link. Neo's own materialize swap-out
 * walks the old --out tree with node doors, so a second materialize into the
 * same out would eat the skill content the staged links point at (library /
 * role dirs). Cubicle therefore removes previous products ITSELF through the
 * safe doors below, and hands materialize a clean dir.
 *
 * Rules (depth-first):
 *  - node-visible links (dirent symlink): unlink; EPERM (junction) → rmdir.
 *  - every other Windows link candidate (junction, dangling, node-INVISIBLE
 *    reparse point): run the link-deletion DOORS in order (see linkDoors) —
 *    each one removes a reparse point AS A LINK at worst, never recursively
 *    into the target; then last-resort rename-aside quarantine (reparse
 *    renames are platform-guaranteed and never touch the target).
 *    A path that survives every door AND readdir()s as a plain directory is
 *    a REAL non-empty directory: refuse, never eat (a04).
 *    (Runner + dev-box evidence 2026-11-18: no single door is correct on
 *    both images — cmd refused DANGLING junctions on the GH runner, .NET
 *    resolved THROUGH live junctions there, Remove-Item NullReferences on
 *    live junctions on Win 26300; every failure observed so far is safe —
 *    it deletes nothing.)
 *  - real directories: recurse, then rmdir (empty by then).
 */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Remove one reparse-point link WITHOUT following it, on Windows: .NET's
 * Directory.Delete deletes junctions/symlinks as links and throws for real
 * non-empty directories (safe-by-construction). PowerShell 5.1 ships with
 * every Windows install; the path is passed as a literal single-quoted
 * argument (only `'` needs doubling; callers pass fs temp/product paths).
 *
 * @param {string} p
 */
async function removeReparseLinkWindows(p) {
  const errors = [];
  for (const door of linkDoors(p)) {
    try {
      await door();
      return;
    } catch (/** @type {unknown} */ err) {
      errors.push(err);
      if (!(await exists(p))) return;
    }
  }
  const info = await fs.lstat(p).catch(() => null);
  const definitelyRealDir =
    info !== null && info.isDirectory() && !info.isSymbolicLink() && (await fs.readdir(p).then(() => true, () => false));
  if (!definitelyRealDir) {
    try {
      const quarantine = path.join(path.dirname(p), `.link-quarantined-${crypto.randomBytes(4).toString("hex")}`);
      await fs.rename(p, quarantine);
      for (const door of linkDoors(quarantine)) {
        try {
          await door();
        } catch {
          // leftover quarantined LINKS are inert; the caller's path is gone
        }
      }
      return;
    } catch (/** @type {unknown} */ err) {
      errors.push(err);
    }
  }
  if (!(await exists(p))) return;
  throw errors.length > 0 ? errors[errors.length - 1] : new Error(`link removal refused for ${p}`);
}

/**
 * Link-only deletion doors bound to one path. Each is non-recursive by
 * construction (rmdir without /s, Directory.Delete without recursion,
 * Remove-Item without -Recurse). No single door is correct on every Windows
 * image: cmd refused DANGLING junctions on the GH runner, .NET resolved
 * THROUGH live junctions there, and Remove-Item NullReferenceExceptions on
 * live junctions on Win 26300 — so we try them all, then rename-aside.
 * @param {string} p
 */
function linkDoors(p) {
  const escaped = p.replace(/'/g, "''");
  return [
    /** @returns {Promise<unknown>} */
    () => execFileAsync("cmd.exe", ["/c", "rmdir", p], { windowsHide: true }),
    /** @returns {Promise<unknown>} */
    () =>
      execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `[System.IO.Directory]::Delete('${escaped}')`],
        { windowsHide: true },
      ),
    /** @returns {Promise<unknown>} */
    () =>
      execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `Remove-Item -LiteralPath '${escaped}' -Force -ErrorAction Stop`],
        { windowsHide: true },
      ),
  ];
}

/** @param {string} p */
async function exists(p) {
  return (await fs.lstat(p).catch(() => null)) !== null;
}

/**
 * @param {string} p a link node (junction/symlink), possibly invisible to node
 */
export async function removeLinkOnly(p) {
  try {
    await fs.unlink(p);
    return;
  } catch {
    // EPERM on junctions: node-visible ones delete via plain rmdir.
  }
  const info = await fs.lstat(p).catch(() => null);
  if (info !== null && info.isSymbolicLink()) {
    await fs.rmdir(p);
    return;
  }
  // Invisible (or dangling) junction: the .NET door — never fs.rmdir here.
  if (process.platform === "win32") {
    await removeReparseLinkWindows(p);
    return;
  }
  try {
    await fs.unlink(p);
  } catch {
    await fs.rmdir(p);
  }
}

/**
 * Remove a directory tree WITHOUT ever following a link into its target.
 * The root itself, if it is a link, is also removed link-only.
 *
 * @param {string} root
 */
export async function removeTreeJunctionSafe(root) {
  const info = await fs.lstat(root).catch(() => null);
  if (info === null) return;
  if (info.isSymbolicLink()) {
    await removeLinkOnly(root);
    return;
  }
  if (info.isDirectory()) {
    const real = await fs.realpath(root).catch(() => null);
    if (real === null || path.resolve(real) !== path.resolve(root)) {
      // root itself is an invisible link: remove the link, never the target.
      if (process.platform === "win32") {
        await removeReparseLinkWindows(root);
        return;
      }
      await removeLinkOnly(root);
      return;
    }
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      const p = path.join(root, entry.name);
      if (entry.isSymbolicLink()) {
        await removeLinkOnly(p);
        continue;
      }
      if (entry.isDirectory()) {
        await removeTreeJunctionSafe(p);
        continue;
      }
      await fs.rm(p, { force: true });
    }
    await fs.rmdir(root);
    return;
  }
  await fs.rm(root, { force: true });
}
