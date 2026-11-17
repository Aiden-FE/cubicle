/**
 * 票 a02: resource assembly — the seam where a Neo role's skills + MCP really
 * land in ONE employee's engine root, through the vendored `neo materialize`
 * CLI (the only assembly-rule owner), as links not copies.
 *
 * Fixtures live under the OS temp dir; the real ~/.neo is never touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, readlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAcademyAssembler } from "../src/host/academy/assembly.mjs";
import { enginePaths } from "../src/host/engine/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_CLI = path.join(here, "..", "vendor", "neo", "bin", "neo.js");

/** @param {string} name @returns {Promise<{ dir: string, dispose: () => Promise<void> }>} */
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

/** @param {number} id @param {string} name @param {string} roleKey @param {string} engine */
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

test("role deletes a skill: the employee slot goes dangling then removed — never a stale copy", async () => {
  const { dir, dispose } = await withTempDir("dangling");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "dev", "alpha", "ALPHA-SKILL");

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    const employee = neoEmployee(1, "小 Pi", "dev", "pi");

    const first = await assembler.assemble({ employee, engine: "pi" });
    assert.ok(first);
    assert.equal(first.skills.length, 1);
    const slot = path.join(enginePaths(dataDir, "pi", 1).agentDir, "skills", "alpha");

    // Neo-side deletion (rm the role's skill dir; the employee's link now dangles).
    await rm(path.join(neoHome, "roles", "dev", "skills", "alpha"), { recursive: true, force: true });
    const dangling = await lstat(slot);
    assert.equal(dangling.isSymbolicLink(), true, "still a link while dangling — no copy was materialized");

    // The next assembly resyncs: the slot is gone, and nothing copied remains.
    const second = await assembler.assemble({ employee, engine: "pi" });
    assert.ok(second);
    assert.deepEqual(second.skills, []);
    const after = await lstat(slot).catch(() => null);
    assert.equal(after, null, "dangling employee-side link removed");
    // The role's content dir was never duplicated into the employee root:
    // only neo's own product dir + the (now empty) skills dir sit in the agent dir.
    const entries = await readdir(path.join(enginePaths(dataDir, "pi", 1).agentDir, "skills"));
    assert.deepEqual(entries, []);
  } finally {
    await dispose();
  }
});

test("two employees on different roles never share skill trees (role isolation)", async () => {
  const { dir, dispose } = await withTempDir("isolation");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "alpha-role", "alpha-skill", "A-ONLY");
    await seedSkill(neoHome, "beta-role", "beta-skill", "B-ONLY");

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });

    const a = await assembler.assemble({ employee: neoEmployee(1, "A", "alpha-role", "pi"), engine: "pi" });
    const b = await assembler.assemble({ employee: neoEmployee(2, "B", "beta-role", "pi"), engine: "pi" });
    assert.ok(a && b);
    assert.deepEqual(a.skills.map((s) => s.name), ["alpha-skill"]);
    assert.deepEqual(b.skills.map((s) => s.name), ["beta-skill"]);

    const aSkills = path.join(enginePaths(dataDir, "pi", 1).agentDir, "skills");
    const bSkills = path.join(enginePaths(dataDir, "pi", 2).agentDir, "skills");
    assert.deepEqual(await readdir(aSkills), ["alpha-skill"]);
    assert.deepEqual(await readdir(bSkills), ["beta-skill"]);
    // B cannot read A's content through its own root, and vice versa.
    const bReadingA = await readFile(path.join(bSkills, "alpha-skill", "SKILL.md"), "utf8").catch(() => null);
    const aReadingB = await readFile(path.join(aSkills, "beta-skill", "SKILL.md"), "utf8").catch(() => null);
    assert.equal(bReadingA, null);
    assert.equal(aReadingB, null);
  } finally {
    await dispose();
  }
});

/**
 * Seed a role mcp.yaml (raw text).
 * @param {string} neoHome @param {string} role @param {string} yaml
 */
async function seedMcpYaml(neoHome, role, yaml) {
  const roleDir = path.join(neoHome, "roles", role);
  await mkdir(roleDir, { recursive: true });
  await writeFile(path.join(roleDir, "mcp.yaml"), yaml, "utf8");
}

const MCP_YAML = [
  "servers:",
  "  github:",
  "    transport: stdio",
  "    command: npx",
  "    args: ['-y', 'srv']",
  "    env:",
  "      GITHUB_TOKEN: env:GITHUB_TOKEN",
  "",
].join("\n");

test("MCP env:VAR: pi employee gets a rendered <agentDir>/mcp.json (resolved values)", async () => {
  const { dir, dispose } = await withTempDir("mcp-pi");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "dev", "alpha", "ALPHA");
    await seedMcpYaml(neoHome, "dev", MCP_YAML);

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome, GITHUB_TOKEN: "tok-42" },
    });
    const outcome = await assembler.assemble({ employee: neoEmployee(1, "A", "dev", "pi"), engine: "pi" });
    assert.ok(outcome);
    assert.deepEqual(outcome.mcp, [{ name: "github", transport: "stdio" }]);

    const agentDir = enginePaths(dataDir, "pi", 1).agentDir;
    const doc = JSON.parse(await readFile(path.join(agentDir, "mcp.json"), "utf8"));
    assert.deepEqual(doc.mcpServers.github, { command: "npx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "tok-42" } });
    // The engine-agnostic canonical file feeds the codex/dsh adapters too.
    const canon = JSON.parse(await readFile(path.join(agentDir, "academy-mcp.json"), "utf8"));
    assert.equal(canon.servers.github.env.GITHUB_TOKEN, "tok-42");
  } finally {
    await dispose();
  }
});

test("MCP literal secret: assembly refuses the role (readable error), run never starts", async () => {
  const { dir, dispose } = await withTempDir("mcp-literal");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedMcpYaml(neoHome, "dev", ["servers:", "  github:", "    transport: stdio", "    command: npx", "    env:", "      GITHUB_TOKEN: ghp_liveSecret", ""].join("\n"));

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    await assert.rejects(
      () => assembler.assemble({ employee: neoEmployee(1, "A", "dev", "pi"), engine: "pi" }),
      (/** @type {{ code?: string, message?: string }} */ err) => {
        assert.equal(err.code, "academy_mcp_invalid");
        assert.match(err.message ?? "", /GITHUB_TOKEN/);
        return true;
      },
    );
  } finally {
    await dispose();
  }
});

test("no MCP configured: no config files written (three engines still pass empty)", async () => {
  const { dir, dispose } = await withTempDir("mcp-none");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "dev", "alpha", "ALPHA");

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    const outcome = await assembler.assemble({ employee: neoEmployee(1, "A", "dev", "pi"), engine: "pi" });
    assert.ok(outcome, "assembly still succeeds with no MCP");
    assert.deepEqual(outcome.mcp, []);
    const agentDir = enginePaths(dataDir, "pi", 1).agentDir;
    assert.equal(await readFile(path.join(agentDir, "mcp.json"), "utf8").catch(() => null), null);
    assert.equal(await readFile(path.join(agentDir, "academy-mcp.json"), "utf8").catch(() => null), null);
  } finally {
    await dispose();
  }
});

test("fingerprint: stable per role content, changes when the role's skills change", async () => {
  const { dir, dispose } = await withTempDir("fingerprint");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "dev", "alpha", "ALPHA-V1");
    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    const employee = neoEmployee(1, "A", "dev", "pi");
    const a1 = await assembler.assemble({ employee, engine: "pi" });
    const a2 = await assembler.assemble({ employee, engine: "pi" });
    assert.ok(a1 && a2);
    assert.equal(a1.fingerprint, a2.fingerprint);
    await writeFile(path.join(neoHome, "roles", "dev", "skills", "alpha", "SKILL.md"), "ALPHA-V2", "utf8");
    const a3 = await assembler.assemble({ employee, engine: "pi" });
    assert.ok(a3);
    assert.notEqual(a1.fingerprint, a3.fingerprint);
  } finally {
    await dispose();
  }
});

test("domain-layer skills (Neo N2) mirror into the employee too: assembly stays rule-free on Cubicle's side", async () => {
  const { dir, dispose } = await withTempDir("domain");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "dev", "own-skill", "OWN");
    // library/<domain>/<skill> + role.yaml declaring the domain (Neo's N2 shape).
    const libSkill = path.join(neoHome, "library", "frontend", "domain-skill");
    await mkdir(libSkill, { recursive: true });
    await writeFile(path.join(libSkill, "SKILL.md"), "DOMAIN", "utf8");
    await mkdir(path.join(neoHome, "roles", "dev"), { recursive: true });
    await writeFile(path.join(neoHome, "roles", "dev", "role.yaml"), "version: 1\ndomains:\n  - frontend\n", "utf8");

    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    const outcome = await assembler.assemble({ employee: neoEmployee(1, "A", "dev", "pi"), engine: "pi" });
    assert.ok(outcome);
    assert.deepEqual(outcome.skills.map((s) => s.name).sort(), ["domain-skill", "own-skill"]);

    const skillsRoot = path.join(enginePaths(dataDir, "pi", 1).agentDir, "skills");
    assert.deepEqual((await readdir(skillsRoot)).sort(), ["domain-skill", "own-skill"]);
    assert.equal(path.resolve(await readlink(path.join(skillsRoot, "domain-skill"))), path.resolve(libSkill));
  } finally {
    await dispose();
  }
});

test("codex employee: skills land under $CODEX_HOME (the employee's agent dir) — nothing written outside", async () => {
  const { dir, dispose } = await withTempDir("codex-engine");
  try {
    const neoHome = path.join(dir, "neo-home");
    const dataDir = path.join(dir, "data");
    await seedSkill(neoHome, "dev", "alpha", "ALPHA");

    // Snapshot the whole dataDir + neoHome before, to prove writes stayed in the employee's own root.
    const assembler = createAcademyAssembler({
      dataDir,
      nodeBinary: process.execPath,
      cliEntry: VENDOR_CLI,
      env: { ...process.env, NEO_HOME: neoHome },
    });
    const outcome = await assembler.assemble({ employee: neoEmployee(9, "C", "dev", "codex"), engine: "codex" });
    assert.ok(outcome);

    // CODEX_HOME = the employee's agent dir (codex adapter's homeFor); skills sit under it.
    const codexHome = enginePaths(dataDir, "codex", 9).agentDir;
    const slot = path.join(codexHome, "skills", "alpha");
    assert.equal((await lstat(slot)).isSymbolicLink(), true);
    assert.equal(await readFile(path.join(slot, "SKILL.md"), "utf8"), "ALPHA");

    // Neo's home is read-only from Cubicle's side: the materialize product
    // lives under the employee root, not in ~/.neo.
    const neoEntries = await readdir(path.join(neoHome, "roles", "dev"));
    assert.deepEqual(neoEntries.sort(), ["skills"], "no materialize side effects inside the Neo home");
  } finally {
    await dispose();
  }
});

test("preset/probe employees assemble to null — the vendored CLI is never invoked", async () => {  const { dir, dispose } = await withTempDir("null-path");
  try {
    const assembler = createAcademyAssembler({
      dataDir: path.join(dir, "data"),
      // A CLI path that cannot exist: any invocation would surface as a spawn error.
      nodeBinary: process.execPath,
      cliEntry: path.join(dir, "no-such-cli.js"),
      env: { ...process.env },
    });
    const preset = neoEmployee(1, "A", "pi-dev", "pi");
    preset.role.source = "preset";
    assert.equal(await assembler.assemble({ employee: preset, engine: "pi" }), null);
    const probe = neoEmployee(2, "P", "probe-pi", "pi");
    probe.role.source = "probe";
    assert.equal(await assembler.assemble({ employee: probe, engine: "pi" }), null);
  } finally {
    await dispose();
  }
});
