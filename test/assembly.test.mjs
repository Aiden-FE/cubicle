/**
 * 票 a02: resource assembly — the seam where a Neo role's skills + MCP really
 * land in ONE employee's engine root, through the vendored `neo materialize`
 * CLI (the only assembly-rule owner), as links not copies.
 *
 * Fixtures live under the OS temp dir; the real ~/.neo is never touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAcademyAssembler } from "../src/host/academy/assembly.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_CLI = path.join(here, "..", "vendor", "neo", "bin", "neo.js");

/** @returns {Promise<{ dir: string, dispose: () => Promise<void> }>} */
async function withTempDir(name) {
  const dir = await mkdtemp(path.join(tmpdir(), `cubicle-a02-${name}-`));
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Seed a role in a fixture Neo home: roles/<role>/skills/<skill>/SKILL.md.
 * @param {string} neoHome @param {string} role @param {string} skill @param {string} body
 */
async function seedSkill(neoHome, role, skill, body) {
  const dir = path.join(neoHome, "roles", role, "skills", skill);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
  return dir;
}

/** A store-shaped employee hired from a Neo role projection (source: neo). */
function neoEmployee(id, name, roleKey, engine) {
  return {
    id,
    companyId: 1,
    name,
    roleId: 1,
    appearance: null,
    roleSnapshot: { roleKey, domains: [], locks: {}, engine, model: "default", cost: { tokenBudgetPerTask: 1 } },
    hiredAt: "2026-11-17T00:00:00.000Z",
    roleName: roleKey,
    role: { id: 1, key: roleKey, name: roleKey, tagline: "", manifest: {}, domains: [], skills: [], mcp: [], source: "neo", syncedAt: null },
  };
}

test("neo-role employee: role skills link into that employee's engine agent dir (link, not copy)", async () => {
  const { dir, dispose } = await withTempDir("link");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    const skillDir = await seedSkill(neoHome, "dev", "alpha", "ALPHA-SKILL");

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    const employee = neoEmployee(1, "小 Pi", "dev", "pi");
    const outcome = await assembler.assemble({ employee, engine: "pi" });

    assert.ok(outcome, "assembly produced an outcome for a neo-role employee");
    assert.deepEqual(outcome.skills.map((s) => s.name), ["alpha"]);

    const slot = path.join(enginePaths(dataDir, "pi", 1).agentDir, "skills", "alpha");
    const info = await lstat(slot);
    assert.equal(info.isSymbolicLink(), true, "the slot is a link (junction on Windows), not a copied directory");
    assert.equal(await readFile(path.join(slot, "SKILL.md"), "utf8"), "ALPHA-SKILL");
    // The link points at the role's own content — the copy-free rule.
    assert.equal(path.resolve(await readlink(slot)), path.resolve(skillDir));
  } finally {
    await dispose();
  }
});
