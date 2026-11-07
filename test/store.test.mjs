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

test("task status moves open → running → finished and rejects anything else", async () => {
  const { dataDir, dispose } = await withTempDir("task-status");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    assert.equal(store.setTaskStatus(task.id, "running").status, "running");
    assert.equal(store.setTaskStatus(task.id, "finished").status, "finished");
    assert.throws(
      () => store.setTaskStatus(task.id, /** @type {any} */ ("accepted")),
      (err) => /** @type {{ code?: string }} */ (err).code === "invalid_payload",
    );
    store.close();
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
