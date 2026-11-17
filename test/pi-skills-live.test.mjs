/**
 * 票 a02 acceptance 1, at the real pi SDK seam: an employee's assembled run
 * configuration exposes ONLY that employee's skills — and what lives in the
 * machine's global ~/.agents/skills does NOT appear.
 *
 * This is the same DefaultResourceLoader + options the pi adapter passes in
 * the app (noSkills: true + additionalSkillPaths = the employee's skills
 * dir), driven against the assembled junction links from ./assembly.test.
 * The junction direction is asserted with pi's own loader (reading THROUGH
 * the link is the whole point — a copy-free layout that pi can't follow
 * would be useless).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAcademyAssembler } from "../src/host/academy/assembly.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_CLI = path.join(here, "..", "vendor", "neo", "bin", "neo.js");

const pi = await import("@earendil-works/pi-coding-agent");

/** @param {string} name */
async function withTempDir(name) {
  const dir = await mkdtemp(path.join(tmpdir(), `cubicle-a02live-`));
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}

/** @param {string} neoHome @param {string} role @param {string} skill @param {string} body */
async function seedSkill(neoHome, role, skill, body) {
  const dir = path.join(neoHome, "roles", role, "skills", skill);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
}

/** Skill names in the machine's shared ~/.agents/skills (the 串味 source). */
async function globalSkillNames() {
  const dir = path.join(homedir(), ".agents", "skills");
  if (!existsSync(dir)) return [];
  const names = /** @type {string[]} */ ([]);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(path.join(dir, entry.name, "SKILL.md"))) names.push(entry.name);
  }
  return names;
}

test("assembled employee: the real pi loader sees exactly the employee's skills, never ~/.agents/skills", async () => {
  const { dir, dispose } = await withTempDir("skills");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "alpha-role", "alpha-skill", [
      "---",
      "name: alpha-skill",
      "description: Alpha only",
      "---",
      "ALPHA",
      "",
    ].join("\n"));

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    const employee = {
      id: 1,
      name: "A",
      roleSnapshot: { roleKey: "alpha-role", domains: [], locks: {}, engine: "pi", model: "default" },
      role: { key: "alpha-role", name: "alpha-role", source: "neo", manifest: {} },
    };
    await assembler.assemble({ employee, engine: "pi" });

    const dirs = enginePaths(dataDir, "pi", 1);
    await mkdir(dirs.workspaceDir, { recursive: true });
    const globals = await globalSkillNames();

    // What the adapter actually passes on open (same shape as pi/adapter.mjs).
    const loader = new pi.DefaultResourceLoader({
      cwd: dirs.workspaceDir,
      agentDir: dirs.agentDir,
      noExtensions: true,
      noSkills: true,
      additionalSkillPaths: [path.join(dirs.agentDir, "skills")],
    });
    await loader.reload();
    const loaded = loader.getSkills().skills;
    const names = loaded.map((/** @type {any} */ s) => s.name).sort();
    assert.deepEqual(names, ["alpha-skill"], "only the employee's assembled skills load — reading THROUGH the junction");

    // The machine's global skills (this box has real ones) are absent.
    for (const name of globals) {
      assert.ok(!names.includes(name), `global skill ${name} leaked into the employee's set`);
    }
    // Loaded from under the employee root, not from the global root.
    for (const skill of loaded) {
      const base = path.resolve(String(/** @type {any} */ (skill).baseDir));
      const employeeRoot = path.resolve(dirs.agentDir);
      assert.ok(base === employeeRoot || base.startsWith(employeeRoot + path.sep), `skill loaded outside the employee root: ${base}`);
    }

    // Negative control: the machine's global set is non-empty on this box —
    // the exclusion assertion above has teeth here.
    if (globals.length > 0) {
      const naive = new pi.DefaultResourceLoader({
        cwd: dirs.workspaceDir,
        agentDir: dirs.agentDir,
        noExtensions: true,
        // noSkills NOT set, no additionalSkillPaths: the old leaky default.
      });
      await naive.reload();
      const naiveNames = naive.getSkills().skills.map((/** @type {any} */ s) => s.name);
      assert.ok(
        globals.some((name) => naiveNames.includes(name)),
        "expected at least one global skill to load by default (proves the isolation assertion bites)",
      );
    }
  } finally {
    await dispose();
  }
});
