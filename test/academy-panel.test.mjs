/**
 * 票 a03 — 学院浮层 host door (src/host/academy/panel.mjs) against the REAL
 * vendored Neo CLI in fixture NEO_HOMEs (native Windows paths — a POSIX-ish
 * "/c/..." env value silently becomes C:\c\... for node on Windows).
 * Never touches the user's real ~/.neo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openStore } from "../src/host/store.mjs";
import { createAcademyPanel } from "../src/host/academy/panel.mjs";
import { readNeoRoleProjections } from "../src/host/academy/neo-roles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_CLI = path.join(root, "vendor", "neo", "bin", "neo.js");

/** @param {string} name */
async function withTempDir(name) {
  const dir = await mkdtemp(path.join(tmpdir(), `cubicle-a03-${name}-`));
  const dispose = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        return;
      } catch (/** @type {any} */ err) {
        if (err.code !== "EBUSY" && err.code !== "EPERM") throw err;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };
  return { dir, dispose };
}

/**
 * @param {string} dir
 * @returns {{ store: ReturnType<typeof openStore>, neoHome: string, door: ReturnType<typeof createAcademyPanel>, env: Record<string, string | undefined> }}
 */
function makeDoor(dir) {
  const neoHome = path.join(dir, "neo-home");
  const store = openStore({ dataDir: path.join(dir, "data") });
  const env = { ...process.env, NEO_HOME: neoHome };
  const door = createAcademyPanel({ store, nodeBinary: process.execPath, cliEntry: VENDOR_CLI, env });
  return { store, neoHome, door, env };
}

/**
 * Seed a Neo role (dir + optional role.yaml domains + optional skills), then
 * run a01's projection refresh so the store cache has the source='neo' row.
 * @param {string} neoHome @param {ReturnType<typeof openStore>} store
 * @param {{ key: string, domains?: string[], skills?: Record<string,string> }} spec
 */
async function seedRole(neoHome, store, spec) {
  const roleDir = path.join(neoHome, "roles", spec.key);
  await mkdir(path.join(roleDir, "skills"), { recursive: true });
  for (const [name, body] of Object.entries(spec.skills ?? {})) {
    const skillDir = path.join(roleDir, "skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), body, "utf8");
  }
  if (spec.domains && spec.domains.length > 0) {
    await writeFile(path.join(roleDir, "role.yaml"), `version: 1\ndomains:\n${spec.domains.map((d) => `  - ${d}`).join("\n")}\n`, "utf8");
  }
  store.syncRoleProjection(await readNeoRoleProjections(neoHome));
}

/** Seed a library/<domain>/<skill> dir (fixture files, not app behavior). */
async function seedLibrarySkill(neoHome, domain, skill, body = "BODY") {
  const dir = path.join(neoHome, "library", domain, skill);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
  return dir;
}

test("probe: the vendored bundle answers and meets the required version", async () => {
  const { dir, dispose } = await withTempDir("probe-ok");
  try {
    const { door } = makeDoor(dir);
    const p = await door.probe();
    assert.equal(p.available, true, `probe failed: ${p.reason}`);
    assert.equal(p.reason, null);
    assert.match(String(p.version), /^\d+\.\d+\.\d+$/);
  } finally {
    await dispose();
  }
});

test("probe degradation: missing bundle / too-old version → available:false with a readable reason, no throw", async () => {
  const { dir, dispose } = await withTempDir("probe-bad");
  try {
    const store = openStore({ dataDir: path.join(dir, "data") });
    const env = { ...process.env, NEO_HOME: path.join(dir, "neo-home") };

    const missing = createAcademyPanel({ store, nodeBinary: process.execPath, cliEntry: path.join(dir, "nope", "neo.js"), env });
    const pMissing = await missing.probe();
    assert.equal(pMissing.available, false);
    assert.ok(pMissing.reason && pMissing.reason.length > 10, "readable reason");

    const stub = path.join(dir, "old-neo.mjs");
    await writeFile(stub, 'console.log("0.2.2")\n', "utf8");
    const old = createAcademyPanel({ store, nodeBinary: process.execPath, cliEntry: stub, env });
    const pOld = await old.probe();
    assert.equal(pOld.available, false);
    assert.match(String(pOld.reason), /过老/);

    // The panel keeps answering read-only and writes are refused with a readable
    // error — nothing throws uncaught (验收: neo 缺失或版本过老 → 降级只读).
    const snap = await old.snapshot();
    assert.equal(snap.readOnly, true);
    await assert.rejects(
      () => old.install({ source: "C:\\x", target: "domain", targetName: "demo" }),
      (/** @type {{ code?: string }} */ err) => err.code === "academy_neo_unavailable",
    );
  } finally {
    await dispose();
  }
});

test("empty ~/.neo → empty list, no error, nothing hardcoded", async () => {
  const { dir, dispose } = await withTempDir("empty");
  try {
    const { door } = makeDoor(dir);
    const snap = await door.snapshot();
    assert.equal(snap.readOnly, false);
    assert.deepEqual(snap.rows, []);
    assert.deepEqual(snap.domains, []);
    assert.deepEqual(snap.neoRoles, []);
  } finally {
    await dispose();
  }
});

test("list rows: role-layer + domain-layer from ~/.neo, 来源/hash/被引用角色 all present", async () => {
  const { dir, dispose } = await withTempDir("rows");
  try {
    const { store, neoHome, door } = makeDoor(dir);
    await seedRole(neoHome, store, { key: "dev", skills: { alpha: "A" } });
    await seedRole(neoHome, store, { key: "editor", domains: ["demo"] });
    await seedLibrarySkill(neoHome, "demo", "hello");

    const snap = await door.snapshot();
    const roleRow = snap.rows.find((r) => r.resourceKey === "r:dev/alpha");
    assert.ok(roleRow, JSON.stringify(snap.rows));
    assert.equal(roleRow.layer, "role");
    assert.equal(roleRow.hash && /^[0-9a-f]{64}$/.test(roleRow.hash), true);
    assert.deepEqual(roleRow.referencedBy, ["dev"]);
    assert.equal(roleRow.kind, "written"); // no mark, no lock → 手写

    const domainRow = snap.rows.find((r) => r.resourceKey === "d:demo/hello");
    assert.ok(domainRow, JSON.stringify(snap.rows));
    assert.equal(domainRow.layer, "domain");
    assert.equal(domainRow.kind, "written");
    assert.deepEqual(domainRow.referencedBy, ["editor"]); // 被哪些角色引用 ← role domains

    // lock sourceType surfaces as 来源 when Cubicle never installed it.
    const gitRole = { key: "ops", skills: [{ name: "tool", hash: "h", via: "lock", sourceType: "git" }] };
    store.syncRoleProjection([{ key: "ops", name: "ops", tagline: "", domains: [], skills: gitRole.skills, mcp: [], persona: "" }]);
    const snap2 = await door.snapshot();
    const remoteRow = snap2.rows.find((r) => r.resourceKey === "r:ops/tool");
    assert.equal(remoteRow?.kind, "remote");
  } finally {
    await dispose();
  }
});

test("dispatch (下发): role set --domains + converge clears lock-dirty + projection cache refreshes live", async () => {
  const { dir, dispose } = await withTempDir("dispatch");
  try {
    const { store, neoHome, door } = makeDoor(dir);
    await seedRole(neoHome, store, { key: "editor" });
    await seedLibrarySkill(neoHome, "demo", "hello");

    const out = await door.dispatch({ domain: "demo", roles: ["editor"] });
    assert.match(out.echo, /editor/);

    // neo side: domains written, lock exists but dirty cleared by `neo update`.
    const roleYaml = await readFile(path.join(neoHome, "roles", "editor", "role.yaml"), "utf8");
    assert.match(roleYaml, /domains:[\s\S]*demo/);
    const lock = await readFile(path.join(neoHome, "state", "locks", "editor.yaml"), "utf8").catch(() => "");
    assert.doesNotMatch(lock, /dirty:\s*true/);

    // a01 projection cache refreshed: 列表上的「引用角色」跟着变 (store row + row).
    const roleRow = store.listRoles().find((r) => r.key === "editor");
    assert.deepEqual(roleRow?.domains, ["demo"]);
    const domainRow = out.snapshot.rows.find((r) => r.resourceKey === "d:demo/hello");
    assert.deepEqual(domainRow?.referencedBy, ["editor"]);
  } finally {
    await dispose();
  }
});

test("remote 来源: first dispatch asks once (error code), confirmed retry persists the ack", async () => {
  const { dir, dispose } = await withTempDir("remote-ack");
  try {
    const { store, neoHome, door } = makeDoor(dir);
    await seedRole(neoHome, store, { key: "editor" });
    await seedRole(neoHome, store, { key: "writer" });
    await seedLibrarySkill(neoHome, "demo", "hello");
    // The domain came from a remote source (as if installed via the panel from a URL).
    store.upsertAcademyMark({ resourceKey: "d:demo", kind: "remote", source: "https://github.com/acme/skills" });

    await assert.rejects(
      () => door.dispatch({ domain: "demo", roles: ["editor"] }),
      (/** @type {{ code?: string, message?: string }} */ err) => {
        assert.equal(err.code, "academy_remote_unconfirmed");
        assert.match(err.message ?? "", /远端/);
        return true;
      },
    );

    await door.dispatch({ domain: "demo", roles: ["editor"], confirmed: true });
    const marks = store.listAcademyMarks();
    const mark = marks.find((m) => m.resourceKey === "d:demo");
    assert.equal(mark?.remoteAck, true);
    assert.equal(mark?.kind, "remote", "kind/source survive the ack");

    // 之后不再打扰: second dispatch to another role, no confirmed flag.
    await door.dispatch({ domain: "demo", roles: ["writer"] });
  } finally {
    await dispose();
  }
});

test("local / 手写 来源 never ask; unknown role/domain give readable errors", async () => {
  const { dir, dispose } = await withTempDir("dispatch-gates");
  try {
    const { store, neoHome, door } = makeDoor(dir);
    await seedRole(neoHome, store, { key: "editor" });
    await seedLibrarySkill(neoHome, "demo", "hello");

    // 手写 domain（无 mark）直发，不问。
    const out = await door.dispatch({ domain: "demo", roles: ["editor"] });
    assert.match(out.echo, /demo/);

    await assert.rejects(
      () => door.dispatch({ domain: "demo", roles: ["ghost"] }),
      (/** @type {{ code?: string, message?: string }} */ err) => {
        assert.equal(err.code, "academy_unknown_role");
        assert.match(err.message ?? "", /~\/\.neo|Neo 角色/);
        return true;
      },
    );
    await assert.rejects(
      () => door.dispatch({ domain: "ghost", roles: ["editor"] }),
      (/** @type {{ code?: string }} */ err) => err.code === "academy_unknown_domain",
    );
  } finally {
    await dispose();
  }
});

test("装 (install) via the vendored CLI from a LOCAL source: echo readable, mark persisted (本机)", async () => {
  const { dir, dispose } = await withTempDir("install");
  try {
    const { store, neoHome, door } = makeDoor(dir);
    // A local skill-source dir (absolute path — the upstream `skills` CLI
    // resolves relative paths inside its own staging root).
    const src = path.join(dir, "src");
    await mkdir(path.join(src, "skills", "hello-panel"), { recursive: true });
    await writeFile(path.join(src, "skills", "hello-panel", "SKILL.md"), "---\nname: hello-panel\ndescription: A panel demo skill\n---\nhi\n", "utf8");

    const out = await door.install({ source: src, target: "domain", targetName: "demo" });
    assert.match(out.echo, /installed hello-panel/);
    const mark = store.listAcademyMarks().find((m) => m.resourceKey === "d:demo");
    assert.equal(mark?.kind, "local");
    assert.equal(mark?.source, src);
    const row = out.snapshot.rows.find((r) => r.resourceKey === "d:demo/hello-panel");
    assert.ok(row, `rows: ${JSON.stringify(out.snapshot.rows.map((r) => r.resourceKey))}`);
    assert.equal(row.kind, "local");
  } finally {
    await dispose();
  }
});

test("装 failure: readable reason comes back through the door (academy_cli_failed)", async () => {
  const { dir, dispose } = await withTempDir("install-fail");
  try {
    const { door } = makeDoor(dir);
    const ghost = path.join(dir, "no-such-src");
    await assert.rejects(
      () => door.install({ source: ghost, target: "domain", targetName: "demo" }),
      (/** @type {{ code?: string, message?: string }} */ err) => {
        assert.equal(err.code, "academy_cli_failed");
        assert.match(err.message ?? "", /neo add/);
        return true;
      },
    );
  } finally {
    await dispose();
  }
});

test("install rejects malformed payloads before spawning anything", async () => {
  const { dir, dispose } = await withTempDir("install-invalid");
  try {
    const { door } = makeDoor(dir);
    await assert.rejects(
      () => door.install({ source: "   ", target: "domain", targetName: "demo" }),
      (/** @type {{ code?: string }} */ err) => err.code === "invalid_payload",
    );
    await assert.rejects(
      () => door.install({ source: "x", target: "domain", targetName: "Bad Name!" }),
      (/** @type {{ code?: string }} */ err) => err.code === "invalid_payload",
    );
    await assert.rejects(
      () => door.install({ source: "x", target: "weird", targetName: "demo" }),
      (/** @type {{ code?: string }} */ err) => err.code === "invalid_payload",
    );
    await assert.rejects(
      () => door.install({ source: "x", target: "domain", targetName: "demo", skills: ["bad name"] }),
      (/** @type {{ code?: string }} */ err) => err.code === "invalid_payload",
    );
  } finally {
    await dispose();
  }
});
