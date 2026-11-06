import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";
import { DatabaseSync } from "node:sqlite";

/**
 * @param {string} name
 * @returns {Promise<{ dataDir: string, dispose: () => Promise<void> }>}
 */
async function withTempDir(name) {
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-store-${name}-`));
  return { dataDir, dispose: () => rm(dataDir, { recursive: true, force: true }) };
}

test("a fresh store seeds one default company, one project group and four empty desks", async () => {
  const { dataDir, dispose } = await withTempDir("seed");
  try {
    const store = openStore({ dataDir });
    const snapshot = store.officeSnapshot();
    assert.equal(snapshot.companies.length, 1);
    assert.equal(snapshot.companies[0].name, "默认公司");
    assert.equal(snapshot.groups.length, 1);
    assert.equal(snapshot.groups[0].name, "默认项目组");
    assert.equal(snapshot.desks.length, 4);
    assert.deepEqual(
      snapshot.desks.map((desk) => desk.label),
      ["工位 1", "工位 2", "工位 3", "工位 4"],
    );
    for (const desk of snapshot.desks) {
      assert.equal(typeof desk.x, "number");
      assert.equal(typeof desk.y, "number");
      assert.equal(desk.occupant, null);
    }
    store.close();
  } finally {
    await dispose();
  }
});

test("creating a company and a project group survives closing and reopening the store", async () => {
  const { dataDir, dispose } = await withTempDir("reopen");
  try {
    const first = openStore({ dataDir });
    const company = first.createCompany({ name: "远岸软件" });
    const group = first.createProjectGroup({ companyId: company.id, name: "看板组" });
    first.close();

    const second = openStore({ dataDir });
    const snapshot = second.officeSnapshot();
    assert.deepEqual(
      snapshot.companies.map((c) => c.name),
      ["默认公司", "远岸软件"],
    );
    const groups = second.listGroups({ companyId: company.id });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, group.id);
    assert.equal(groups[0].name, "看板组");
    const desks = second.listDesks({ groupId: group.id });
    assert.equal(desks.length, 4);
    assert.deepEqual(
      desks.map((d) => d.label),
      ["工位 1", "工位 2", "工位 3", "工位 4"],
    );
    second.close();
  } finally {
    await dispose();
  }
});

test("seeding does not repeat on reopen", async () => {
  const { dataDir, dispose } = await withTempDir("seed-once");
  try {
    const first = openStore({ dataDir });
    first.close();
    const second = openStore({ dataDir });
    const third = openStore({ dataDir });
    assert.equal(third.officeSnapshot().companies.length, 1);
    second.close();
    third.close();
  } finally {
    await dispose();
  }
});

test("createProjectGroup seeds four empty desks for the new group", async () => {
  const { dataDir, dispose } = await withTempDir("group-desks");
  try {
    const store = openStore({ dataDir });
    const company = store.createCompany({ name: "灯塔组" });
    const group = store.createProjectGroup({ companyId: company.id, name: "编辑器" });
    const desks = store.listDesks({ groupId: group.id });
    assert.equal(desks.length, 4);
    assert.ok(desks.every((desk) => desk.groupId === group.id && desk.occupant === null));
    store.close();
  } finally {
    await dispose();
  }
});

test("officeSnapshot points at the first company and its most recent project group", async () => {
  const { dataDir, dispose } = await withTempDir("snapshot");
  try {
    const store = openStore({ dataDir });
    const snapshotBefore = store.officeSnapshot();
    const defaultCompany = snapshotBefore.companies[0];
    const defaultGroup = snapshotBefore.groups[0];

    const other = store.createCompany({ name: "第二公司" });
    store.createProjectGroup({ companyId: other.id, name: "另一组" });
    const newerGroup = store.createProjectGroup({ companyId: defaultCompany.id, name: "默认二组" });

    const snapshot = store.officeSnapshot();
    assert.equal(snapshot.activeCompanyId, defaultCompany.id);
    assert.equal(snapshot.activeGroupId, newerGroup.id);
    assert.deepEqual(
      snapshot.desks.map((d) => d.groupId),
      [newerGroup.id, newerGroup.id, newerGroup.id, newerGroup.id],
    );
    store.close();
  } finally {
    await dispose();
  }
});

test("a chosen company and project group drive the snapshot and survive reopen", async () => {
  const { dataDir, dispose } = await withTempDir("active");
  try {
    const store = openStore({ dataDir });
    const snapshot0 = store.officeSnapshot();
    const defaultCompany = snapshot0.companies[0];

    const other = store.createCompany({ name: "第三公司" });
    const otherGroup = store.createProjectGroup({ companyId: other.id, name: "第三组" });

    store.setActive({ companyId: other.id, groupId: otherGroup.id });
    const switched = store.officeSnapshot();
    assert.equal(switched.activeCompanyId, other.id);
    assert.equal(switched.activeGroupId, otherGroup.id);
    assert.ok(switched.desks.every((desk) => desk.groupId === otherGroup.id));

    // the default company keeps its own most-recent group as active
    store.setActive({ companyId: defaultCompany.id });
    const back = store.officeSnapshot();
    assert.equal(back.activeCompanyId, defaultCompany.id);

    store.close();
    const reopened = openStore({ dataDir });
    const persisted = reopened.officeSnapshot();
    assert.equal(persisted.activeCompanyId, defaultCompany.id);
    reopened.close();
  } finally {
    await dispose();
  }
});

test("an active selection pointing at a deleted row falls back safely", async () => {
  const { dataDir, dispose } = await withTempDir("active-fallback");
  try {
    const store = openStore({ dataDir });
    store.setActive({ companyId: 99999, groupId: 99999 });
    const snapshot = store.officeSnapshot();
    assert.equal(snapshot.activeCompanyId, snapshot.companies[0].id);
    assert.equal(snapshot.activeGroupId, snapshot.groups.at(-1)?.id);
    store.close();
  } finally {
    await dispose();
  }
});

test("createProjectGroup rejects an unknown company", async () => {
  const { dataDir, dispose } = await withTempDir("bad-company");
  try {
    const store = openStore({ dataDir });
    assert.throws(
      () => store.createProjectGroup({ companyId: 999, name: "无主组" }),
      (err) => /** @type {{ code?: string }} */ (err).code === "unknown_company",
    );
    store.close();
  } finally {
    await dispose();
  }
});

test("a fresh store seeds the three v1 preset roles with capability manifests", async () => {
  const { dataDir, dispose } = await withTempDir("roles");
  try {
    const store = openStore({ dataDir });
    const roles = store.listRoles();
    assert.deepEqual(
      roles.map((role) => role.key),
      ["programmer", "tester", "pm"],
    );
    assert.deepEqual(
      roles.map((role) => role.name),
      ["程序员", "测试", "产品经理"],
    );
    for (const role of roles) {
      assert.equal(typeof role.tagline, "string");
      assert.ok(role.tagline.length > 0);
      assert.equal(typeof role.manifest.persona, "string");
      assert.ok(Array.isArray(role.manifest.skills) && role.manifest.skills.length > 0);
      assert.ok(Array.isArray(role.manifest.tools) && role.manifest.tools.length > 0);
      assert.equal(role.manifest.engine, "pi");
      assert.equal(typeof role.manifest.cost.tokenBudgetPerTask, "number");
    }
    // 05 票预设要点：程序员带 git 工作流、测试的 tools 无 edit、产品经理无 bash
    assert.ok(roles[0].manifest.skills.includes("git 工作流"));
    assert.ok(!roles[1].manifest.tools.includes("edit"));
    assert.ok(!roles[2].manifest.tools.includes("bash"));
    store.close();
  } finally {
    await dispose();
  }
});

test("hiring occupies the desk and the employee with its role snapshot survives a reopen", async () => {
  const { dataDir, dispose } = await withTempDir("hire");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const [desk1, desk2] = store.listDesks({ groupId: group.id });
    const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));

    const hire = store.hireEmployee({ deskId: desk1.id, roleId: programmer.id, name: "小程" });
    assert.equal(hire.employee.name, "小程");
    assert.equal(hire.employee.roleId, programmer.id);
    assert.equal(hire.employee.companyId, group.companyId);
    assert.equal(/** @type {any} */ (hire.desk).occupant.id, hire.employee.id);

    const desks = store.listDesks({ groupId: group.id });
    assert.equal(/** @type {any} */ (desks[0].occupant).name, "小程");
    assert.equal(/** @type {any} */ (desks[0].occupant).roleSnapshot.key, "programmer");
    assert.ok(/** @type {any} */ (desks[0].occupant).roleSnapshot.manifest.skills.includes("git 工作流"));
    assert.equal(desks[1].occupant, null);
    store.close();

    const reopened = openStore({ dataDir });
    const after = reopened.listDesks({ groupId: group.id });
    assert.equal(/** @type {any} */ (after[0].occupant).name, "小程");
    assert.equal(/** @type {any} */ (after[0].occupant).roleSnapshot.manifest.engine, "pi");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("a later role edit never infects an already-hired employee, and the same role can staff another desk", async () => {
  const { dataDir, dispose } = await withTempDir("snapshot");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const [desk1, desk2] = store.listDesks({ groupId: group.id });
    const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));

    const first = store.hireEmployee({ deskId: desk1.id, roleId: programmer.id });
    const personaAtHire = first.employee.roleSnapshot.manifest.persona;

    // Change the factory role AFTER hiring (as a future role editor would).
    const db = new DatabaseSync(store.dbPath);
    db.prepare("UPDATE role SET name = ?, manifest = JSON_SET(manifest, '$.persona', ?) WHERE id = ?").run(
      "资深程序员",
      "改过的人格：什么都敢改。",
      programmer.id,
    );
    db.close();

    const second = store.hireEmployee({ deskId: desk2.id, roleId: programmer.id, name: "阿程" });
    assert.equal(second.employee.roleId, programmer.id);
    assert.notEqual(second.employee.id, first.employee.id);

    const desks = store.listDesks({ groupId: group.id });
    assert.equal(/** @type {any} */ (desks[0].occupant).roleSnapshot.manifest.persona, personaAtHire);
    assert.equal(/** @type {any} */ (desks[0].occupant).roleSnapshot.name, "程序员");
    // the second hire happened after the edit: it gets the new definition
    assert.equal(/** @type {any} */ (desks[1].occupant).roleSnapshot.name, "资深程序员");
    store.close();
  } finally {
    await dispose();
  }
});

test("hiring rejects an occupied desk, an unknown desk, and an unknown role", async () => {
  const { dataDir, dispose } = await withTempDir("hire-errors");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const [desk1, desk2] = store.listDesks({ groupId: group.id });
    const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));

    store.hireEmployee({ deskId: desk1.id, roleId: programmer.id });
    assert.throws(
      () => store.hireEmployee({ deskId: desk1.id, roleId: programmer.id }),
      (err) => /** @type {{ code?: string }} */ (err).code === "desk_occupied",
    );
    assert.throws(
      () => store.hireEmployee({ deskId: 99999, roleId: programmer.id }),
      (err) => /** @type {{ code?: string }} */ (err).code === "unknown_desk",
    );
    assert.throws(
      () => store.hireEmployee({ deskId: desk2.id, roleId: 99999 }),
      (err) => /** @type {{ code?: string }} */ (err).code === "unknown_role",
    );
    // the failed attempts left no orphan employees behind the first occupant
    const desks = store.listDesks({ groupId: group.id });
    assert.equal(/** @type {any} */ (desks[0].occupant).name, "程序员");
    store.close();
  } finally {
    await dispose();
  }
});

test("database and support folders live inside the given data directory in WAL mode", async () => {
  const { dataDir, dispose } = await withTempDir("layout");
  try {
    const store = openStore({ dataDir });
    assert.equal(store.dbPath, path.join(dataDir, "cubicle.db"));
    assert.equal(store.journalMode(), "wal");
    for (const folder of ["artifacts", "engines", "renders"]) {
      assert.ok(store.directoryExists(folder), `${folder} directory should exist`);
    }
    store.close();
  } finally {
    await dispose();
  }
});
