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
