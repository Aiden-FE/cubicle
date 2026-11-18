/**
 * 票 a04 — link-safe tree removal: deleting a product directory must NEVER
 * follow a junction/symlink into its target (on this machine electron-created
 * junctions even report to node as plain directories; fs.rmdir would eat the
 * academy content through them).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { removeTreeJunctionSafe } from "../src/host/academy/link-safe-remove.mjs";

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

test("removeTreeJunctionSafe on a missing path is a quiet no-op", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cubicle-lsr-"));
  try {
    await removeTreeJunctionSafe(path.join(root, "nope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
