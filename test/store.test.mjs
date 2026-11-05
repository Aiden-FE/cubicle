import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";

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
