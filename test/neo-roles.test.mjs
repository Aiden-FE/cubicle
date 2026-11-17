/**
 * 票 a01: the Academy reader seam — the file contract between Neo (`~/.neo`)
 * and Cubicle's role projection cache. Everything here runs against temp
 * Neo homes; the real `~/.neo` is never touched.
 *
 * TODO(materialize): these reads are the temporary direct-`roles/` path; once
 * Neo 01 (materialize) lands, the projection comes from `neo materialize`
 * instead and this module shrinks to the NEO_HOME resolution only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveNeoHome, readNeoRoleProjections } from "../src/host/academy/neo-roles.mjs";

/**
 * @param {string} name
 * @returns {Promise<{ dir: string, dispose: () => Promise<void> }>}
 */
async function withTempDir(name) {
  const dir = await mkdtemp(path.join(tmpdir(), `cubicle-neo-${name}-`));
  const dispose = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, dispose };
}

/**
 * Build a Neo-home fixture: neoHome/roles/<role>/skills/<skill>/SKILL.md
 * plus optional lock / role.yaml / mcp.yaml / AGENTS.md content.
 *
 * @param {string} neoHome
 * @param {string} role
 * @param {{ skills?: Record<string, string>, lock?: string, roleYaml?: string, mcpYaml?: string, agentsMd?: string }} [fixture]
 */
async function seedRole(neoHome, role, fixture = {}) {
  const roleDir = path.join(neoHome, "roles", role);
  await mkdir(roleDir, { recursive: true });
  for (const [skill, body] of Object.entries(fixture.skills ?? {})) {
    await mkdir(path.join(roleDir, "skills", skill), { recursive: true });
    await writeFile(path.join(roleDir, "skills", skill, "SKILL.md"), body, "utf8");
  }
  if (fixture.lock !== undefined) {
    await mkdir(path.join(neoHome, "state", "locks"), { recursive: true });
    await writeFile(path.join(neoHome, "state", "locks", `${role}.yaml`), fixture.lock, "utf8");
  }
  if (fixture.roleYaml !== undefined) {
    await mkdir(roleDir, { recursive: true });
    await writeFile(path.join(roleDir, "role.yaml"), fixture.roleYaml, "utf8");
  }
  if (fixture.mcpYaml !== undefined) {
    await mkdir(roleDir, { recursive: true });
    await writeFile(path.join(roleDir, "mcp.yaml"), fixture.mcpYaml, "utf8");
  }
  if (fixture.agentsMd !== undefined) {
    await mkdir(roleDir, { recursive: true });
    await writeFile(path.join(roleDir, "AGENTS.md"), fixture.agentsMd, "utf8");
  }
}

test("NEO_HOME env overrides the default ~/.neo; tilde expands; empty falls back", () => {
  assert.equal(
    resolveNeoHome({ env: { NEO_HOME: "D:\\custom\\.neo" }, homedir: "C:\\Users\\Aiden" }),
    "D:\\custom\\.neo",
  );
  assert.equal(
    resolveNeoHome({ env: { NEO_HOME: "~/.neo-alt" }, homedir: "/home/aiden" }),
    path.join("/home/aiden", ".neo-alt"),
  );
  assert.equal(
    resolveNeoHome({ env: {}, homedir: "/home/aiden" }),
    path.join("/home/aiden", ".neo"),
  );
  // Blank is "unset" — the same rule Neo itself applies.
  assert.equal(
    resolveNeoHome({ env: { NEO_HOME: "   " }, homedir: "/home/aiden" }),
    path.join("/home/aiden", ".neo"),
  );
  // A relative NEO_HOME is a config error, not a silent footgun.
  assert.throws(() => resolveNeoHome({ env: { NEO_HOME: "relative/path" }, homedir: "/home/aiden" }));
});

test("absent or empty ~/.neo projects as an empty list — never throws", async () => {
  const { dir, dispose } = await withTempDir("empty");
  try {
    assert.deepEqual(await readNeoRoleProjections(path.join(dir, "does-not-exist")), []);
    assert.deepEqual(await readNeoRoleProjections(dir), []);
  } finally {
    await dispose();
  }
});

test("a role with a Neo lock projects skills with the lock's hashes", async () => {
  const { dir, dispose } = await withTempDir("lock");
  try {
    await seedRole(dir, "programmer", {
      skills: { "git-workflow": "# git 工作流\n", pdf: "# pdf\n" },
      lock: [
        "version: 1",
        "skills:",
        "  git-workflow:",
        "    sourceType: git",
        "    hash: a1b2c3",
        "    installedAt: '2026-11-17T00:00:00Z'",
        "    source: https://example.com/skills",
        "  pdf:",
        "    sourceType: wellknown",
        "    hash: d4e5f6",
        "    installedAt: '2026-11-17T00:00:00Z'",
      ].join("\n"),
    });
    const projections = await readNeoRoleProjections(dir);
    assert.equal(projections.length, 1);
    const role = projections[0];
    assert.equal(role.key, "programmer");
    assert.equal(role.name, "programmer");
    assert.deepEqual(
      role.skills.map((skill) => [skill.name, skill.hash, skill.via, skill.sourceType]),
      [
        ["git-workflow", "a1b2c3", "lock", "git"],
        ["pdf", "d4e5f6", "lock", "wellknown"],
      ],
    );
  } finally {
    await dispose();
  }
});

test("without a lock the hash falls back to the directory content sha", async () => {
  const { dir, dispose } = await withTempDir("dirsha");
  try {
    await seedRole(dir, "tester", { skills: { checklist: "# 测试清单\n" } });
    const [role] = await readNeoRoleProjections(dir);
    const first = role.skills[0];
    assert.equal(first.name, "checklist");
    assert.equal(first.via, "dir");
    assert.match(first.hash, /^[0-9a-f]{64}$/);

    // Independent recomputation: editing the skill content changes the hash.
    await writeFile(path.join(dir, "roles", "tester", "skills", "checklist", "SKILL.md"), "# 测试清单 v2\n", "utf8");
    const [again] = await readNeoRoleProjections(dir);
    assert.notEqual(again.skills[0].hash, first.hash);

    // Same bytes → same hash, independent of file order on disk.
    await writeFile(path.join(dir, "roles", "tester", "skills", "checklist", "SKILL.md"), "# 测试清单\n", "utf8");
    const [restored] = await readNeoRoleProjections(dir);
    assert.equal(restored.skills[0].hash, first.hash);
  } finally {
    await dispose();
  }
});

test("a corrupt lock never kills the projection — hashes fall back to dir sha", async () => {
  const { dir, dispose } = await withTempDir("corrupt-lock");
  try {
    await seedRole(dir, "pm", {
      skills: { docs: "# 文档\n" },
      lock: "version: 1\nskills: [this is not a mapping",
    });
    const [role] = await readNeoRoleProjections(dir);
    assert.equal(role.skills.length, 1);
    assert.equal(role.skills[0].via, "dir");
  } finally {
    await dispose();
  }
});

test("role.yaml declares domains (and optional display name); missing file = no domains", async () => {
  const { dir, dispose } = await withTempDir("domains");
  try {
    await seedRole(dir, "programmer", {
      skills: { pdf: "# pdf\n" },
      roleYaml: "domains: [coding, review]\nname: 程序员\ntagline: 工作区主力\n",
    });
    await seedRole(dir, "bare");
    const projections = await readNeoRoleProjections(dir);
    assert.equal(projections.length, 2);
    const programmer = projections.find((role) => role.key === "programmer");
    const bare = projections.find((role) => role.key === "bare");
    assert.deepEqual(programmer.domains, ["coding", "review"]);
    assert.equal(programmer.name, "程序员");
    assert.equal(programmer.tagline, "工作区主力");
    assert.deepEqual(bare.domains, []);
    assert.equal(bare.name, "bare");
  } finally {
    await dispose();
  }
});

test("mcp.yaml projects a server summary without secrets", async () => {
  const { dir, dispose } = await withTempDir("mcp");
  try {
    await seedRole(dir, "programmer", {
      skills: { pdf: "# pdf\n" },
      mcpYaml: [
        "version: 1",
        "servers:",
        "  github:",
        "    transport: stdio",
        "    command: npx",
        "    args: ['-y', '@modelcontextprotocol/server-github']",
        "    env: { GITHUB_TOKEN: 'env:GITHUB_TOKEN' }",
        "  remote:",
        "    transport: http",
        "    url: https://mcp.example.com/mcp",
      ].join("\n"),
    });
    const [role] = await readNeoRoleProjections(dir);
    assert.deepEqual(role.mcp, [
      { name: "github", transport: "stdio" },
      { name: "remote", transport: "http" },
    ]);
  } finally {
    await dispose();
  }
});

test("AGENTS.md becomes the role persona; the create-stub reads as no persona", async () => {
  const { dir, dispose } = await withTempDir("persona");
  try {
    await seedRole(dir, "programmer", {
      skills: { pdf: "# pdf\n" },
      agentsMd: "严谨务实的程序员：测试先行。\n",
    });
    await seedRole(dir, "fresh", {
      skills: { pdf: "# pdf\n" },
      agentsMd: "<!-- neo: write the system prompt for role \"fresh\" here -->\n",
    });
    const projections = await readNeoRoleProjections(dir);
    const programmer = projections.find((role) => role.key === "programmer");
    const fresh = projections.find((role) => role.key === "fresh");
    assert.equal(programmer.persona, "严谨务实的程序员：测试先行。");
    assert.equal(fresh.persona, "");
  } finally {
    await dispose();
  }
});

test("skills are the sub-directories of skills/ — loose files and bad role names stay out", async () => {
  const { dir, dispose } = await withTempDir("dirs");
  try {
    await seedRole(dir, "programmer", { skills: { pdf: "# pdf\n" } });
    await writeFile(path.join(dir, "roles", "programmer", "skills", "stray.md"), "loose file\n", "utf8");
    await mkdir(path.join(dir, "roles", "Bad_Name"), { recursive: true });
    await mkdir(path.join(dir, "roles", ".hidden"), { recursive: true });
    const projections = await readNeoRoleProjections(dir);
    assert.deepEqual(projections.map((role) => role.key), ["programmer"]);
    assert.deepEqual(projections[0].skills.map((skill) => skill.name), ["pdf"]);
  } finally {
    await dispose();
  }
});
