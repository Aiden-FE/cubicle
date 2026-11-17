import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

test("a fresh store seeds one default company, one project group and eight empty desks", async () => {
  const { dataDir, dispose } = await withTempDir("seed");
  try {
    const store = openStore({ dataDir });
    const snapshot = store.officeSnapshot();
    assert.equal(snapshot.companies.length, 1);
    assert.equal(snapshot.companies[0].name, "默认公司");
    assert.equal(snapshot.groups.length, 1);
    assert.equal(snapshot.groups[0].name, "默认项目组");
    assert.equal(snapshot.desks.length, 8);
    assert.deepEqual(
      snapshot.desks.map((desk) => desk.label),
      ["工位 1", "工位 2", "工位 3", "工位 4", "工位 5", "工位 6", "工位 7", "工位 8"],
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
    assert.equal(desks.length, 8);
    assert.deepEqual(
      desks.map((d) => d.label),
      ["工位 1", "工位 2", "工位 3", "工位 4", "工位 5", "工位 6", "工位 7", "工位 8"],
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

test("createProjectGroup seeds eight empty desks for the new group", async () => {
  const { dataDir, dispose } = await withTempDir("group-desks");
  try {
    const store = openStore({ dataDir });
    const company = store.createCompany({ name: "灯塔组" });
    const group = store.createProjectGroup({ companyId: company.id, name: "编辑器" });
    const desks = store.listDesks({ groupId: group.id });
    assert.equal(desks.length, 8);
    assert.ok(desks.every((desk) => desk.groupId === group.id && desk.occupant === null));
    store.close();
  } finally {
    await dispose();
  }
});

test("reopening a legacy four-desk group heals it to eight without replacing existing desks", async () => {
  const { dataDir, dispose } = await withTempDir("desk-migration");
  try {
    const first = openStore({ dataDir });
    const before = first.officeSnapshot().desks.map((desk) => desk.id);
    first.close();

    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec("DELETE FROM desk WHERE id NOT IN (SELECT id FROM desk ORDER BY id LIMIT 4)");
    raw.close();

    const second = openStore({ dataDir });
    const after = second.officeSnapshot().desks;
    assert.equal(after.length, 8);
    assert.deepEqual(after.slice(0, 4).map((desk) => desk.id), before.slice(0, 4));
    assert.deepEqual(after.map((desk) => desk.label), ["工位 1", "工位 2", "工位 3", "工位 4", "工位 5", "工位 6", "工位 7", "工位 8"]);
    second.close();
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
      [newerGroup.id, newerGroup.id, newerGroup.id, newerGroup.id, newerGroup.id, newerGroup.id, newerGroup.id, newerGroup.id],
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
    assert.equal(/** @type {any} */ (desks[0].occupant).roleSnapshot.roleKey, "programmer");
    assert.equal(/** @type {any} */ (desks[0].occupant).roleName, "程序员");
    assert.ok(
      /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer")).manifest.skills.includes("git 工作流"),
      "技能清单在角色行（投影缓存）上，不在快照里",
    );
    assert.equal(desks[1].occupant, null);
    store.close();

    const reopened = openStore({ dataDir });
    const after = reopened.listDesks({ groupId: group.id });
    assert.equal(/** @type {any} */ (after[0].occupant).name, "小程");
    assert.equal(/** @type {any} */ (after[0].occupant).roleSnapshot.engine, "pi");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("a later role edit never infects an already-hired employee's pins, and the same role can staff another desk", async () => {
  const { dataDir, dispose } = await withTempDir("snapshot");
  try {
    const store = openStore({ dataDir });
    store.syncRoleProjection([
      neoProjection("reviewer", { name: "评审员", skills: [{ name: "checklist", hash: "h1", via: "lock" }] }),
    ]);
    const group = store.officeSnapshot().groups[0];
    const [desk1, desk2] = store.listDesks({ groupId: group.id });
    const reviewer = /** @type {any} */ (store.listRoles().find((r) => r.key === "reviewer"));
    assert.ok(reviewer, "投影角色可招聘");

    const first = store.hireEmployee({ deskId: desk1.id, roleId: reviewer.id });

    // The library moves AFTER hiring (as a Neo refresh would): the second hire
    // pins the NEW skill versions, the first hire keeps what was pinned at his
    // hire — 票 a01 的冻结语义从「复制整份 manifest」变成「钉版本」。
    store.syncRoleProjection([
      neoProjection("reviewer", {
        name: "资深评审员",
        skills: [
          { name: "checklist", hash: "h2", via: "lock" },
          { name: "extra", hash: "h3", via: "lock" },
        ],
      }),
    ]);
    const second = store.hireEmployee({ deskId: desk2.id, roleId: reviewer.id, name: "阿评" });
    assert.equal(second.employee.roleId, reviewer.id);
    assert.notEqual(second.employee.id, first.employee.id);
    assert.deepEqual(/** @type {any} */ (second.employee.roleSnapshot.locks), { checklist: "h2", extra: "h3" });

    const desks = store.listDesks({ groupId: group.id });
    assert.deepEqual(/** @type {any} */ (desks[0].occupant).roleSnapshot.locks, { checklist: "h1" });
    // display names are content: they ride the live role row, both hires follow it
    assert.equal(/** @type {any} */ (desks[0].occupant).roleName, "资深评审员");
    assert.equal(/** @type {any} */ (desks[1].occupant).roleName, "资深评审员");
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
    assert.equal(row.roleSnapshot.engine, "pi");
    // 票 a01: persona 不再进快照；它骑在实时角色行（投影缓存）上。
    assert.ok(row.role.manifest.persona.includes("严谨务实"));
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

test("旧库的 per-engine workspace 迁移到员工共享目录，任务路径跟着走", async () => {
  const { dataDir, dispose } = await withTempDir("workspace-migration");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const oldWorkspace = path.join(dataDir, "engines", "pi", `employee-${employee.id}`, "workspace");
    mkdirSync(oldWorkspace, { recursive: true });
    writeFileSync(path.join(oldWorkspace, "keep.txt"), "workspace files survive the move", "utf8");
    const session = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: oldWorkspace,
    });
    const task = store.createTask({
      groupId: store.officeSnapshot().groups[0].id,
      employeeId: employee.id,
      workspaceDir: oldWorkspace,
      title: "旧任务",
      goal: "旧任务",
      playbook: "free",
      acceptance: [],
      baseHead: "a".repeat(40),
    });
    store.close();

    const reopened = openStore({ dataDir });
    const stable = path.join(dataDir, "workspaces", `employee-${employee.id}`);
    assert.equal(reopened.employeeSessionById(session.id)?.workspaceDir, stable);
    assert.equal(reopened.taskById(task.id)?.workspaceDir, stable, "同一工作区里的旧任务跟着搬家");
    assert.equal(readFileSync(path.join(stable, "keep.txt"), "utf8"), "workspace files survive the move");
    assert.equal(existsSync(oldWorkspace), false, "rename 成功时旧目录不残留");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("beginTaskRun 是事务：被拒的派单不留下 running 任务/悬挂会话，成功路径三行一起落", async () => {
  const { dataDir, dispose } = await withTempDir("begin-task-run");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    const task = makeTask(store, employee);
    const session = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });
    store.setTaskStatus(task.id, "running");

    // running → running is not a legal non-resume transition: roll everything back.
    assert.throws(
      () =>
        store.beginTaskRun({
          taskId: task.id,
          employeeSessionId: session.id,
          engine: "pi",
          prompt: "重复派单",
        }),
      (err) => /** @type {{ code?: string }} */ (err).code === "invalid_transition",
    );
    assert.equal(/** @type {any} */ (store.taskById(task.id)).status, "running");
    assert.equal(store.latestTaskSessionForTask(task.id), null, "被拒的派单没有留下 task_session");
    assert.equal(store.latestRunForEmployee(employee.id), null, "被拒的派单没有留下 run");

    // 09 resume channel: running + resume appends a session and a run atomically.
    const started = store.beginTaskRun({
      taskId: task.id,
      employeeSessionId: session.id,
      engine: "pi",
      prompt: "续跑",
      resume: true,
    });
    assert.equal(started.task.status, "running");
    assert.equal(started.run.taskId, task.id);
    assert.equal(started.run.taskSessionId, started.taskSession.id);

    // A second finish is a contract error, not a silent success with a stale row.
    store.finishRun({ runId: started.run.id, status: "completed" });
    assert.throws(
      () => store.finishRun({ runId: started.run.id, status: "failed" }),
      (err) => /** @type {{ code?: string }} */ (err).code === "run_already_settled",
    );
    store.close();
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

test("skipping states is impossible: 待办 cannot jump to 待验收/完成, 待验收 cannot jump to 失败", async () => {
  const { dataDir, dispose } = await withTempDir("task-skip");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    // 票 10 changed the rejected set: 待办→失败 is now a legal edge (abandoning an
    // interrupted ticket into the failure archive). The service gates that edge to
    // the interrupted shape; the map below still keeps 待办 away from 待验收/完成.
    for (const next of ["review", "done"]) {
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
    // A real pre-09 database has artifacts referencing the run. The old
    // migration fixtures omitted them, which is exactly why the FK failure
    // never showed up in CI.
    store.createArtifact({ taskId: task.id, runId: run.id, kind: "report", content: "迁移前留下的产出" });
    store.close();

    // Rewind to the pre-09 CHECK: neither run nor task_session knows 'paused'.
    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec("PRAGMA foreign_keys = OFF;");
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
    // The artifact (a child of run) survived the rebuild; the old run healed
    // to interrupted as before.
    assert.equal(/** @type {any} */ (reopened.runById(run.id)).status, "interrupted");
    assert.equal(reopened.listArtifacts({ taskId: task.id })[0].content, "迁移前留下的产出");
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

test("pre-ticket-11 employee_session（列上 UNIQUE）带子 run 也能重建，并接受第二个引擎", async () => {
  const { dataDir, dispose } = await withTempDir("employee-session-migration");
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
    const run = store.createRun({ employeeId: employee.id, employeeSessionId: session.id, engine: "pi", prompt: "旧行" });
    store.close();

    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec("PRAGMA foreign_keys = OFF;");
    raw.exec(`
      CREATE TABLE employee_session_pre11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL UNIQUE REFERENCES employee(id),
        engine TEXT NOT NULL,
        agent_dir TEXT NOT NULL,
        sessions_dir TEXT NOT NULL,
        workspace_dir TEXT NOT NULL,
        session_file TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO employee_session_pre11
        SELECT id, employee_id, engine, agent_dir, sessions_dir, workspace_dir, session_file, updated_at FROM employee_session;
      DROP TABLE employee_session;
      ALTER TABLE employee_session_pre11 RENAME TO employee_session;
    `);
    raw.close();

    const reopened = openStore({ dataDir });
    assert.equal(/** @type {any} */ (reopened.runById(run.id)).prompt, "旧行", "子 run 行在父表重建后仍可读");
    const codexSession = reopened.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "codex",
      agentDir: "a2",
      sessionsDir: "s2",
      workspaceDir: "w2",
    });
    assert.notEqual(codexSession.id, session.id, "同一员工可以拥有第二引擎的会话行");
    assert.equal(codexSession.engine, "codex");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("旧库角色 manifest 在一次升级里补齐新工具与 cost，已录用快照不变", async () => {
  const { dataDir, dispose } = await withTempDir("role-seed-upgrade");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    store.close();

    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw.exec(`
      UPDATE role SET manifest = '{"persona":"旧人格","skills":[],"tools":["bash"],"mcpServers":[],"engine":"pi","model":"default"}'
      WHERE key = 'programmer';
      DELETE FROM meta WHERE key = 'role_seed_rev';
    `);
    raw.close();

    const reopened = openStore({ dataDir });
    const programmer = reopened.listRoles().find((role) => role.key === "programmer");
    assert.ok(programmer?.manifest.tools.includes("powershell"), "旧库角色库补上了 ticket 07 的 powershell");
    assert.equal(programmer?.manifest.cost.tokenBudgetPerTask, 500000, "旧库角色库补上了 ticket 12 的 cost");
    const frozen = /** @type {any} */ (reopened.employeeById(employee.id));
    assert.equal(frozen.roleSnapshot.roleKey, "programmer", "已录用员工的钉住身份不随角色库升级而变");
    assert.equal(frozen.roleSnapshot.engine, "pi", "已录用员工的钉住引擎不随角色库升级而变");
    reopened.close();
  } finally {
    await dispose();
  }
});

// — 票 a01: 学院投影缓存 + role_snapshot v2 —

/**
 * A projection shaped exactly like src/host/academy/neo-roles.mjs emits.
 * @param {string} key
 * @param {{ name?: string, tagline?: string, domains?: string[], skills?: { name: string, hash: string, via: "lock" | "dir", sourceType?: string }[], mcp?: { name: string, transport: string }[], persona?: string }} [fixture]
 */
function neoProjection(key, fixture = {}) {
  return {
    key,
    name: fixture.name ?? key,
    tagline: fixture.tagline ?? "",
    domains: fixture.domains ?? [],
    skills: fixture.skills ?? [],
    mcp: fixture.mcp ?? [],
    persona: fixture.persona ?? "",
  };
}

test("Neo 投影落成 source=neo 的角色行：domains / skills+hash / mcp 摘要 / 同步时间", async () => {
  const { dataDir, dispose } = await withTempDir("neo-projection");
  try {
    const store = openStore({ dataDir });
    // 空 ~/.neo：预设三角色照常存在，都标 preset，没有同步时间。
    const presets = store.listRoles();
    assert.equal(presets.length, 3);
    assert.ok(presets.every((role) => role.source === "preset" && role.syncedAt === null));

    store.syncRoleProjection([
      neoProjection("reviewer", {
        name: "评审员",
        tagline: "代码评审",
        domains: ["review"],
        skills: [
          { name: "git-workflow", hash: "a1b2c3", via: "lock", sourceType: "git" },
          { name: "checklist", hash: "d4e5f6", via: "dir" },
        ],
        mcp: [{ name: "github", transport: "stdio" }],
        persona: "苛刻的评审员。",
      }),
    ]);
    const reviewer = store.listRoles().find((role) => role.key === "reviewer");
    assert.ok(reviewer, "Neo 角色出现在投影里");
    assert.equal(reviewer.source, "neo");
    assert.equal(reviewer.name, "评审员");
    assert.deepEqual(reviewer.domains, ["review"]);
    assert.deepEqual(
      reviewer.skills.map((s) => [s.name, s.hash]),
      [
        ["git-workflow", "a1b2c3"],
        ["checklist", "d4e5f6"],
      ],
    );
    assert.deepEqual(reviewer.mcp, [{ name: "github", transport: "stdio" }]);
    assert.equal(typeof reviewer.syncedAt, "string");
    // Neo 角色的 manifest 只带装配兜底（engine/model/cost），persona 来自 AGENTS.md。
    assert.equal(reviewer.manifest.engine, "pi");
    assert.equal(reviewer.manifest.persona, "苛刻的评审员。");

    // 验收：增删技能后，下次刷新（重读）投影反映新集合。
    store.syncRoleProjection([
      neoProjection("reviewer", {
        skills: [{ name: "checklist", hash: "d4e5f6", via: "dir" }],
      }),
    ]);
    const refreshed = store.listRoles().find((role) => role.key === "reviewer");
    assert.ok(refreshed);
    assert.deepEqual(
      refreshed.skills.map((s) => s.name),
      ["checklist"],
    );
    store.close();
  } finally {
    await dispose();
  }
});

test("Neo 同名角色接管预设（source 变 neo）；预设不被 Neo 缺席抹掉", async () => {
  const { dataDir, dispose } = await withTempDir("neo-takeover");
  try {
    const store = openStore({ dataDir });
    store.syncRoleProjection([neoProjection("programmer", { skills: [{ name: "pdf", hash: "ff00", via: "lock" }] })]);
    const roles = store.listRoles();
    assert.equal(roles.length, 3, "同名接管不新增行");
    const programmer = roles.find((r) => r.key === "programmer");
    assert.ok(programmer);
    assert.equal(programmer.source, "neo");
    assert.deepEqual(programmer.skills.map((s) => s.hash), ["ff00"]);

    // Neo 里删掉 programmer：没有员工引用的投影行被清掉；预设们仍在。
    store.syncRoleProjection([]);
    const after = store.listRoles();
    const restored = after.find((r) => r.key === "programmer");
    assert.ok(restored, "同名回到 preset 兜底（行还在，source 回 preset）");
    assert.equal(restored.source, "preset");
    store.close();
  } finally {
    await dispose();
  }
});

test("Neo 删除的角色：被员工引用的投影行保留，没人引用的投影行删除", async () => {
  const { dataDir, dispose } = await withTempDir("neo-drop");
  try {
    const store = openStore({ dataDir });
    store.syncRoleProjection([neoProjection("archivist", { skills: [{ name: "docs", hash: "aa", via: "lock" }] })]);
    const archivist = store.listRoles().find((r) => r.key === "archivist");
    assert.ok(archivist);
    const group = store.officeSnapshot().groups[0];
    const [desk] = store.listDesks({ groupId: group.id });
    store.hireEmployee({ deskId: desk.id, roleId: archivist.id, name: "档案员" });

    store.syncRoleProjection([]);
    const roles = store.listRoles();
    assert.ok(roles.find((r) => r.key === "archivist"), "有员工引用的角色行不被投影删除抹掉");

    store.syncRoleProjection([neoProjection("temp")]);
    assert.ok(store.listRoles().find((r) => r.key === "temp"));
    store.syncRoleProjection([]);
    assert.ok(!store.listRoles().find((r) => r.key === "temp"), "没人引用的 Neo 角色随刷新移出");
    store.close();
  } finally {
    await dispose();
  }
});

test("role_snapshot 落新结构：只有 roleKey / domains / locks / engine / model / cost，没有技能正文", async () => {
  const { dataDir, dispose } = await withTempDir("snapshot-v2");
  try {
    const store = openStore({ dataDir });
    const group = store.officeSnapshot().groups[0];
    const [desk] = store.listDesks({ groupId: group.id });
    const programmer = store.listRoles().find((r) => r.key === "programmer");
    assert.ok(programmer);

    const hire = store.hireEmployee({
      deskId: desk.id,
      roleId: programmer.id,
      name: "小程",
      engine: "pi",
      provider: "acme",
      model: "m1",
      reasoningEffort: "low",
    });
    const snapshot = /** @type {any} */ (hire.employee.roleSnapshot);
    assert.equal(snapshot.roleKey, "programmer");
    assert.deepEqual(snapshot.domains, []);
    assert.deepEqual(snapshot.locks, {});
    assert.equal(snapshot.engine, "pi");
    assert.equal(snapshot.model, "m1");
    assert.equal(snapshot.provider, "acme");
    assert.equal(snapshot.reasoningEffort, "low");
    assert.equal(snapshot.cost.tokenBudgetPerTask, 500000);
    // 旧字段不再存在：整份 manifest / persona / tagline 都不进快照。
    assert.equal(snapshot.manifest, undefined);
    assert.equal(snapshot.persona, undefined);
    assert.equal(snapshot.key, undefined);

    // 落库的 JSON 字段齐全且没有 manifest 包装。
    const raw = new DatabaseSync(store.dbPath);
    const stored = /** @type {any} */ (raw.prepare("SELECT role_snapshot FROM employee WHERE id = ?").get(hire.employee.id));
    raw.close();
    const parsed = JSON.parse(stored.role_snapshot);
    assert.equal(parsed.roleKey, "programmer");
    assert.equal(parsed.manifest, undefined);
    store.close();
  } finally {
    await dispose();
  }
});

test("招 Neo 投影角色时把 locks 钉成 技能名 → sha，不含正文", async () => {
  const { dataDir, dispose } = await withTempDir("snapshot-locks");
  try {
    const store = openStore({ dataDir });
    store.syncRoleProjection([
      neoProjection("reviewer", {
        skills: [
          { name: "git-workflow", hash: "a1b2c3", via: "lock" },
          { name: "secret-skill", hash: "9f8e7d", via: "dir" },
        ],
      }),
    ]);
    const reviewer = store.listRoles().find((r) => r.key === "reviewer");
    assert.ok(reviewer);
    const group = store.officeSnapshot().groups[0];
    const [desk] = store.listDesks({ groupId: group.id });
    const hire = store.hireEmployee({ deskId: desk.id, roleId: reviewer.id, name: "评审" });
    const snapshot = /** @type {any} */ (hire.employee.roleSnapshot);
    assert.deepEqual(snapshot.locks, { "git-workflow": "a1b2c3", "secret-skill": "9f8e7d" });
    assert.deepEqual(snapshot.domains, []);
    // 「只钉版本，不复制内容」：快照里没有 persona / 技能正文可抄。
    assert.equal(JSON.stringify(snapshot).includes("苛刻"), false);
    store.close();
  } finally {
    await dispose();
  }
});

test("旧库 role_snapshot（整份 manifest）在一次打开里升级为 v2，engine/model/cost 保留", async () => {
  const { dataDir, dispose } = await withTempDir("snapshot-migrate");
  try {
    const store = openStore({ dataDir });
    const employee = hireProgrammer(store);
    store.close();

    // 手写一份 票 14 时代的旧结构快照（manifest 包 + key/name/tagline）。
    const raw = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    raw
      .prepare("UPDATE employee SET role_snapshot = ? WHERE id = ?")
      .run(
        JSON.stringify({
          key: "programmer",
          name: "程序员",
          tagline: "旧标语",
          manifest: {
            persona: "旧人格",
            skills: ["git 工作流"],
            tools: ["read"],
            mcpServers: [],
            engine: "codex",
            model: "gpt-old",
            provider: "legacy",
            reasoningEffort: "high",
            cost: { tokenBudgetPerTask: 123456 },
          },
        }),
        employee.id,
      );
    raw.close();

    const reopened = openStore({ dataDir });
    const migrated = /** @type {any} */ (reopened.employeeById(employee.id));
    assert.equal(migrated.roleSnapshot.roleKey, "programmer");
    assert.equal(migrated.roleSnapshot.engine, "codex");
    assert.equal(migrated.roleSnapshot.model, "gpt-old");
    assert.equal(migrated.roleSnapshot.provider, "legacy");
    assert.equal(migrated.roleSnapshot.reasoningEffort, "high");
    assert.equal(migrated.roleSnapshot.cost.tokenBudgetPerTask, 123456);
    assert.deepEqual(migrated.roleSnapshot.locks, {}, "旧快照没有 hash 可钉，locks 留空而不是造 hash");
    assert.equal(migrated.roleSnapshot.manifest, undefined);

    // 升级是落库的，不是每次读现场换算：重开后库里已是 v2。
    const raw2 = new DatabaseSync(path.join(dataDir, "cubicle.db"));
    const stored = /** @type {any} */ (raw2.prepare("SELECT role_snapshot FROM employee WHERE id = ?").get(employee.id));
    raw2.close();
    assert.equal(JSON.parse(stored.role_snapshot).roleKey, "programmer");
    reopened.close();
  } finally {
    await dispose();
  }
});

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

// — 票 10 崩溃恢复：转移表唯一新增边 + 「中断的任务」列表 —

/**
 * Hire a programmer onto the given desk (the default group has four).
 * @param {ReturnType<typeof openStore>} store
 * @param {number} deskIndex
 * @param {string} name
 */
function hireAtDesk(store, deskIndex, name) {
  const group = store.officeSnapshot().groups[0];
  const desk = store.listDesks({ groupId: group.id })[deskIndex];
  const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));
  return store.hireEmployee({ deskId: desk.id, roleId: programmer.id, name }).employee;
}

test("票 10 放弃边：open → failed 是崩溃恢复给转移表加的唯一新边（待办→待验收/完成仍不可跳）", async () => {
  const { dataDir, dispose } = await withTempDir("task-abandon-edge");
  try {
    const store = openStore({ dataDir });
    const task = makeTask(store, hireProgrammer(store));
    // 放弃一张中断过的待办工单 → 失败归档。这是票 10 唯一放宽的边；合法性由
    // service 限定「中断形状」才可用，转移表本身仍堵死 待办→待验收/完成。
    assert.equal(store.setTaskStatus(task.id, "failed").status, "failed");
    for (const next of ["review", "done"]) {
      assert.throws(
        () => store.setTaskStatus(task.id, /** @type {any} */ (next)),
        (err) => /** @type {{ code?: string }} */ (err).code === "invalid_transition",
        `failed → ${next} must be rejected except retry`,
      );
    }
    // 失败非终态：06 的重试出口原样保留（failed → running）。
    assert.equal(store.setTaskStatus(task.id, "running").status, "running");
    store.close();
  } finally {
    await dispose();
  }
});

test("票 10 中断列表：开库自愈后列出两种形状的 interrupted 任务，带引擎/恢复指针/迭代数", async () => {
  const { dataDir, dispose } = await withTempDir("interrupted-list");
  try {
    const store = openStore({ dataDir });
    const companyId = store.officeSnapshot().activeCompanyId;

    // 形状 A：从没暂停过、崩溃时被派单进行中 → 自愈落回 待办 + interrupted 会话。
    const employeeA = hireAtDesk(store, 0, "甲");
    const taskA = makeTask(store, employeeA);
    store.setTaskStatus(taskA.id, "running");
    const sessionA = store.getOrCreateEmployeeSession({
      employeeId: employeeA.id,
      engine: "pi",
      agentDir: "a",
      sessionsDir: "s",
      workspaceDir: "w",
    });
    store.setEmployeeSessionFile({ employeeSessionId: sessionA.id, sessionFile: "C:/fake/sess-a.jsonl" });
    const tsA = store.openTaskSession({ taskId: taskA.id, employeeSessionId: sessionA.id, engine: "pi" });
    store.createRun({
      employeeId: employeeA.id,
      employeeSessionId: sessionA.id,
      engine: "pi",
      prompt: "慢活",
      taskId: taskA.id,
      taskSessionId: tsA.id,
    });

    // 形状 B：下班暂停后上班续跑、续跑中崩溃 → 任务留在 进行中 + 最近一轮 interrupted。
    const employeeB = hireAtDesk(store, 1, "乙");
    const taskB = makeTask(store, employeeB);
    store.setTaskStatus(taskB.id, "running");
    const sessionB = store.getOrCreateEmployeeSession({
      employeeId: employeeB.id,
      engine: "codex",
      agentDir: "a2",
      sessionsDir: "s2",
      workspaceDir: "w2",
    });
    store.setEmployeeSessionFile({ employeeSessionId: sessionB.id, sessionFile: "thread:th-42" });
    const tsB1 = store.openTaskSession({ taskId: taskB.id, employeeSessionId: sessionB.id, engine: "codex" });
    store.finishTaskSession({ taskSessionId: tsB1.id, status: "paused" });
    const tsB2 = store.openTaskSession({ taskId: taskB.id, employeeSessionId: sessionB.id, engine: "codex" });
    store.createRun({
      employeeId: employeeB.id,
      employeeSessionId: sessionB.id,
      engine: "codex",
      prompt: "慢活",
      taskId: taskB.id,
      taskSessionId: tsB2.id,
    });

    // 对照：待验收（completed 收尾）与从没派过单的待办，都不进中断列表。
    const employeeC = hireAtDesk(store, 2, "丙");
    const taskC = makeTask(store, employeeC);
    store.setTaskStatus(taskC.id, "running");
    const sessionC = store.getOrCreateEmployeeSession({
      employeeId: employeeC.id,
      engine: "pi",
      agentDir: "a3",
      sessionsDir: "s3",
      workspaceDir: "w3",
    });
    const tsC = store.openTaskSession({ taskId: taskC.id, employeeSessionId: sessionC.id, engine: "pi" });
    store.finishTaskSession({ taskSessionId: tsC.id, status: "completed" });
    store.setTaskStatus(taskC.id, "review");
    const taskFresh = makeTask(store, hireAtDesk(store, 3, "丁"));

    store.close();
    const reopened = openStore({ dataDir });

    const rows = /** @type {any[]} */ (reopened.listInterruptedTasks({ companyId }));
    assert.deepEqual(rows.map((r) => r.id), [taskB.id, taskA.id], "最新在前；待验收/待办无会话的不算中断");
    assert.equal(rows[0].status, "running", "续跑后崩溃的形状停在「进行中」");
    assert.equal(rows[0].latestSessionStatus, "interrupted");
    assert.equal(rows[0].engine, "codex");
    assert.equal(rows[0].sessionFile, "thread:th-42", "恢复指针随行携带，service 据此判 canResume");
    assert.equal(rows[0].iterations, 2);
    assert.notEqual(rows[0].interruptedAt, null);
    assert.equal(rows[0].employeeName, "乙");
    assert.equal(rows[1].status, "open", "从没暂停过、崩溃回待办的形状");
    assert.equal(rows[1].engine, "pi");
    assert.equal(rows[1].sessionFile, "C:/fake/sess-a.jsonl");
    assert.equal(rows[1].iterations, 1);

    // 别的公司（不存在/没派过单）查不到这张公司的中断任务。
    assert.deepEqual(reopened.listInterruptedTasks({ companyId: companyId + 100 }), []);

    reopened.close();
  } finally {
    await dispose();
  }
});

// — 票 a03: 学院来源标记（academy_mark）—

test("academy marks: upsert/list/get round-trip; ack survives re-install upserts", async () => {
  const { dataDir, dispose } = await withTempDir("academy-marks");
  try {
    const store = openStore({ dataDir });

    store.upsertAcademyMark({ resourceKey: "d:demo", kind: "remote", source: "https://github.com/acme/skills" });
    store.upsertAcademyMark({ resourceKey: "d:web/skill-x", kind: "local", source: "C:\\dev\\src" });

    const got = store.getAcademyMark("d:demo");
    assert.ok(got);
    assert.equal(got.kind, "remote");
    assert.equal(got.source, "https://github.com/acme/skills");
    assert.equal(got.remoteAck, false);
    assert.equal(store.getAcademyMark("d:nope"), null);

    // 首次下发确认 → ack 落库；之后重装同一容器 upsert 不抹掉 ack 与 kind。
    store.ackAcademyRemote("d:demo");
    store.upsertAcademyMark({ resourceKey: "d:demo", kind: "remote", source: "https://github.com/acme/skills-v2" });
    const acked = store.getAcademyMark("d:demo");
    assert.ok(acked);
    assert.equal(acked.remoteAck, true);
    assert.equal(acked.source, "https://github.com/acme/skills-v2", "重装更新 source 字符串");

    const listed = store.listAcademyMarks();
    assert.deepEqual(listed.map((m) => m.resourceKey), ["d:demo", "d:web/skill-x"]);
    assert.ok(listed[0]);
    assert.equal(listed[0].updatedAt.length > 0, true);

    store.close();
    const reopened = openStore({ dataDir });
    const persisted = reopened.getAcademyMark("d:demo");
    assert.ok(persisted);
    assert.equal(persisted.remoteAck, true, "标记跨重启持久（验收：来源标记持久化）");
    reopened.close();
  } finally {
    await dispose();
  }
});

test("academy marks: ack on an unknown key creates the row (kind remote), bad kind refused", async () => {
  const { dataDir, dispose } = await withTempDir("academy-marks-ack");
  try {
    const store = openStore({ dataDir });
    store.ackAcademyRemote("r:dev");
    const row = store.getAcademyMark("r:dev");
    assert.ok(row);
    assert.equal(row.kind, "remote");
    assert.equal(row.remoteAck, true);
    assert.throws(
      () => store.upsertAcademyMark({ resourceKey: "x", kind: /** @type {"local" | "remote" | "written"} */ ("weird"), source: null }),
      /invalid_academy_mark|CHECK/,
    );
    store.close();
  } finally {
    await dispose();
  }
});
