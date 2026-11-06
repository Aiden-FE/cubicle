import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";
import { createService } from "../src/host/service.mjs";
import { createInvoke } from "../src/shared/envelope.mjs";

/**
 * @param {string} name
 */
async function withService(name) {
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-service-${name}-`));
  const store = openStore({ dataDir });
  const service = createService({
    store,
    hostInfo: { pid: 4242, startedAt: "2026-11-05T09:00:00.000Z" },
  });
  return {
    service,
    dispose: async () => {
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("office.get answers with the seeded office and host info", async () => {
  const { service, dispose } = await withService("office");
  try {
    const { reply, events } = service.handle(createInvoke("r1", "office.get", {}));
    assert.equal(reply.ok, true);
    assert.deepEqual(events, []);
    const snapshot = /** @type {any} */ (reply.payload);
    assert.equal(snapshot.host.pid, 4242);
    assert.equal(snapshot.host.startedAt, "2026-11-05T09:00:00.000Z");
    assert.equal(snapshot.desks.length, 4);
    assert.equal(snapshot.companies[0].name, "默认公司");
  } finally {
    await dispose();
  }
});

test("company.create answers with the new company and emits domain.changed", async () => {
  const { service, dispose } = await withService("company");
  try {
    const { reply, events } = service.handle(
      createInvoke("r2", "company.create", { name: "远岸软件" }),
    );
    assert.equal(reply.ok, true);
    assert.equal(/** @type {any} */ (reply.payload).name, "远岸软件");
    assert.equal(typeof /** @type {any} */ (reply.payload).id, "number");
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "event");
    assert.equal(events[0].topic, "domain.changed");
    assert.equal(/** @type {any} */ (events[0].payload).reason, "company.create");
  } finally {
    await dispose();
  }
});

test("projectGroup.create answers with group and its four desks, and emits domain.changed", async () => {
  const { service, dispose } = await withService("group");
  try {
    const created = service.handle(createInvoke("r3", "company.create", { name: "灯塔组" }));
    const companyId = /** @type {any} */ (created.reply.payload).id;
    const { reply, events } = service.handle(
      createInvoke("r4", "projectGroup.create", { companyId, name: "编辑器组" }),
    );
    assert.equal(reply.ok, true);
    assert.equal(/** @type {any} */ (reply.payload).group.name, "编辑器组");
    assert.equal(/** @type {any} */ (reply.payload).desks.length, 4);
    assert.equal(events[0].topic, "domain.changed");
  } finally {
    await dispose();
  }
});

test("creating a company or group activates it for the office view", async () => {
  const { service, dispose } = await withService("activate");
  try {
    const before = service.handle(createInvoke("r8", "office.get", {}));
    const defaultCompanyId = /** @type {any} */ (before.reply.payload).activeCompanyId;

    const company = service.handle(createInvoke("r9", "company.create", { name: "灯塔软件" }));
    const newCompanyId = /** @type {any} */ (company.reply.payload).id;
    const afterCompany = /** @type {any} */ (service.handle(createInvoke("r10", "office.get", {})).reply.payload);
    assert.equal(afterCompany.activeCompanyId, newCompanyId);

    const group = service.handle(
      createInvoke("r11", "projectGroup.create", { companyId: newCompanyId, name: "编辑器" }),
    );
    const newGroupId = /** @type {any} */ (group.reply.payload).group.id;
    const afterGroup = /** @type {any} */ (service.handle(createInvoke("r12", "office.get", {})).reply.payload);
    assert.equal(afterGroup.activeCompanyId, newCompanyId);
    assert.equal(afterGroup.activeGroupId, newGroupId);

    const switched = service.handle(
      createInvoke("r13", "office.setActive", { companyId: defaultCompanyId }),
    );
    assert.equal(switched.reply.ok, true);
    const afterSwitch = /** @type {any} */ (service.handle(createInvoke("r14", "office.get", {})).reply.payload);
    assert.equal(afterSwitch.activeCompanyId, defaultCompanyId);
    assert.equal(afterSwitch.groups.some((/** @type {{ id: number }} */ g) => g.id !== newGroupId), true);
  } finally {
    await dispose();
  }
});

test("office.setActive for an unknown company answers with an error", async () => {
  const { service, dispose } = await withService("badactive");
  try {
    const { reply } = service.handle(createInvoke("r15", "office.setActive", { companyId: 99999 }));
    assert.equal(reply.ok, false);
    assert.equal(reply.error?.code, "unknown_company");
  } finally {
    await dispose();
  }
});

test("role.list answers with the three preset roles and no events", async () => {
  const { service, dispose } = await withService("roles");
  try {
    const { reply, events } = service.handle(createInvoke("h1", "role.list", {}));
    assert.equal(reply.ok, true);
    assert.deepEqual(events, []);
    const roles = /** @type {any} */ (reply.payload).roles;
    assert.deepEqual(
      roles.map((/** @type {any} */ r) => r.key),
      ["programmer", "tester", "pm"],
    );
    assert.deepEqual(roles[0].manifest.tools, ["read", "write", "edit", "bash", "grep"]);
  } finally {
    await dispose();
  }
});

test("employee.hire occupies the desk, answers with employee + desk, and emits domain.changed", async () => {
  const { service, dispose } = await withService("hire");
  try {
    const rolesReply = service.handle(createInvoke("h2", "role.list", {})).reply;
    const programmer = /** @type {any} */ (rolesReply.payload).roles.find((/** @type {any} */ r) => r.key === "programmer");
    const deskId = /** @type {any} */ (service.handle(createInvoke("h3", "office.get", {})).reply.payload)
      .desks[0].id;

    const { reply, events } = service.handle(
      createInvoke("h4", "employee.hire", { deskId, roleId: programmer.id, name: "E2E 程序员" }),
    );
    assert.equal(reply.ok, true);
    assert.equal(/** @type {any} */ (reply.payload).employee.name, "E2E 程序员");
    assert.equal(/** @type {any} */ (reply.payload).employee.roleSnapshot.manifest.engine, "pi");
    assert.equal(/** @type {any} */ (reply.payload).desk.occupant.name, "E2E 程序员");
    assert.equal(events.length, 1);
    assert.equal(events[0].topic, "domain.changed");
    assert.equal(/** @type {any} */ (events[0].payload).reason, "employee.hire");

    // the office snapshot now shows an occupied desk
    const snapshot = /** @type {any} */ (service.handle(createInvoke("h5", "office.get", {})).reply.payload);
    const occupied = snapshot.desks.filter((/** @type {any} */ d) => d.occupant !== null);
    assert.equal(occupied.length, 1);
    assert.equal(occupied[0].occupant.roleSnapshot.key, "programmer");
  } finally {
    await dispose();
  }
});

test("employee.hire validates its payload and forwards domain errors", async () => {
  const { service, dispose } = await withService("hire-bad");
  try {
    const programmerId = /** @type {any} */ (
      service.handle(createInvoke("h6", "role.list", {})).reply.payload
    ).roles[0].id;
    const deskId = /** @type {any} */ (service.handle(createInvoke("h7", "office.get", {})).reply.payload)
      .desks[0].id;
    for (const payload of [
      {},
      { deskId: 0, roleId: programmerId },
      { deskId, roleId: 0 },
      { deskId: "x", roleId: 1 },
      { deskId: true, roleId: programmerId },
      { deskId: String(deskId), roleId: programmerId },
      { deskId, roleId: 1.5 },
    ]) {
      const { reply, events } = service.handle(createInvoke("h8", "employee.hire", payload));
      assert.equal(reply.ok, false);
      assert.equal(reply.error?.code, "invalid_payload");
      assert.deepEqual(events, []);
    }
    const occupiedReply = service.handle(createInvoke("h9", "employee.hire", { deskId, roleId: programmerId })).reply;
    assert.equal(occupiedReply.ok, true);
    const again = service.handle(createInvoke("h10", "employee.hire", { deskId, roleId: programmerId }));
    assert.equal(again.reply.ok, false);
    assert.equal(again.reply.error?.code, "desk_occupied");
    assert.deepEqual(again.events, []);
    const unknownRole = service.handle(createInvoke("h11", "employee.hire", { deskId: deskId + 1, roleId: 99999 }));
    assert.equal(unknownRole.reply.error?.code, "unknown_role");
  } finally {
    await dispose();
  }
});

test("unknown methods answer with an unknown_method error reply", async () => {
  const { service, dispose } = await withService("unknown");
  try {
    const { reply } = service.handle(createInvoke("r5", "desk.hire", {}));
    assert.equal(reply.ok, false);
    assert.equal(reply.error?.code, "unknown_method");
    assert.equal(reply.id, "r5");
  } finally {
    await dispose();
  }
});

test("company.create with a blank name answers with invalid_payload and emits nothing", async () => {
  const { service, dispose } = await withService("blank");
  try {
    for (const payload of [{}, { name: "" }, { name: "   " }, { name: 7 }]) {
      const { reply, events } = service.handle(createInvoke("r6", "company.create", payload));
      assert.equal(reply.ok, false);
      assert.equal(reply.error?.code, "invalid_payload");
      assert.deepEqual(events, []);
    }
  } finally {
    await dispose();
  }
});

test("projectGroup.create for an unknown company answers with unknown_company", async () => {
  const { service, dispose } = await withService("badref");
  try {
    const { reply, events } = service.handle(
      createInvoke("r7", "projectGroup.create", { companyId: 999, name: "无主组" }),
    );
    assert.equal(reply.ok, false);
    assert.equal(reply.error?.code, "unknown_company");
    assert.deepEqual(events, []);
  } finally {
    await dispose();
  }
});
