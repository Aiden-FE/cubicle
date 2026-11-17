import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";
import { createService } from "../src/host/service.mjs";
import { createInvoke } from "../src/shared/envelope.mjs";

/** @param {string} name */
function withService(name) {
  const dataDir = mkdtempSync(path.join(tmpdir(), `cubicle-model-service-${name}-`));
  mkdirSync(path.join(dataDir, "settings"), { recursive: true });
  writeFileSync(
    path.join(dataDir, "settings", "models.json"),
    `${JSON.stringify(
      {
        version: 1,
        providers: [
          {
            key: "acme",
            displayName: "Acme",
            baseUrl: "http://127.0.0.1:9/v1",
            apiKey: "sk-test",
            protocol: "openai-responses",
            models: [
              {
                id: "m1",
                displayName: "M1",
                contextWindow: 1000000,
                maxTokens: 128000,
                input: ["text", "image"],
                reasoning: true,
                reasoningLevels: { off: null, low: "low", high: "high" },
              },
              {
                id: "m2",
                displayName: "M2",
                contextWindow: 1000000,
                maxTokens: 128000,
                input: ["text", "image"],
                reasoning: false,
                reasoningLevels: null,
              },
            ],
          },
        ],
        defaultProvider: "acme",
        defaultModel: "m1",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const store = openStore({ dataDir });
  const service = createService({ store, hostInfo: { pid: 1, startedAt: "x" } });
  return {
    service,
    store,
    dataDir,
    dispose: () => {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test("employee.hire stores the explicit provider/model/reasoning in the frozen snapshot", () => {
  const { service, store, dispose } = withService("hire");
  try {
    const group = store.officeSnapshot().groups[0];
    const desk = store.listDesks({ groupId: group.id })[0];
    const role = /** @type {any} */ (store.listRoles().find((entry) => entry.key === "programmer"));
    const reply = /** @type {any} */ (
      service.handle(
        createInvoke("h1", "employee.hire", {
          deskId: desk.id,
          roleId: role.id,
          name: "小模",
          engine: "pi",
          provider: "acme",
          model: "m1",
          reasoningEffort: "low",
        }),
      ).reply
    );
    assert.equal(reply.ok, true);
    // 票 a01 v2: model choice is pinned at the snapshot's top level.
    const pins = /** @type {any} */ (reply.payload).employee.roleSnapshot;
    assert.equal(pins.engine, "pi");
    assert.equal(pins.provider, "acme");
    assert.equal(pins.model, "m1");
    assert.equal(pins.reasoningEffort, "low");
  } finally {
    dispose();
  }
});

test("employee.update changes model + reasoning; a name-only edit survives a removed old model", () => {
  const { service, store, dispose } = withService("update");
  try {
    const group = store.officeSnapshot().groups[0];
    const desk = store.listDesks({ groupId: group.id })[0];
    const role = /** @type {any} */ (store.listRoles().find((entry) => entry.key === "programmer"));
    const hired = /** @type {any} */ (
      service.handle(
        createInvoke("h2", "employee.hire", {
          deskId: desk.id,
          roleId: role.id,
          name: "小改",
          engine: "pi",
          provider: "acme",
          model: "m1",
          reasoningEffort: "low",
        }),
      ).reply.payload
    ).employee;
    const updated = /** @type {any} */ (
      service.handle(
        createInvoke("h3", "employee.update", {
          employeeId: hired.id,
          name: "小改二",
          engine: "pi",
          provider: "acme",
          model: "m2",
          reasoningEffort: null,
        }),
      ).reply
    );
    assert.equal(updated.ok, true);
    const pins = /** @type {any} */ (updatePayload(updated)).employee.roleSnapshot;
    assert.equal(/** @type {any} */ (updatePayload(updated)).employee.name, "小改二");
    assert.equal(pins.model, "m2");
    assert.equal(pins.reasoningEffort, undefined);
  } finally {
    dispose();
  }
});

/** @param {any} reply */
function updatePayload(reply) {
  return reply.payload;
}

test("deleting a model used by an employee auto-reassigns to the next default", () => {
  const { service, store, dispose } = withService("delete-model");
  try {
    const group = store.officeSnapshot().groups[0];
    const desk = store.listDesks({ groupId: group.id })[0];
    const role = /** @type {any} */ (store.listRoles().find((entry) => entry.key === "programmer"));
    const hired = /** @type {any} */ (
      service.handle(
        createInvoke("h4", "employee.hire", {
          deskId: desk.id,
          roleId: role.id,
          name: "被回迁",
          engine: "pi",
          provider: "acme",
          model: "m1",
        }),
      ).reply.payload
    ).employee;
    const deleted = /** @type {any} */ (
      service.handle(createInvoke("h5", "model.model.delete", { providerKey: "acme", modelId: "m1" })).reply
    );
    assert.equal(deleted.ok, true);
    assert.equal(deleted.payload.reassigned.length, 1);
    const employee = store.employeeById(hired.id);
    assert.equal(employee?.roleSnapshot.model, "m2");
    assert.equal(employee?.roleSnapshot.provider, "acme");
    const library = JSON.parse(readFileSync(path.join(store.dataDir, "settings", "models.json"), "utf8"));
    assert.deepEqual(library.providers[0].models.map((/** @type {any} */ model) => model.id), ["m2"]);
    assert.equal(library.defaultModel, "m2");
  } finally {
    dispose();
  }
});

test("deleting the last compatible model for a busy engine is blocked until a fallback exists", () => {
  const { service, store, dispose } = withService("delete-block");
  try {
    const group = store.officeSnapshot().groups[0];
    const desk = store.listDesks({ groupId: group.id })[0];
    const role = /** @type {any} */ (store.listRoles().find((entry) => entry.key === "programmer"));
    const hired = /** @type {any} */ (
      service.handle(
        createInvoke("h6", "employee.hire", {
          deskId: desk.id,
          roleId: role.id,
          name: "唯一",
          engine: "pi",
          provider: "acme",
          model: "m1",
        }),
      ).reply.payload
    ).employee;
    // Remove m2 first so m1 is the only compatible model left.
    service.handle(createInvoke("h7", "model.model.delete", { providerKey: "acme", modelId: "m2" }));
    const blocked = /** @type {any} */ (
      service.handle(createInvoke("h8", "model.model.delete", { providerKey: "acme", modelId: "m1" })).reply
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error?.code, "model_in_use");
    assert.equal(store.employeeById(hired.id)?.roleSnapshot.model, "m1");
    assert.ok(readFileSync(path.join(store.dataDir, "settings", "models.json"), "utf8").includes("m1"));
  } finally {
    dispose();
  }
});
