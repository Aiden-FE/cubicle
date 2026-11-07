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
  // Windows: a just-closed SQLite/WAL file can take a few ticks to unlock;
  // retry the cleanup instead of letting a race masquerade as a failure.
  const dispose = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(dataDir, { recursive: true, force: true });
        return;
      } catch (/** @type {any} */ err) {
        if (err.code !== "EBUSY" && err.code !== "EPERM") throw err;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };
  return { dataDir, dispose };
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

/**
 * Hire the default-company programmer onto desk 1 and return the employee row.
 * @param {ReturnType<typeof openStore>} store
 */
function hireProgrammer(store) {
  const group = store.officeSnapshot().groups[0];
  const desk = store.listDesks({ groupId: group.id })[0];
  const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));
  return store.hireEmployee({ deskId: desk.id, roleId: programmer.id, name: "小程" }).employee;
}

test("employeeById answers with the frozen role snapshot, and null for unknown ids", async () => {
  const { dataDir, dispose } = await withTempDir("employee-by-id");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const row = /** @type {any} */ (store.employeeById(employee.id));
    assert.equal(row.id, employee.id);
    assert.equal(row.name, "小程");
    assert.equal(row.roleSnapshot.manifest.engine, "pi");
    assert.ok(row.roleSnapshot.manifest.persona.includes("严谨务实"));
    assert.equal(store.employeeById(99999), null);
    store.close();
  } finally {
    await dispose();
  }
});

test("an employee's engine session is created once, keyed by employee, and survives a reopen", async () => {
  const { dataDir, dispose } = await withTempDir("engine-session");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const dirs = {
      agentDir: path.join(dataDir, "engines", "pi", "agent"),
      sessionsDir: path.join(dataDir, "engines", "pi", "sessions"),
      workspaceDir: path.join(dataDir, "engines", "pi", "workspace"),
    };

    const first = store.getOrCreateEmployeeSession({ employeeId: employee.id, engine: "pi", ...dirs });
    assert.equal(first.employeeId, employee.id);
    assert.equal(first.engine, "pi");
    assert.equal(first.agentDir, dirs.agentDir);
    assert.equal(first.sessionFile, null);

    // Reuse: same employee → the same session entity, not a second row.
    const again = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      ...dirs,
      agentDir: path.join(dataDir, "elsewhere"),
    });
    assert.equal(again.id, first.id);
    assert.equal(again.agentDir, dirs.agentDir);

    // The resume pointer (engine-owned session file) is stored on the entity.
    store.setEmployeeSessionFile({ employeeSessionId: first.id, sessionFile: path.join(dirs.sessionsDir, "s.jsonl") });

    store.close();
    const reopened = openStore({ dataDir });
    const persisted = reopened.getOrCreateEmployeeSession({ employeeId: employee.id, engine: "pi", ...dirs });
    assert.equal(persisted.id, first.id);
    assert.equal(persisted.sessionFile, path.join(dirs.sessionsDir, "s.jsonl"));
    reopened.close();
  } finally {
    await dispose();
  }
});

test("employee sessions reject unknown employees and one employee never gets two rows", async () => {
  const { dataDir, dispose } = await withTempDir("engine-session-errors");
  try {
    const store = openStore({ dataDir });
    const dirs = { agentDir: "a", sessionsDir: "s", workspaceDir: "w" };
    assert.throws(
      () => store.getOrCreateEmployeeSession({ employeeId: 99999, engine: "pi", ...dirs }),
      (err) => /** @type {{ code?: string }} */ (err).code === "unknown_employee",
    );
    store.close();
  } finally {
    await dispose();
  }
});

test("runs are created as running, finished with an outcome, and the latest run per employee survives a reopen", async () => {
  const { dataDir, dispose } = await withTempDir("runs");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const session = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });

    const firstRun = store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "读一下 hello.txt" });
    assert.equal(firstRun.status, "running");
    assert.equal(firstRun.prompt, "读一下 hello.txt");
    assert.equal(firstRun.employeeSessionId, session.id);
    assert.equal(firstRun.endedAt, null);

    const finished = store.finishRun({ runId: firstRun.id, status: "completed" });
    assert.equal(finished.status, "completed");
    assert.notEqual(finished.endedAt, null);

    // A second run makes the first one no longer the latest.
    const secondRun = store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "再读一次" });
    store.finishRun({ runId: secondRun.id, status: "aborted" });

    store.close();
    const reopened = openStore({ dataDir });
    const latest = /** @type {any} */ (reopened.latestRunForEmployee(employee.id));
    assert.equal(latest.id, secondRun.id);
    assert.equal(latest.status, "aborted");
    assert.equal(/** @type {any} */ (reopened.employeeById(employee.id)).name, "小程");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("opening the store marks runs that were still running as interrupted", async () => {
  const { dataDir, dispose } = await withTempDir("runs-interrupted");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const session = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });
    store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "会中断" });
    store.close();

    const reopened = openStore({ dataDir });
    const latest = /** @type {any} */ (reopened.latestRunForEmployee(employee.id));
    assert.equal(latest.status, "interrupted");
    assert.notEqual(latest.endedAt, null);
    reopened.close();
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

// — task bookkeeping (ticket 05: 工单与产出) —

/**
 * @param {ReturnType<typeof openStore>} store
 * @param {{ id: number }} employee
 */
function makeTask(store, employee) {
  const group = store.officeSnapshot().groups[0];
  return store.createTask({
    groupId: group.id,
    employeeId: employee.id,
    workspaceDir: path.join(store.dataDir, "engines", "pi", `employee-${employee.id}`, "workspace"),
    title: "给 greet.txt 加一行欢迎语",
    goal: "给 greet.txt 加一行欢迎语，并保证测试通过",
    playbook: "feature",
    acceptance: ["欢迎语在 greet.txt 里可见", "测试全部通过"],
    baseHead: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
  });
}

test("a task records its git start HEAD, playbook and editable acceptance, and survives a reopen", async () => {
  const { dataDir, dispose } = await withTempDir("task-create");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    assert.equal(task.status, "open");
    assert.equal(task.playbook, "feature");
    assert.equal(task.baseHead, "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c");
    assert.deepEqual(task.acceptance, ["欢迎语在 greet.txt 里可见", "测试全部通过"]);

    const listed = store.listTasks({ groupId: task.groupId });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, task.id);
    assert.equal(listed[0].employeeName, "小程");

    store.close();
    const reopened = openStore({ dataDir });
    const again = /** @type {any} */ (reopened.taskById(task.id));
    assert.equal(again.goal, "给 greet.txt 加一行欢迎语，并保证测试通过");
    assert.equal(again.baseHead, task.baseHead);
    reopened.close();
  } finally {
    await dispose();
  }
});

test("the five-state task machine (待办/进行中/待验收/完成/失败) accepts only legal transitions", async () => {
  const { dataDir, dispose } = await withTempDir("task-status");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    assert.equal(task.status, "open");

    // 派单 → 进行中 → 跑完自动待验收 → 通过 → 完成（终态）
    assert.equal(store.setTaskStatus(task.id, "running").status, "running");
    assert.equal(store.setTaskStatus(task.id, "review").status, "review");
    assert.equal(store.setTaskStatus(task.id, "done").status, "done");
    // 完成是终态：谁都不能再把已完成的工单拉回任何状态
    for (const next of ["open", "running", "review", "failed"]) {
      assert.throws(
        () => store.setTaskStatus(task.id, /** @type {any} */ (next)),
        (err) => /** @type {{ code?: string }} */ (err).code === "invalid_transition",
        `done → ${next} must be rejected`,
      );
    }
    store.close();
  } finally {
    await dispose();
  }
});

test("skipping states is impossible: 待办 cannot jump to 待验收/完成/失败, 待验收 cannot jump to 失败", async () => {
  const { dataDir, dispose } = await withTempDir("task-skip");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    for (const next of ["review", "done", "failed"]) {
      assert.throws(
        () => store.setTaskStatus(task.id, /** @type {any} */ (next)),
        (err) => /** @type {{ code?: string }} */ (err).code === "invalid_transition",
        `open → ${next} must be rejected`,
      );
    }
    store.setTaskStatus(task.id, "running");
    assert.throws(
      () => store.setTaskStatus(task.id, "done"),
      (err) => /** @type {{ code?: string }} */ (err).code === "invalid_transition",
    );
    store.setTaskStatus(task.id, "review");
    assert.throws(
      () => store.setTaskStatus(task.id, "failed"),
      (err) => /** @type {{ code?: string }} */ (err).code === "invalid_transition",
    );
    // unknown words are still payload errors, not transition errors
    assert.throws(
      () => store.setTaskStatus(task.id, /** @type {any} */ ("accepted")),
      (err) => /** @type {{ code?: string }} */ (err).code === "invalid_payload",
    );
    store.close();
  } finally {
    await dispose();
  }
});

test("打回 (review → running) and 取消 (running → failed) and 重试 (failed → running) are legal", async () => {
  const { dataDir, dispose } = await withTempDir("task-loop");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    store.setTaskStatus(task.id, "running");
    store.setTaskStatus(task.id, "review");
    assert.equal(store.setTaskStatus(task.id, "running").status, "running"); // 打回：同一任务再开工
    assert.equal(store.setTaskStatus(task.id, "failed").status, "failed"); // 取消：终止并标记失败
    assert.equal(store.setTaskStatus(task.id, "running").status, "running"); // 失败后可重试
    store.setTaskStatus(task.id, "review");
    assert.equal(store.setTaskStatus(task.id, "done").status, "done");
    store.close();
  } finally {
    await dispose();
  }
});

test("an old database (ticket 05 schema: finished + old CHECK) migrates tasks to the five-state machine", async () => {
  const { dataDir, dispose } = await withTempDir("task-state-migration");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");
    store.setTaskStatus(task.id, "review");
    store.close();

    // Rewind the file to the pre-06 schema: task table whose CHECK still
    // allows only open/running/finished, one row parked at 已交产出.
    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec(`
      CREATE TABLE task_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES project_group(id),
        employee_id INTEGER NOT NULL REFERENCES employee(id),
        workspace_dir TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        playbook TEXT NOT NULL CHECK (playbook IN ('feature', 'bugfix', 'docs', 'free')),
        acceptance TEXT NOT NULL,
        base_head TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'running', 'finished')) DEFAULT 'open',
        created_at TEXT NOT NULL
      );
      INSERT INTO task_old SELECT id, group_id, employee_id, workspace_dir, title, goal, playbook, acceptance, base_head, 'finished', created_at FROM task;
      DROP TABLE task;
      ALTER TABLE task_old RENAME TO task;
    `);
    raw.close();

    const reopened = openStore({ dataDir});
    // 已交产出 rows become 待验收 — the boss still owes them a 通过/打回.
    assert.equal(/** @type {any} */ (reopened.taskById(task.id)).status, "review");
    // and the healed table accepts the new states (the old CHECK is gone).
    assert.equal(reopened.setTaskStatus(task.id, "running").status, "running"); // 打回
    assert.equal(reopened.setTaskStatus(task.id, "review").status, "review");
    assert.equal(reopened.setTaskStatus(task.id, "done").status, "done");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("runs can hang under a task and its task session (ticket 05: 挂在任务上的执行)", async () => {
  const { dataDir, dispose } = await withTempDir("task-run");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    const employee = /** @type {any} */ (store.employeeById(task.employeeId));
    const session = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });
    const taskSession = store.openTaskSession({
      taskId: task.id,
      employeeSessionId: session.id,
      engine: "pi",
    });
    assert.equal(taskSession.status, "running");

    const run = store.createRun({
      employeeId: employee.id,
      employeeSessionId: session.id,
      engine: "pi",
      prompt: "干活",
      taskId: task.id,
      taskSessionId: taskSession.id,
    });
    assert.equal(run.taskId, task.id);
    assert.equal(run.taskSessionId, taskSession.id);
    const byId = /** @type {any} */ (store.runById(run.id));
    assert.equal(byId.taskSessionId, taskSession.id);

    // a plain chat run (ticket 04) keeps task fields null
    const chatRun = store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "闲聊" });
    assert.equal(chatRun.taskId, null);
    assert.equal(chatRun.taskSessionId, null);
    store.close();
  } finally {
    await dispose();
  }
});

test("task sessions close with the run outcome; sessions still running at reopen go interrupted and the task returns to open", async () => {
  const { dataDir, dispose } = await withTempDir("task-session-interrupt");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    store.setTaskStatus(task.id, "running");
    const session = store.getOrCreateEmployeeSession({
      employeeId: task.employeeId,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });
    const taskSession = store.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine: "pi" });
    store.close();

    const reopened = openStore({ dataDir});
    const interrupted = /** @type {any} */ (reopened.latestTaskSessionForTask(task.id));
    assert.equal(interrupted.status, "interrupted");
    assert.equal(/** @type {any} */ (reopened.taskById(task.id)).status, "open");

    const done = reopened.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine: "pi" });
    const finished = reopened.finishTaskSession({ taskSessionId: done.id, status: "completed" });
    assert.equal(finished.status, "completed");
    assert.notEqual(finished.endedAt, null);
    reopened.close();
  } finally {
    await dispose();
  }
});

test("the four artifact kinds hang under the task in creation order", async () => {
  const { dataDir, dispose } = await withTempDir("task-artifacts");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    const session = store.getOrCreateEmployeeSession({
      employeeId: task.employeeId,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });
    const run = store.createRun({
      employeeId: task.employeeId,
      employeeSessionId: session.id,
      engine: "pi",
      prompt: "干活",
      taskId: task.id,
    });
    /** @type {("diff_summary" | "changed_files" | "command_output" | "report")[]} */
    const kinds = ["diff_summary", "changed_files", "command_output", "report"];
    for (const kind of kinds) {
      store.createArtifact({ taskId: task.id, runId: run.id, kind, content: `${kind} 内容` });
    }
    const artifacts = store.listArtifacts({ taskId: task.id });
    assert.deepEqual(artifacts.map((a) => a.kind), ["diff_summary", "changed_files", "command_output", "report"]);
    assert.equal(artifacts[3].content, "report 内容");
    assert.equal(artifacts[0].taskId, task.id);
    store.close();

    const reopened = openStore({ dataDir });
    assert.equal(reopened.listArtifacts({ taskId: task.id }).length, 4);
    reopened.close();
  } finally {
    await dispose();
  }
});

test("creating a task for an unknown employee or group is rejected", async () => {
  const { dataDir, dispose } = await withTempDir("task-bad");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const employee = hireProgrammer(store);
    const base = {
      groupId: group.id,
      employeeId: employee.id,
      workspaceDir: "w",
      title: "t",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "0".repeat(40),
    };
    assert.throws(
      () => store.createTask({ ...base, employeeId: 99999 }),
      (err) => /** @type {{ code?: string }} */ (err).code === "unknown_employee",
    );
    assert.throws(
      () => store.createTask({ ...base, groupId: 99999 }),
      (err) => /** @type {{ code?: string }} */ (err).code === "unknown_group",
    );
    store.close();
  } finally {
    await dispose();
  }
});

test("an old database (run rows without task columns) gains the task columns on reopen", async () => {
  const { dataDir, dispose } = await withTempDir("task-migration");
  try {
    // Simulate the pre-05 schema straight on the file (the store keeps its
    // single-writer discipline): drop the new tables and rebuild `run`
    // without the new columns — the next open must heal.
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const session = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });
    store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "旧行" });
    store.close();

    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec(`
      DROP TABLE IF EXISTS task;
      DROP TABLE IF EXISTS task_session;
      DROP TABLE IF EXISTS artifact;
      CREATE TABLE run_old AS
        SELECT id, employee_session_id, employee_id, engine, status, prompt, started_at, ended_at FROM run;
      DROP TABLE run;
      ALTER TABLE run_old RENAME TO run;
    `);
    raw.close();

    const reopened = openStore({ dataDir });
    const latest = /** @type {any} */ (reopened.latestRunForEmployee(employee.id));
    assert.equal(latest.prompt, "旧行");
    assert.equal(latest.taskId, null);
    const task = makeTask(reopened, employee);
    assert.equal(/** @type {any} */ (reopened.taskById(task.id)).id, task.id);
    reopened.close();
  } finally {
    await dispose();
  }
});

// — 主界面外壳 (ticket 08: 公司活跃数聚合 + 公司范围工单列表) —

/**
 * Seed two companies; company A gets one group with one employee, company B
 * gets one group with its own employee. Returns handles for task building.
 *
 * @param {ReturnType<typeof openStore>} store
 */
function seedTwoCompanies(store) {
  const a = store.officeSnapshot().companies[0];
  const aGroup = store.officeSnapshot().groups[0];
  const b = store.createCompany({ name: "远岸软件" });
  const bGroup = store.createProjectGroup({ companyId: b.id, name: "看板组" });
  const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));
  const aDesk = store.listDesks({ groupId: aGroup.id })[0];
  const bDesk = store.listDesks({ groupId: bGroup.id })[0];
  const aEmployee = store.hireEmployee({ deskId: aDesk.id, roleId: programmer.id, name: "小程" }).employee;
  const bEmployee = store.hireEmployee({ deskId: bDesk.id, roleId: programmer.id, name: "小岸" }).employee;
  return { a, aGroup, b, bGroup, aEmployee, bEmployee };
}

/**
 * Create a task in a given group and walk it to a wanted status via legal
 * transitions (open → running → review → done; running → failed for 失败).
 *
 * @param {ReturnType<typeof openStore>} store
 * @param {number} groupId
 * @param {{ id: number }} employee
 * @param {"open" | "running" | "review" | "done" | "failed"} status
 * @param {string} title
 */
function taskAtStatus(store, groupId, employee, status, title) {
  const task = store.createTask({
    groupId,
    employeeId: employee.id,
    workspaceDir: "w",
    title,
    goal: title,
    playbook: "free",
    acceptance: [],
    baseHead: "0".repeat(40),
  });
  if (status === "open") return task;
  store.setTaskStatus(task.id, "running");
  if (status === "running") return /** @type {any} */ (store.taskById(task.id));
  if (status === "failed") {
    store.setTaskStatus(task.id, "failed");
    return /** @type {any} */ (store.taskById(task.id));
  }
  store.setTaskStatus(task.id, "review");
  if (status === "review") return /** @type {any} */ (store.taskById(task.id));
  store.setTaskStatus(task.id, "done");
  return /** @type {any} */ (store.taskById(task.id));
}

test("companyTaskCounts aggregates 进行中/待验收 per company across every group of it", async () => {
  const { dataDir, dispose } = await withTempDir("task-counts");
  try {
    const store = openStore({ dataDir });
    const { aGroup, bGroup, aEmployee, bEmployee } = seedTwoCompanies(store);

    // company A: 2 running + 1 review + noise that must NOT count (open/done/failed)
    taskAtStatus(store, aGroup.id, aEmployee, "running", "A1 慢活");
    taskAtStatus(store, aGroup.id, aEmployee, "running", "A2 慢活");
    taskAtStatus(store, aGroup.id, aEmployee, "review", "A3 待验收");
    taskAtStatus(store, aGroup.id, aEmployee, "open", "A4 待办");
    taskAtStatus(store, aGroup.id, aEmployee, "done", "A5 完成");
    taskAtStatus(store, aGroup.id, aEmployee, "failed", "A6 失败");
    // company B: 1 review
    taskAtStatus(store, bGroup.id, bEmployee, "review", "B1 待验收");

    const counts = /** @type {any} */ (store.companyTaskCounts());
    const aId = String(store.officeSnapshot().companies[0].id);
    const bId = String(store.officeSnapshot().companies[1].id);
    assert.deepEqual(counts[aId], { running: 2, review: 1 }, "只有 进行中/待验收 计入活跃数");
    assert.deepEqual(counts[bId], { running: 0, review: 1 });
    store.close();
  } finally {
    await dispose();
  }
});

test("officeSnapshot carries the per-company active counts next to the company list", async () => {
  const { dataDir, dispose } = await withTempDir("snapshot-counts");
  try {
    const store = openStore({ dataDir });
    const { aGroup, aEmployee } = seedTwoCompanies(store);
    taskAtStatus(store, aGroup.id, aEmployee, "running", "A1 慢活");
    const snapshot = /** @type {any} */ (store.officeSnapshot());
    const aId = String(snapshot.companies[0].id);
    const bId = String(snapshot.companies[1].id);
    assert.deepEqual(snapshot.taskCounts[aId], { running: 1, review: 0 });
    assert.deepEqual(snapshot.taskCounts[bId], { running: 0, review: 0 }, "没有工单的公司也在计数表里（0/0）");
    store.close();
  } finally {
    await dispose();
  }
});

test("listTasksForCompany lists every group's tasks of one company with employee names", async () => {
  const { dataDir, dispose } = await withTempDir("company-tasks");
  try {
    const store = openStore({ dataDir });
    const { a, aGroup, b, bGroup, aEmployee, bEmployee } = seedTwoCompanies(store);
    const a2Group = store.createProjectGroup({ companyId: a.id, name: "第二组" });
    const a2Desk = store.listDesks({ groupId: a2Group.id })[0];
    const a2Employee = store.hireEmployee({
      deskId: a2Desk.id,
      roleId: /** @type {any} */ (store.listRoles().find((r) => r.key === "tester")).id,
      name: "小测",
    }).employee;
    const t1 = taskAtStatus(store, aGroup.id, aEmployee, "open", "A1");
    const t2 = taskAtStatus(store, a2Group.id, a2Employee, "review", "A2");
    taskAtStatus(store, bGroup.id, bEmployee, "running", "B1");

    const listed = store.listTasksForCompany({ companyId: a.id });
    assert.deepEqual(listed.map((t) => t.id), [t2.id, t1.id], "跨组聚合且最新在前");
    assert.ok(listed.every((t) => typeof t.employeeName === "string" && t.employeeName.length > 0));
    const bListed = store.listTasksForCompany({ companyId: b.id });
    assert.deepEqual(bListed.map((t) => t.title), ["B1"], "别的公司的工单不混进来");
    store.close();
  } finally {
    await dispose();
  }
});

// — 上下班 (ticket 09: 时间表落库可改 / override 独立 / paused 落盘可续跑) —

/**
 * Park a task at 进行中 with one open task session + run, then close the
 * session/run with the ticket-09 'paused' outcome (下班落盘).
 *
 * @param {ReturnType<typeof openStore>} store
 * @param {{ id: number, employeeId: number }} task
 */
function pauseTaskRun(store, task) {
  const session = store.getOrCreateEmployeeSession({
    employeeId: task.employeeId,
    engine: "pi",
    agentDir: "a",
    sessionsDir: "s",
    workspaceDir: "w",
  });
  const taskSession = store.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine: "pi" });
  const run = store.createRun({
    employeeId: task.employeeId,
    employeeSessionId: session.id,
    engine: "pi",
    prompt: "干活",
    taskId: task.id,
    taskSessionId: taskSession.id,
  });
  return { session, taskSession, run };
}

test("每公司一份上下班时间表：没有配置行时读不到，upsert 就地覆盖并可改", async () => {
  const { dataDir, dispose } = await withTempDir("schedule-crud");
  try {
    const store = openStore({ dataDir });
    const a = store.officeSnapshot().companies[0];
    assert.equal(store.getCompanySchedule(a.id), null, "没配过时间表就是没有——默认值由上层给，不在库里编造");

    store.upsertCompanySchedule({ companyId: a.id, workStart: "09:00", workEnd: "18:00", graceSeconds: 90 });
    const row = /** @type {any} */ (store.getCompanySchedule(a.id));
    assert.deepEqual(
      { companyId: row.companyId, workStart: row.workStart, workEnd: row.workEnd, graceSeconds: row.graceSeconds },
      { companyId: a.id, workStart: "09:00", workEnd: "18:00", graceSeconds: 90 },
    );

    store.upsertCompanySchedule({ companyId: a.id, workStart: "10:30", workEnd: "20:15:30", graceSeconds: 4 });
    const changed = /** @type {any} */ (store.getCompanySchedule(a.id));
    assert.deepEqual(
      { workStart: changed.workStart, workEnd: changed.workEnd, graceSeconds: changed.graceSeconds },
      { workStart: "10:30", workEnd: "20:15:30", graceSeconds: 4 },
      "改时间表是同一行覆盖，不追加历史",
    );

    const b = store.createCompany({ name: "远岸软件" });
    store.upsertCompanySchedule({ companyId: b.id, workStart: "08:00", workEnd: "17:00", graceSeconds: 90 });
    assert.equal(/** @type {any} */ (store.getCompanySchedule(b.id)).workStart, "08:00");
    assert.equal(/** @type {any} */ (store.getCompanySchedule(a.id)).workStart, "10:30", "B 公司的时间表不污染 A 公司");

    store.close();
    const reopened = openStore({ dataDir });
    assert.equal(/** @type {any} */ (reopened.getCompanySchedule(a.id)).workEnd, "20:15:30", "时间表落盘 survives reopen");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("override 与 duty 状态是独立记录：写入/清除都不碰时间表行", async () => {
  const { dataDir, dispose } = await withTempDir("duty-override");
  try {
    const store = openStore({ dataDir });
    const company = store.officeSnapshot().companies[0];
    store.upsertCompanySchedule({ companyId: company.id, workStart: "09:00", workEnd: "18:00", graceSeconds: 90 });

    store.setDutyOverride({ companyId: company.id, mode: "off", at: 1_700_000_000_000 });
    assert.deepEqual(
      { .../** @type {any} */ (store.getDutyOverride(company.id)) } ,
      { companyId: company.id, mode: "off", at: 1_700_000_000_000 },
    );
    const afterOverride = /** @type {any} */ (store.getCompanySchedule(company.id));
    assert.deepEqual(
      { workStart: afterOverride.workStart, workEnd: afterOverride.workEnd, graceSeconds: afterOverride.graceSeconds },
      { workStart: "09:00", workEnd: "18:00", graceSeconds: 90 },
      "override 只是另一张表的记录：时间表原样",
    );

    store.clearDutyOverride(company.id);
    assert.equal(store.getDutyOverride(company.id), null);

    store.setDutyStatus({ companyId: company.id, phase: "grace", phaseSince: 1_700_000_000_000, graceUntil: 1_700_000_090_000 });
    store.close();
    const reopened = openStore({ dataDir });
    const status = /** @type {any} */ (reopened.getDutyStatus(company.id));
    assert.deepEqual(
      { phase: status.phase, phaseSince: status.phaseSince, graceUntil: status.graceUntil },
      { phase: "grace", phaseSince: 1_700_000_000_000, graceUntil: 1_700_000_090_000 },
      "相位（上班中/宽限中/下班中）落盘，重启后视图不说谎",
    );
    reopened.close();
  } finally {
    await dispose();
  }
});

test("run 与 task_session 接受 paused（下班落盘），任务保持「进行中」不跳态", async () => {
  const { dataDir, dispose } = await withTempDir("run-paused");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");
    const { taskSession, run } = pauseTaskRun(store, task);

    const pausedRun = store.finishRun({ runId: run.id, status: "paused" });
    assert.equal(pausedRun.status, "paused");
    assert.notEqual(pausedRun.endedAt, null, "paused 也收尾：run 行不再开着");
    const pausedSession = store.finishTaskSession({ taskSessionId: taskSession.id, status: "paused" });
    assert.equal(pausedSession.status, "paused");

    assert.equal(/** @type {any} */ (store.taskById(task.id)).status, "running", "五状态不新增第六态：暂停只是徽标");
    store.close();
  } finally {
    await dispose();
  }
});

test("重启后 paused 任务不被开库自愈翻回待办，仍可续跑（下班后可恢复）", async () => {
  const { dataDir, dispose } = await withTempDir("paused-survives-heal");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");
    const { taskSession, run } = pauseTaskRun(store, task);
    store.finishRun({ runId: run.id, status: "paused" });
    store.finishTaskSession({ taskSessionId: taskSession.id, status: "paused" });
    store.close();

    const reopened = openStore({ dataDir });
    assert.equal(/** @type {any} */ (reopened.runById(run.id)).status, "paused", "开库自愈只翻 running，不动 paused");
    assert.equal(/** @type {any} */ (reopened.latestTaskSessionForTask(task.id)).status, "paused");
    assert.equal(/** @type {any} */ (reopened.taskById(task.id)).status, "running", "暂停的任务停在「进行中」，等上班续跑");

    // 续跑 = 同一任务追加一条 task_session（与 06 打回同构）
    const again = reopened.openTaskSession({
      taskId: task.id,
      employeeSessionId: /** @type {any} */ (reopened.employeeSessionById(taskSession.employeeSessionId)).id,
      engine: "pi",
    });
    assert.equal(again.id > taskSession.id, true, "新会话行追加在同一任务下");
    assert.equal(reopened.listTaskSessions(task.id).length, 2, "历史连续：paused + 续跑的 running");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("开库自愈仍把崩溃遗留的 running 会话落回 interrupted、任务回待办（04/06 语义保持）", async () => {
  const { dataDir, dispose } = await withTempDir("heal-interrupted");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");
    pauseTaskRun(store, task); // session + run 都停在 running：像崩溃
    store.close();

    const reopened = openStore({ dataDir });
    assert.equal(/** @type {any} */ (reopened.latestTaskSessionForTask(task.id)).status, "interrupted");
    assert.equal(/** @type {any} */ (reopened.taskById(task.id)).status, "open", "崩溃自愈不变：任务回待办");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("工单列表携带最后一轮会话状态（暂停徽标的数据源）", async () => {
  const { dataDir, dispose } = await withTempDir("latest-session-status");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");
    const { taskSession, run } = pauseTaskRun(store, task);
    store.finishRun({ runId: run.id, status: "paused" });
    store.finishTaskSession({ taskSessionId: taskSession.id, status: "paused" });

    const company = store.officeSnapshot().companies[0];
    assert.equal(/** @type {any} */ (store.listTasks({ groupId: group.id })[0]).latestSessionStatus, "paused");
    assert.equal(/** @type {any} */ (store.listTasksForCompany({ companyId: company.id })[0]).latestSessionStatus, "paused");

    const fresh = store.openTaskSession({ taskId: task.id, employeeSessionId: taskSession.employeeSessionId, engine: "pi" });
    assert.equal(/** @type {any} */ (store.listTasks({ groupId: group.id })[0]).latestSessionStatus, "running", "续跑后徽标摘掉");
    void fresh;
    store.close();
  } finally {
    await dispose();
  }
});

test("旧库（run/task_session CHECK 没有 paused）开库时表重建，paused 状态可用", async () => {
  const { dataDir, dispose } = await withTempDir("pause-state-migration");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");
    const { taskSession, run } = pauseTaskRun(store, task);
    store.close();

    // Rewind to the pre-09 CHECK: neither run nor task_session knows 'paused'.
    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec(`
      CREATE TABLE run_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_session_id INTEGER NOT NULL REFERENCES employee_session(id),
        employee_id INTEGER NOT NULL REFERENCES employee(id),
        engine TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted')),
        prompt TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        usage TEXT,
        task_id INTEGER,
        task_session_id INTEGER
      );
      INSERT INTO run_old SELECT id, employee_session_id, employee_id, engine, status, prompt, started_at, ended_at, usage, task_id, task_session_id FROM run;
      DROP TABLE run;
      ALTER TABLE run_old RENAME TO run;
      CREATE TABLE task_session_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES task(id),
        employee_session_id INTEGER NOT NULL REFERENCES employee_session(id),
        engine TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted')),
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      INSERT INTO task_session_old SELECT id, task_id, employee_session_id, engine, status, started_at, ended_at FROM task_session;
      DROP TABLE task_session;
      ALTER TABLE task_session_old RENAME TO task_session;
    `);
    raw.close();

    const reopened = openStore({ dataDir });
    // 开库自愈先把遗留的 running 行翻成 interrupted（04 语义），所以这里
    // 新开一轮再落 paused：迁移的意义在于 CHECK 已放宽、paused 写进得去。
    const nextSession = reopened.openTaskSession({
      taskId: task.id,
      employeeSessionId: /** @type {any} */ (reopened.latestTaskSessionForTask(task.id)).employeeSessionId,
      engine: "pi",
    });
    const nextRun = reopened.createRun({
      employeeId: task.employeeId,
      employeeSessionId: nextSession.employeeSessionId,
      engine: "pi",
      prompt: "上班续跑",
      taskId: task.id,
      taskSessionId: nextSession.id,
    });
    const pausedRun = reopened.finishRun({ runId: nextRun.id, status: "paused" });
    assert.equal(pausedRun.status, "paused", "迁移后 CHECK 已放宽：paused 可落库");
    const pausedSession = reopened.finishTaskSession({ taskSessionId: nextSession.id, status: "paused" });
    assert.equal(pausedSession.status, "paused");
    // 崩溃遗留的旧一轮已被自愈翻成 interrupted、任务回待办（04 语义），
    // 新一轮的 paused 写入库不再被 CHECK 拒绝。
    assert.equal(/** @type {any} */ (reopened.taskById(task.id)).status, "open");
    reopened.close();
  } finally {
    await dispose();
  }
});

// — 票 12: 失败人话原因 / 任务级 token 预算 / 三层聚合的未计量三态 —

/** Open a task session + run under a task (票 12 helper mirrors pauseTaskRun). */
function runUnderTask(
  /** @type {ReturnType<typeof openStore>} */ store,
  /** @type {{ id: number, employeeId: number }} */ task,
) {
  const { session, taskSession, run } = pauseTaskRun(store, task);
  return { session, taskSession, run };
}

test("失败的人话原因落在 run 行上，任务按最近一轮失败会话读回", async () => {
  const { dataDir, dispose } = await withTempDir("fail-reason");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");

    const first = runUnderTask(store, task);
    const failedRun = store.finishRun({
      runId: first.run.id,
      status: "failed",
      failReason: "引擎报错（weird_code）：模型侧拒绝了这个请求。",
    });
    assert.equal(/** @type {any} */ (failedRun).failReason, "引擎报错（weird_code）：模型侧拒绝了这个请求。");
    assert.equal(store.latestFailReasonForTask(task.id), "引擎报错（weird_code）：模型侧拒绝了这个请求。");

    // 重试一轮跑干净了：最近一轮不再失败，人话原因跟着换掉。
    store.setTaskStatus(task.id, "failed"); // task hook 语义：失败收尾落「失败」
    store.setTaskStatus(task.id, "running"); // 06 的重试出口
    const second = runUnderTask(store, task);
    store.finishRun({ runId: second.run.id, status: "completed" });
    assert.equal(store.latestFailReasonForTask(task.id), null, "completed 会话没有失败原因可读");

    store.close();
    const reopened = openStore({ dataDir });
    assert.equal(/** @type {any} */ (reopened.runById(first.run.id)).failReason, "引擎报错（weird_code）：模型侧拒绝了这个请求。", "fail_reason 落盘 survives reopen");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("任务行带自己的 token 预算：创建时写入、没给默认 50 万、+50% 落库", async () => {
  const { dataDir, dispose } = await withTempDir("task-budget");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);

    const small = store.createTask({
      groupId: store.officeSnapshot().groups[0].id,
      employeeId: employee.id,
      workspaceDir: "w",
      title: "小预算",
      goal: "g",
      playbook: "free",
      acceptance: [],
      baseHead: "0".repeat(40),
      tokenBudget: 500,
    });
    assert.equal(/** @type {any} */ (store.taskById(small.id)).tokenBudget, 500);

    const plain = makeTask(store, employee);
    assert.equal(/** @type {any} */ (store.taskById(plain.id)).tokenBudget, 500_000, "没指定预算 = 预设角色的 50 万");

    store.setTaskTokenBudget(small.id, 750);
    assert.equal(/** @type {any} */ (store.taskById(small.id)).tokenBudget, 750, "+50% 是就地改这一张工单的预算");

    store.close();
    const reopened = openStore({ dataDir });
    assert.equal(/** @type {any} */ (reopened.taskById(small.id)).tokenBudget, 750, "预算落库 survives reopen（可再审）");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("finishRun 把全 0 usage 记成「计量到 0」，不塌回 null（缺失与 0 严格区分）", async () => {
  const { dataDir, dispose } = await withTempDir("zero-vs-null");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const session = store.getOrCreateEmployeeSession({ employeeId: employee.id, engine: "pi", agentDir: "a", sessionsDir: "s", workspaceDir: "w" });

    const measuredZero = store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "报了 0" });
    const zero = /** @type {any} */ (store.finishRun({
      runId: measuredZero.id,
      status: "completed",
      usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    }));
    assert.deepEqual(zero.usage, { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 }, "引擎真报了 0，就存 0——不被塌成 null");

    const unreported = store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "啥也没报" });
    const none = /** @type {any} */ (store.finishRun({ runId: unreported.id, status: "completed" }));
    assert.equal(none.usage, null, "没报 usage 才是 null（未计量）");

    store.close();
  } finally {
    await dispose();
  }
});

test("taskTokenSummary 三态：全 null 会话 = 未计量(measured=false)；一条有用量即 measured", async () => {
  const { dataDir, dispose } = await withTempDir("task-measured");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    store.setTaskStatus(task.id, "running");

    const first = runUnderTask(store, task);
    store.finishRun({ runId: first.run.id, status: "completed" }); // 未计量的一轮
    const before = /** @type {any} */ (store.taskTokenSummary(task.id));
    assert.equal(before.total, 0);
    assert.equal(before.measured, false, "没有任何一轮报过用量 → 未计量，不是 0");

    const second = runUnderTask(store, task); // 重试追加新会话（任务仍在「进行中」）
    store.finishRun({ runId: second.run.id, status: "completed", usage: { input: 100, cachedInput: 0, cacheWrite: 0, output: 20, reasoning: 0 } });
    const after = /** @type {any} */ (store.taskTokenSummary(task.id));
    assert.equal(after.total, 120);
    assert.equal(after.measured, true, "只要有一轮报过用量，任务就是计量过的");

    store.close();
  } finally {
    await dispose();
  }
});

test("employeeTokenTotals：员工级聚合走信封的数据源；没用量行的员工是未计量", async () => {
  const { dataDir, dispose } = await withTempDir("employee-totals");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const desks = store.listDesks({ groupId: group.id });
    const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));
    const a = store.hireEmployee({ deskId: desks[0].id, roleId: programmer.id, name: "甲" }).employee;
    const b = store.hireEmployee({ deskId: desks[1].id, roleId: programmer.id, name: "乙" }).employee;

    const sessionA = store.getOrCreateEmployeeSession({ employeeId: a.id, engine: "pi", agentDir: "a", sessionsDir: "s", workspaceDir: "w" });
    const runA1 = store.createRun({ employeeId: a.id, employeeSessionId: sessionA.id, engine: "pi", prompt: "活一" });
    store.finishRun({ runId: runA1.id, status: "completed", usage: { input: 100, cachedInput: 10, cacheWrite: 0, output: 20, reasoning: 5 } });
    const runA2 = store.createRun({ employeeId: a.id, employeeSessionId: sessionA.id, engine: "pi", prompt: "活二" });
    store.finishRun({ runId: runA2.id, status: "completed" }); // 未计量的一轮也计入员工名下

    const sessionB = store.getOrCreateEmployeeSession({ employeeId: b.id, engine: "pi", agentDir: "a2", sessionsDir: "s2", workspaceDir: "w2" });
    const runB = store.createRun({ employeeId: b.id, employeeSessionId: sessionB.id, engine: "pi", prompt: "乙的活" });
    store.finishRun({ runId: runB.id, status: "completed" }); // 从没报过用量

    const totals = /** @type {any} */ (store.employeeTokenTotals());
    assert.deepEqual(totals[String(a.id)], { total: 135, measured: true });
    assert.deepEqual(totals[String(b.id)], { total: 0, measured: false }, "从没报过用量的员工：未计量，不是 0");
    store.close();
  } finally {
    await dispose();
  }
});

test("companyTokenTotals：公司级聚合按公司隔离（左轨公司面板的数据源）", async () => {
  const { dataDir, dispose } = await withTempDir("company-totals");
  try {
    const store = openStore({ dataDir });
    const { aGroup, bGroup, aEmployee, bEmployee } = seedTwoCompanies(store);

    const sessionA = store.getOrCreateEmployeeSession({ employeeId: aEmployee.id, engine: "pi", agentDir: "a", sessionsDir: "s", workspaceDir: "w" });
    const task = taskAtStatus(store, aGroup.id, aEmployee, "running", "A 工单");
    const { run } = pauseTaskRun(store, task);
    store.finishRun({ runId: run.id, status: "completed", usage: { input: 300, cachedInput: 0, cacheWrite: 0, output: 60, reasoning: 0 } });
    void sessionA;

    const sessionB = store.getOrCreateEmployeeSession({ employeeId: bEmployee.id, engine: "pi", agentDir: "a", sessionsDir: "s", workspaceDir: "w" });
    const runB = store.createRun({ employeeId: bEmployee.id, employeeSessionId: sessionB.id, engine: "pi", prompt: "B 的活" });
    store.finishRun({ runId: runB.id, status: "completed" }); // B 公司只跑过未计量的一轮

    const totals = /** @type {any} */ (store.companyTokenTotals());
    const companies = store.officeSnapshot().companies;
    const aCompany = /** @type {any} */ (companies.find((/** @type {any} */ c) => c.name === "默认公司"));
    const bCompany = /** @type {any} */ (companies.find((/** @type {any} */ c) => c.name === "远岸软件"));
    assert.deepEqual(totals[String(aCompany.id)], { total: 360, measured: true });
    assert.deepEqual(totals[String(bCompany.id)], { total: 0, measured: false }, "B 公司没计量过 → 未计量");

    // officeSnapshot 直接把两张聚合带上（host 聚合走信封，渲染层只读）
    const snapshot = /** @type {any} */ (store.officeSnapshot());
    assert.deepEqual(snapshot.employeeTokens[String(aEmployee.id)], { total: 360, measured: true });
    assert.deepEqual(snapshot.companyTokens[String(aCompany.id)], { total: 360, measured: true });
    store.close();
  } finally {
    await dispose();
  }
});

test("旧库（没有 fail_reason / token_budget 列）开库时补列，默认预算 50 万", async () => {
  const { dataDir, dispose } = await withTempDir("t12-column-migration");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    void employee;
    store.close();

    // Rewind: drop the ticket-12 columns the way an 09-era database lacks them.
    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec("ALTER TABLE task DROP COLUMN token_budget;");
    raw.exec("ALTER TABLE run DROP COLUMN fail_reason;");
    raw.close();

    const reopened = openStore({ dataDir });
    assert.equal(/** @type {any} */ (reopened.taskById(task.id)).tokenBudget, 500_000, "补列后旧任务落到默认预算");
    const session = reopened.getOrCreateEmployeeSession({ employeeId: task.employeeId, engine: "pi", agentDir: "a", sessionsDir: "s", workspaceDir: "w" });
    const nextSession = reopened.openTaskSession({ taskId: task.id, employeeSessionId: session.id, engine: "pi" });
    const run = reopened.createRun({ employeeId: task.employeeId, employeeSessionId: session.id, engine: "pi", prompt: "重试", taskId: task.id, taskSessionId: nextSession.id });
    const done = /** @type {any} */ (reopened.finishRun({ runId: run.id, status: "failed", failReason: "引擎没有回音就收场了" }));
    assert.equal(done.failReason, "引擎没有回音就收场了", "补列后 fail_reason 写得进");
    reopened.close();
  } finally {
    await dispose();
  }
});
