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
 *    realpath fails: dangling): the .NET door — `[IO.Directory]::Delete(path)`
 *    removes a reparse point WITHOUT following it, and REFUSES (throws) a real
 *    non-empty directory. The old `cmd /c rmdir` door is gone: on newer
 *    Windows/Server images (GH runner, Node 22.21 class) cmd reports such
 *    junctions as "The directory is not empty" and cmd /s would follow the
 *    target — exactly what this module exists to prevent.
 *  - real directories: recurse, then rmdir (empty by then).
 */
import fs from "node:fs/promises";
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
  const escaped = p.replace(/'/g, "''");
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `[System.IO.Directory]::Delete('${escaped}')`],
    { windowsHide: true },
  );
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
