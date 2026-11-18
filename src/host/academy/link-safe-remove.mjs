/**
 * 票 a04 — junction-safe tree removal.
 *
 * Why this exists (本机实录, vendored neo under ELECTRON_RUN_AS_NODE):
 * a junction CREATED INSIDE ELECTRON carries `\??\Global\` reparse data; node's
 * lstat/readlink report it as a plain directory, and fs.rmdir/rm FOLLOW it —
 * deleting the TARGET's content, not the link. Neo's own materialize swap-out
 * walks the old --out tree with node doors, so a second materialize into the
 * same out would eat the skill content the staged links point at (library /
 * role dirs). Cubicle therefore removes previous products ITSELF through the
 * safe doors below, and hands materialize a clean dir.
 *
 * Design (three CI rounds + dev-box evidence, 2026-11-18): NO deletion door is
 * correct on every Windows image. `cmd /c rmdir` refused DANGLING junctions on
 * the GH runner; .NET `[IO.Directory]::Delete` resolved THROUGH live junctions
 * there (ENOTEMPTY); PS 5.1 `Remove-Item -Force` prompted (NonInteractive
 * error) on the runner and NullReference-threw on Win 26300 — every failure
 * observed so far deletes nothing (safe), but no single door deletes reliably
 * either. So link removal is restructured around the ONE platform-guaranteed
 * operation:
 *
 *   1. CLASSIFY read-only: lstat symlink → link; lstat dir + realpath===self
 *      + readdir ok → REAL directory → REFUSE (throw), never touch (a04).
 *      realpath resolves elsewhere, or fails (dangling), or readdir fails →
 *      link-like.
 *   2. For link-like: RENAME-ASIDE. Renaming a reparse point never resolves
 *      its target and always moves the link itself — into
 *      os.tmpdir()/.cubicle-link-quarantine (cross-volume EXDEV falls back to
 *      a sibling). The caller's path is gone; the target is untouched.
 *   3. Then best-effort DELETE the quarantined link via the classic doors
 *      (`cmd /c rmdir` — never /s —, .NET Directory.Delete, Remove-Item
 *      -Force -Confirm:$false). Leftovers are inert reparse points in a
 *      quarantine dir and never block the product tree.
 *   If rename itself fails, the doors run against the original path as a
 *   fallback before the final exists()/refusal logic.
 *
 * Real directories: recurse, then rmdir (empty by then); quarantine siblings
 * are swept into the quarantine dir before a parent rmdir.
 */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const QUARANTINE_PREFIX = ".link-quarantined-";

/**
 * Existence that survives the phantom-junction lie: on some Windows images
 * lstat() of a DANGLING reparse point fails (ENOENT — reparse resolution at
 * open), while readdir/rmdir of the parent still see the entry and rmdir
 * refuses until it is gone. On win32 fall back to the provider probe.
 *
 * @param {string} p
 */
async function exists(p) {
  if ((await fs.lstat(p).catch(() => null)) !== null) return true;
  // Phantom reparse point: lstat lies (ENOENT) but readdir sees it and
  // rmdir refuses until it is gone. readdir visibility is spawn-free and
  // platform-uniform — cheaper than the PS probe for this yes/no question.
  const entries = await fs.readdir(path.dirname(p)).catch(() => null);
  return entries !== null && entries.includes(path.basename(p));
}

/**
 * @param {string} p
 * @returns {Promise<"missing" | "symlink" | "link-like" | "real-dir">}
 */
async function classify(p) {
  const info = await fs.lstat(p).catch(() => null);
  if (info === null) {
    // Phantom reparse point: lstat lies (ENOENT) but readdir sees the entry
    // and the parent's rmdir refuses until it is gone.
    if (await exists(p)) return "link-like";
    return "missing";
  }
  if (info.isSymbolicLink()) return "symlink";
  if (!info.isDirectory()) return "link-like";
  // Alias-safe canonical identity (also used on POSIX): a REAL directory's
  // realpath is a DIRECT CHILD of its canonical parent. Survives 8.3 short
  // aliases on every path component; no spawns. Links resolve outside the
  // parent (a same-parent junction target is misjudged real-dir — a safe
  // refuse, never a data eat).
  //
  // parent-relative canonical identity — fs.realpath returns long-form, and
  // caller paths may be 8.3 SHORT aliases (GH-runner TEMP: RUNNER~1\...).
  const real = await fs.realpath(p).catch(() => null);
  if (real === null) return "link-like"; // dangling reparse point
  const parentReal = await fs.realpath(path.dirname(p)).catch(() => null);
  if (parentReal !== null) {
    const norm = (/** @type {string} */ x) => x.replace(/\/+$/, "").toLowerCase();
    if (norm(path.dirname(real)) === norm(parentReal)) {
      const readable = await fs.readdir(p).then(
        () => true,
        () => false,
      );
      if (readable) return "real-dir";
    }
  }
  return "link-like";
}

/**
 * Non-recursive link-deletion doors (see header for why they are best-effort
 * only). NEVER add /s or -Recurse: both follow the target — the exact hazard
 * this module exists to prevent.
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
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Remove-Item -LiteralPath '${escaped}' -Force -Confirm:$false -ErrorAction Stop`,
        ],
        { windowsHide: true },
      ),
  ];
}

/**
 * @param {string} p quarantined link path
 */
async function bestEffortDeleteQuarantine(p) {
  for (const door of linkDoors(p)) {
    try {
      await door();
    } catch {
      // every door failure observed is a no-op; leftovers are inert reparse points
    }
    if (!(await exists(p))) return;
  }
}

/**
 * Move a link-identified path out of the tree: rename never resolves the
 * reparse target, so this works on EVERY Windows image regardless of which
 * deletion door disagrees. Prefers the shared quarantine dir under os.tmpdir
 * (cross-volume EXDEV falls back to a sibling next to the link).
 *
 * @param {string} p
 * @returns {Promise<string | null>} quarantine path, null on failure
 */
async function renameAside(p) {
  const name = `${QUARANTINE_PREFIX}${crypto.randomBytes(4).toString("hex")}`;
  const quarantineDir = path.join(os.tmpdir(), "cubicle-link-quarantine");
  try {
    await fs.mkdir(quarantineDir, { recursive: true });
    const dest = path.join(quarantineDir, name);
    await fs.rename(p, dest);
    return dest;
  } catch {
    try {
      const dest = path.join(path.dirname(p), name);
      await fs.rename(p, dest);
      return dest;
    } catch {
      return null;
    }
  }
}

/**
 * Remove one link-candidate (junction/dangling/invisible reparse point) on
 * Windows without ever eating its target.
 *
 * @param {string} p
 */
async function removeReparseLinkWindows(p) {
  const kind = await classify(p);
  if (kind === "missing") return;
  if (kind === "real-dir") {
    const err = /** @type {NodeJS.ErrnoException} */ (new Error(`refusing to remove real directory (never follows links): ${p}`));
    err.code = "ENOTEMPTY";
    throw err;
  }
  const quarantine = await renameAside(p);
  if (quarantine !== null) {
    // detached from the tree; cleanup is best-effort
    await bestEffortDeleteQuarantine(quarantine);
    return;
  }
  // rename failed (unusual: permissions/AV): last-resort classic doors
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
  if (!(await exists(p))) return;
  throw errors.length > 0 ? errors[errors.length - 1] : new Error(`link removal refused for ${p}`);
}

/**
 * @param {string} dir a directory whose quarantine siblings get swept away
 */
async function sweepQuarantineSiblings(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  for (const entry of entries) {
    if (!entry.startsWith(QUARANTINE_PREFIX)) continue;
    const p = path.join(dir, entry);
    const kind = await classify(p);
    if (kind === "link-like" || kind === "symlink") {
      const dest = await renameAside(p);
      if (dest !== null) {
        await bestEffortDeleteQuarantine(dest);
      }
    }
  }
}

/**
 * Remove one link node (junction/symlink), possibly invisible to node.
 * Never touches the target.
 *
 * @param {string} p
 */
export async function removeLinkOnly(p) {
  try {
    await fs.unlink(p);
    if (!(await exists(p))) return;
    // unlink "succeeded" but the entry is still visible (phantom dangling
    // reparse): fall through to the authoritative doors.
  } catch {
    // EPERM on junctions: node-visible ones delete via plain rmdir.
  }
  const info = await fs.lstat(p).catch(() => null);
  if (info !== null && info.isSymbolicLink()) {
    await fs.rmdir(p);
    if (!(await exists(p))) return;
    if (process.platform === "win32") {
      await removeReparseLinkWindows(p);
      return;
    }
    throw new Error(`link removal failed for ${p}`);
  }
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
 * The root itself, if it is a link, is removed link-only.
 *
 * @param {string} root
 */
export async function removeTreeJunctionSafe(root) {
  const kind = await classify(root);
  if (kind === "missing") return;
  if (kind !== "real-dir") {
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
  await sweepQuarantineSiblings(root);
  await fs.rmdir(root);
}
