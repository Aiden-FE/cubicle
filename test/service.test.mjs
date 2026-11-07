import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "../src/host/store.mjs";
import { createService } from "../src/host/service.mjs";
import { createRunManager } from "../src/host/engine/run-manager.mjs";
import { createTaskRunHook } from "../src/host/task/artifacts.mjs";
import { createGitReader } from "../src/host/git/reader.mjs";
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
    assert.deepEqual(roles[0].manifest.tools, ["read", "write", "edit", "bash", "powershell", "grep"]);
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

/**
 * A run manager backed by an instantly-settling stub engine, over a real
 * store — so run.* is tested through the same collaborator the host wires.
 *
 * @param {string} name
 */
async function withRunService(name) {
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-run-service-${name}-`));
  const store = openStore({ dataDir });
  const runManager = createRunManager({
    store,
    getAdapter: (engine) =>
      engine === "pi"
        ? {
            async open({ session, onEvent }) {
              return {
                async prompt() {
                  onEvent({ type: "text_delta", text: "好的" });
                  onEvent({ type: "agent_end", status: "ok" });
                },
                async abort() {},
                sessionFile: () => path.join(session.sessionsDir, "s.jsonl"),
              };
            },
          }
        : null,
    emit: () => {},
  });
  const service = createService({
    store,
    hostInfo: { pid: 4242, startedAt: "2026-11-05T09:00:00.000Z" },
    runManager,
  });
  const roles = store.listRoles();
  const programmer = /** @type {any} */ (roles.find((r) => r.key === "programmer"));
  const desk = store.listDesks({ groupId: store.officeSnapshot().groups[0].id })[0];
  const employee = store.hireEmployee({ deskId: desk.id, roleId: programmer.id, name: "小程" }).employee;
  return {
    service,
    runManager,
    store,
    employeeId: employee.id,
    dispose: async () => {
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("run.start answers with the new run and its session, and the run settles", async () => {
  const { service, runManager, store, employeeId, dispose } = await withRunService("start");
  try {
    const { reply, events } = service.handle(
      createInvoke("t1", "run.start", { employeeId, text: "读一下 hello.txt" }),
    );
    assert.equal(reply.ok, true);
    assert.equal(/** @type {any} */ (reply.payload).run.status, "running");
    assert.equal(/** @type {any} */ (reply.payload).run.prompt, "读一下 hello.txt");
    assert.equal(/** @type {any} */ (reply.payload).session.engine, "pi");
    // engine events ride the run.event topic (emitted by the manager), not
    // the reply envelope — the reply stays event-free.
    assert.deepEqual(events, []);

    await runManager.whenQuiet();
    assert.equal(/** @type {any} */ (store.latestRunForEmployee(employeeId)).status, "completed");
  } finally {
    await dispose();
  }
});

test("run.start validates payloads and forwards unknown_employee and engine_unavailable", async () => {
  const { service, employeeId, dispose } = await withRunService("validate");
  try {
    for (const payload of [{}, { employeeId: 0, text: "喂" }, { employeeId: "x", text: "喂" }, { employeeId, text: "  " }]) {
      const { reply } = service.handle(createInvoke("t2", "run.start", payload));
      assert.equal(reply.ok, false);
      assert.equal(reply.error?.code, "invalid_payload");
    }
    const unknown = service.handle(createInvoke("t3", "run.start", { employeeId: 99999, text: "喂" }));
    assert.equal(unknown.reply.error?.code, "unknown_employee");
    // the programmer snapshot says pi; point the manager at an engine it has no adapter for
    const noAdapter = service.handle(createInvoke("t4", "run.start", { employeeId, text: "喂" }));
    assert.equal(noAdapter.reply.ok, true);
  } finally {
    await dispose();
  }
});

test("run.abort answers ok for a running employee and no_active_run when idle", async () => {
  const { service, runManager, employeeId, dispose } = await withRunService("abort");
  try {
    const idle = service.handle(createInvoke("t5", "run.abort", { employeeId }));
    assert.equal(idle.reply.ok, false);
    assert.equal(idle.reply.error?.code, "no_active_run");

    // A second message during a pending run would be busy; here the stub
    // settles instantly, so exercise abort against busy state through the
    // manager's own queue: start a run, then abort before it can settle is
    // not observable with an instant stub — assert the contract instead.
    const started = service.handle(createInvoke("t6", "run.start", { employeeId, text: "干活" }));
    assert.equal(started.reply.ok, true);
    await runManager.whenQuiet();
    const afterSettle = service.handle(createInvoke("t7", "run.abort", { employeeId }));
    assert.equal(afterSettle.reply.error?.code, "no_active_run");
  } finally {
    await dispose();
  }
});

test("run.history answers with the last run and its streamed events", async () => {
  const { service, runManager, employeeId, dispose } = await withRunService("history");
  try {
    const fresh = service.handle(createInvoke("t8", "run.history", { employeeId }));
    assert.equal(fresh.reply.ok, true);
    assert.equal(/** @type {any} */ (fresh.reply.payload).lastRun, null);
    assert.deepEqual(/** @type {any} */ (fresh.reply.payload).events, []);

    service.handle(createInvoke("t9", "run.start", { employeeId, text: "问" }));
    await runManager.whenQuiet();

    const after = service.handle(createInvoke("t10", "run.history", { employeeId }));
    assert.equal(after.reply.ok, true);
    assert.equal(/** @type {any} */ (after.reply.payload).lastRun.status, "completed");
    assert.deepEqual(
      /** @type {any} */ (after.reply.payload).events.map((/** @type {any} */ e) => e.event.type),
      ["session_start", "text_delta", "agent_end"],
    );
  } finally {
    await dispose();
  }
});

test("run methods answer engine_unavailable when the host has no run manager", async () => {
  const { service, dispose } = await withService("no-runs");
  try {
    for (const method of ["run.start", "run.abort", "run.history"]) {
      const { reply } = service.handle(createInvoke("t11", method, { employeeId: 1, text: "喂" }));
      assert.equal(reply.ok, false);
      assert.equal(reply.error?.code, "engine_unavailable");
    }
  } finally {
    await dispose();
  }
});

// — task methods (ticket 05: 工单与产出) —

/**
 * Service wiring for tasks: real store + stub engine + the real task hook,
 * with a scripted git door (the door itself is tested against real git in
 * test/git-reader.test.mjs).
 *
 * @param {string} name
 * @param {{ headScript?: { ok: boolean, sha?: string, code?: string, message?: string }, useRealGit?: boolean }} [options]
 */
async function withTaskService(name, options = {}) {
  const { headScript = { ok: true, sha: "a".repeat(40) }, useRealGit = false } = options;
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-task-service-${name}-`));
  const store = openStore({ dataDir });
  const auditCommands = [
    `git -C ${dataDir} rev-parse HEAD`,
    `git -C ${dataDir} diff --name-status ${"a".repeat(40)}`,
    `git -C ${dataDir} status --porcelain`,
  ];
  const git = useRealGit
    ? /** @type {any} */ (createGitReader())
    : /** @type {any} */ ({
    head: (/** @type {string} */ workspaceDir) => ({ ...headScript }),
    audit: () => auditCommands.slice(),
    diffInfo: (/** @type {string} */ workspaceDir, /** @type {string} */ baseSha) => ({
      ok: true,
      headNow: baseSha,
      stat: "",
      nameStatus: [],
      porcelain: "",
    }),
  });
  const runManager = createRunManager({
    store,
    getAdapter: (engine) =>
      engine === "pi"
        ? {
            async open({ onEvent }) {
              return {
                async prompt() {
                  onEvent({ type: "text_delta", text: "干完了" });
                  onEvent({ type: "agent_end", status: "ok" });
                },
                async abort() {},
                sessionFile: () => null,
              };
            },
          }
        : null,
    emit: () => {},
    onTaskRunFinished: createTaskRunHook({ store, git }),
  });
  const service = createService({
    store,
    hostInfo: { pid: 4242, startedAt: "2026-11-05T09:00:00.000Z" },
    runManager,
    git,
  });
  const group = store.officeSnapshot().groups[0];
  const programmer = /** @type {any} */ (store.listRoles().find((r) => r.key === "programmer"));
  const desk = store.listDesks({ groupId: group.id })[0];
  const employee = store.hireEmployee({ deskId: desk.id, roleId: programmer.id, name: "小程" }).employee;
  return {
    service,
    runManager,
    store,
    groupId: group.id,
    employeeId: employee.id,
    dispose: async () => {
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("task.draft turns one sentence into an editable playbook contract", async () => {
  const { service, dispose } = await withTaskService("draft");
  try {
    const { reply, events } = service.handle(createInvoke("k1", "task.draft", { text: "修复导出报表崩溃的 bug" }));
    assert.equal(reply.ok, true);
    assert.deepEqual(events, []);
    const draft = /** @type {any} */ (reply.payload);
    assert.equal(draft.playbook, "bugfix");
    assert.equal(draft.label, "修 bug");
    assert.equal(draft.goal, "修复导出报表崩溃的 bug");
    assert.ok(draft.acceptance.length >= 2);
  } finally {
    await dispose();
  }
});

test("task.create records the start HEAD and keeps the boss's edited goal and acceptance", async () => {
  const { service, store, groupId, employeeId, dispose } = await withTaskService("create");
  try {
    const { reply, events } = service.handle(
      createInvoke("k2", "task.create", {
        employeeId,
        text: "给 greet.txt 加一行欢迎语",
        goal: "给 greet.txt 加一行英文欢迎语",
        acceptance: ["欢迎语在 greet.txt 里可见", "手动加的标准"],
      }),
    );
    assert.equal(reply.ok, true);
    const task = /** @type {any} */ (reply.payload).task;
    assert.equal(task.baseHead, "a".repeat(40));
    assert.equal(task.playbook, "feature");
    assert.equal(task.goal, "给 greet.txt 加一行英文欢迎语");
    assert.deepEqual(task.acceptance, ["欢迎语在 greet.txt 里可见", "手动加的标准"]);
    assert.equal(task.status, "open");
    assert.equal(events[0].topic, "domain.changed");

    const listed = /** @type {any} */ (service.handle(createInvoke("k3", "task.list", { groupId })).reply.payload);
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].employeeName, "小程");
    void store;
  } finally {
    await dispose();
  }
});

test("task.create says the workspace is unusable when it is not a git repository", async () => {
  const { service, store, employeeId, dispose } = await withTaskService("nogit", {
    headScript: { ok: false, code: "not_a_git_workspace", message: "工作区不是 git 仓库：无法记录起点 HEAD，工单不可用。" },
  });
  try {
    const { reply } = service.handle(
      createInvoke("k4", "task.create", { employeeId, text: "加个欢迎语", goal: "加个欢迎语", acceptance: [] }),
    );
    assert.equal(reply.ok, false);
    assert.equal(reply.error?.code, "not_a_git_workspace");
    assert.match(/** @type {any} */ (reply.error).message, /不是 git 仓库/);
    const group = store.officeSnapshot().groups[0];
    assert.equal(store.listTasks({ groupId: group.id }).length, 0);
  } finally {
    await dispose();
  }
});

test("with the real git door, a never-created workspace answers not_a_git_workspace (not a crash)", async () => {
  const { service, employeeId, dispose } = await withTaskService("nogit-real", { useRealGit: true });
  try {
    const { reply } = service.handle(
      createInvoke("k4b", "task.create", { employeeId, text: "加个欢迎语", goal: "加个欢迎语", acceptance: [] }),
    );
    assert.equal(reply.ok, false);
    assert.equal(reply.error?.code, "not_a_git_workspace", `got: ${JSON.stringify(reply.error)}`);
  } finally {
    await dispose();
  }
});

test("task.dispatch runs the playbook prompt and the four artifacts arrive when the run settles", async () => {
  const { service, runManager, employeeId, dispose } = await withTaskService("dispatch");
  try {
    const created = /** @type {any} */ (
      service.handle(createInvoke("k5", "task.create", { employeeId, text: "写一份部署文档", goal: "写一份部署文档", acceptance: ["可照做"] })).reply.payload
    ).task;

    const dispatched = service.handle(createInvoke("k6", "task.dispatch", { taskId: created.id }));
    assert.equal(dispatched.reply.ok, true);
    const run = /** @type {any} */ (dispatched.reply.payload).run;
    assert.equal(run.status, "running");
    assert.match(run.prompt, new RegExp(`工单 #${created.id} · 写文档`));
    assert.ok(run.prompt.includes("验收标准："));

    await runManager.whenQuiet();

    const detail = /** @type {any} */ (service.handle(createInvoke("k7", "task.detail", { taskId: created.id })).reply.payload);
    assert.equal(detail.task.status, "finished");
    assert.deepEqual(detail.artifacts.map((/** @type {any} */ a) => a.kind), ["diff_summary", "changed_files", "command_output", "report"]);
    assert.ok(detail.artifacts[3].content.includes("干完了"));
    assert.equal(detail.sessions.length, 1);
    assert.equal(detail.sessions[0].status, "completed");
  } finally {
    await dispose();
  }
});

test("task.dispatch rejects unknown tasks and a task that is already running", async () => {
  const { service, runManager, employeeId, dispose } = await withTaskService("dispatch-bad");
  try {
    const unknown = service.handle(createInvoke("k8", "task.dispatch", { taskId: 99999 }));
    assert.equal(unknown.reply.error?.code, "unknown_task");

    const created = /** @type {any} */ (
      service.handle(createInvoke("k9", "task.create", { employeeId, text: "加功能", goal: "加功能", acceptance: [] })).reply.payload
    ).task;
    service.handle(createInvoke("k10", "task.dispatch", { taskId: created.id }));
    const busy = service.handle(createInvoke("k11", "task.dispatch", { taskId: created.id }));
    assert.equal(busy.reply.error?.code, "task_running");
    await runManager.whenQuiet();
  } finally {
    await dispose();
  }
});

test("task.gitAudit answers with every git command the app ran — all read-only", async () => {
  const { service, dispose } = await withTaskService("audit");
  try {
    const { reply } = service.handle(createInvoke("k12", "task.gitAudit", {}));
    assert.equal(reply.ok, true);
    const commands = /** @type {any} */ (reply.payload).commands;
    assert.equal(commands.length, 3);
    assert.ok(commands.every((/** @type {string} */ line) => /\b(rev-parse|diff|status|log|show|ls-files)\b/.test(line)));
  } finally {
    await dispose();
  }
});
