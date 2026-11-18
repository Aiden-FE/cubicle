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
 *  - node-visible links (dirent symlink): unlink; EPERM (junction) → rmdir
 *    (safe: node-visible junctions delete as links).
 *  - node-INVISIBLE links (stat says dir but realpath resolves elsewhere — or
 *    realpath fails: dangling): `cmd /c rmdir` — Windows deletes the reparse
 *    link only; plain fs.rmdir would follow it into the target.
 *  - real directories: recurse, then rmdir (empty by then).
 */
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * @param {string} p a link node (junction/symlink), possibly invisible to node
 */
async function removeLinkOnly(p) {
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
  // Invisible (or dangling) junction: the cmd door — never fs.rmdir here.
  const comSpec = process.env.ComSpec ?? "cmd.exe";
  await execFileAsync(comSpec, ["/c", "rmdir", p], { windowsHide: true });
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
      const comSpec = process.env.ComSpec ?? "cmd.exe";
      await execFileAsync(comSpec, ["/c", "rmdir", root], { windowsHide: true });
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
