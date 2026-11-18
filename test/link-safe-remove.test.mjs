/**
 * 票 a04 — link-safe tree removal: deleting a product directory must NEVER
 * follow a junction/symlink into its target (on this machine electron-created
 * junctions even report to node as plain directories; fs.rmdir would eat the
 * academy content through them).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { removeLinkOnly, removeTreeJunctionSafe } from "../src/host/academy/link-safe-remove.mjs";

const execFileAsync = promisify(execFile);

const linkType = process.platform === "win32" ? "junction" : "dir";

test("removeTreeJunctionSafe deletes the tree but leaves link targets intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cubicle-lsr-"));
  try {
    const target = path.join(root, "academy", "skill");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "SKILL.md"), "KEEP-ME", "utf8");

    const product = path.join(root, "out");
    await mkdir(path.join(product, "skills"), { recursive: true });
    await writeFile(path.join(product, "root.json"), "{}", "utf8");
    await symlink(target, path.join(product, "skills", "alpha"), linkType);

    await removeTreeJunctionSafe(product);

    assert.equal(await lstat(product).catch(() => null), null, "product tree gone");
    assert.equal(
      await readFile(path.join(target, "SKILL.md"), "utf8"),
      "KEEP-ME",
      "link target survived — the removal never followed the junction",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removeTreeJunctionSafe on a link root removes the link, not the target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cubicle-lsr-"));
  try {
    const target = path.join(root, "content");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "f.txt"), "keep", "utf8");
    const link = path.join(root, "link");
    await symlink(target, link, linkType);

    await removeTreeJunctionSafe(link);

    assert.equal(await lstat(link).catch(() => null), null, "the link itself is gone");
    assert.equal(await readFile(path.join(target, "f.txt"), "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removeLinkOnly refuses a REAL dir reached through an 8.3 short-path alias (GH-runner finding)", async (t) => {
  if (process.platform !== "win32") return t.skip();
  const root = await mkdtemp(path.join(tmpdir(), "cubicle-lsr-83-"));
  try {
    const deepName = "a-long-directory-name-so-the-8dot3-alias-differs";
    const realDir = path.join(root, deepName);
    await mkdir(realDir, { recursive: true });
    await writeFile(path.join(realDir, "data.txt"), "KEEP-ME", "utf8");

    const short = await shortPathViaPowerShell(realDir);
    if (short === null || short.toLowerCase() === realDir.toLowerCase()) {
      return t.skip(`no 8.3 alias available (${short ?? "probe failed"})`);
    }

    // The runner finding: realpath(short) is the LONG form — "realpath(p)===p"
    // misjudged this real directory as a link and quarantined it. The
    // authoritative reparse probe (provider LinkType) does not care about
    // path spelling: PLAIN → refuse, never move, never eat.
    await assert.rejects(
      () => removeLinkOnly(short),
      (/** @type {{ code?: string }} */ e) => e.code === "ENOTEMPTY",
      "short-alias real dir must be REFUSED (ENOTEMPTY)",
    );
    const info = await lstat(realDir).catch(() => null);
    assert.ok(info !== null && info.isDirectory(), "real dir still in place");
    assert.equal(await readFile(path.join(realDir, "data.txt"), "utf8"), "KEEP-ME");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** @param {string} longPath @returns {Promise<string | null>} */
async function shortPathViaPowerShell(longPath) {
  const escaped = longPath.replace(/'/g, "''");
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -Name Win -Namespace Native -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32", CharSet=System.Runtime.InteropServices.CharSet.Unicode, SetLastError=true)] public static extern uint GetShortPathNameW(string longPath, System.Text.StringBuilder shortPath, uint bufferLength);'; $sb = New-Object System.Text.StringBuilder 512; [void][Native.Win]::GetShortPathNameW('${escaped}', $sb, 512); $sb.ToString()`,
    ]);
    const value = stdout.trim().split(/\r?\n/).pop();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

test("removeTreeJunctionSafe on a missing path is a quiet no-op", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cubicle-lsr-"));
  try {
    await removeTreeJunctionSafe(path.join(root, "nope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
