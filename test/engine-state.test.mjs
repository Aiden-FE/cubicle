import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openStore } from "../src/host/store.mjs";

function tempStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cubicle-engine-"));
  const store = openStore({ dataDir: dir });
  return { store, dir };
}

/** @param {ReturnType<typeof openStore>} store */
function firstDeskWithEmployee(store) {
  const snapshot = store.officeSnapshot();
  const desk = snapshot.desks[0];
  const roles = store.listRoles();
  const { employee } = store.hireEmployee({ deskId: desk.id, roleId: roles[0].id, name: "引擎切换员" });
  return employee;
}

test("factory engine states: pi ships enabled, codex starts unadmitted", () => {
  const { store, dir } = tempStore();
  try {
    const states = new Map(store.listEngineStates().map((s) => [s.engine, s]));
    assert.ok(states.has("pi"));
    assert.ok(states.has("codex"));
    assert.equal(/** @type {any} */ (states.get("pi")).enabled, true);
    assert.equal(/** @type {any} */ (states.get("codex")).enabled, false);
    assert.equal(/** @type {any} */ (states.get("codex")).probeStatus, "unprobed");
    assert.equal(/** @type {any} */ (states.get("codex")).manualOverride, false);
    assert.equal(/** @type {any} */ (states.get("pi")).installed, true); // bundled SDK
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detection marks codex installed with its version", () => {
  const { store, dir } = tempStore();
  try {
    store.setEngineInstalled({ engine: "codex", installed: true, version: "codex-cli 0.163.0" });
    const state = /** @type {any} */ (store.engineState("codex"));
    assert.equal(state.installed, true);
    assert.equal(state.version, "codex-cli 0.163.0");
    assert.equal(state.enabled, false); // detection alone does not admit
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a passed probe admits the engine and clears any risk override", () => {
  const { store, dir } = tempStore();
  try {
    store.setEngineEnabled({ engine: "codex", enabled: true, manualOverride: true });
    store.setEngineProbeResult({
      engine: "codex",
      status: "passed",
      probe: {
        verdicts: {
          injection: { result: "pass", detail: "marker echoed" },
          tools: { result: "pass", detail: "1 tool pair" },
          refusal: { result: "pass", detail: "policy_blocked seen" },
          events: { result: "pass", detail: "terminal agent_end" },
        },
        ranAt: new Date().toISOString(),
      },
    });
    const state = /** @type {any} */ (store.engineState("codex"));
    assert.equal(state.probeStatus, "passed");
    assert.equal(state.enabled, true);
    assert.equal(state.manualOverride, false);
    assert.equal(state.probe.verdicts.refusal.result, "pass");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed probe does not admit; manual enable keeps the risk flag", () => {
  const { store, dir } = tempStore();
  try {
    store.setEngineProbeResult({
      engine: "codex",
      status: "failed",
      probe: { verdicts: { injection: { result: "fail", detail: "no marker" } } },
    });
    assert.equal(/** @type {any} */ (store.engineState("codex")).enabled, false);

    store.setEngineEnabled({ engine: "codex", enabled: true, manualOverride: true });
    const state = /** @type {any} */ (store.engineState("codex"));
    assert.equal(state.enabled, true);
    assert.equal(state.manualOverride, true);
    assert.equal(state.probeStatus, "failed"); // the failure is still on the card
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("switching an employee's engine rewrites the frozen role snapshot", () => {
  const { store, dir } = tempStore();
  try {
    const employee = firstDeskWithEmployee(store);
    assert.equal(employee.roleSnapshot.manifest.engine, "pi");

    const updated = /** @type {any} */ (store.setEmployeeEngine({ employeeId: employee.id, engine: "codex" }));
    assert.equal(updated.roleSnapshot.manifest.engine, "codex");
    // the rest of the frozen snapshot survives the rewrite
    assert.equal(updated.roleSnapshot.manifest.persona, employee.roleSnapshot.manifest.persona);
    assert.deepEqual(updated.roleSnapshot.manifest.tools, employee.roleSnapshot.manifest.tools);
    assert.equal(/** @type {any} */ (store.employeeById(employee.id)).roleSnapshot.manifest.engine, "codex");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("employee sessions are per employee × engine; resume pointers stay independent", () => {
  const { store, dir } = tempStore();
  try {
    const employee = firstDeskWithEmployee(store);
    const piSession = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "/x/pi/agent",
      sessionsDir: "/x/pi/sessions",
      workspaceDir: "/x/pi/workspace",
    });
    store.setEmployeeSessionFile({ employeeSessionId: piSession.id, sessionFile: "/x/pi/sessions/a.jsonl" });

    const codexSession = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "codex",
      agentDir: "/x/codex/agent",
      sessionsDir: "/x/codex/sessions",
      workspaceDir: "/x/codex/workspace",
    });
    assert.notEqual(codexSession.id, piSession.id);

    const piAgain = store.getOrCreateEmployeeSession({
      employeeId: employee.id,
      engine: "pi",
      agentDir: "/ignored",
      sessionsDir: "/ignored",
      workspaceDir: "/ignored",
    });
    assert.equal(piAgain.id, piSession.id);
    assert.equal(piAgain.sessionFile, "/x/pi/sessions/a.jsonl");
    assert.equal(codexSession.sessionFile, null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pre-ticket-11 database (one session per employee) migrates without losing rows", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cubicle-migrate-"));
  try {
    // Recreate the 04-era schema by hand: employee_id carries the UNIQUE.
    const db = new DatabaseSync(path.join(dir, "cubicle.db"));
    db.exec(`
      CREATE TABLE employee (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, role_id INTEGER, role_snapshot TEXT, hired_at TEXT);
      CREATE TABLE employee_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL UNIQUE REFERENCES employee(id),
        engine TEXT NOT NULL,
        agent_dir TEXT NOT NULL,
        sessions_dir TEXT NOT NULL,
        workspace_dir TEXT NOT NULL,
        session_file TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO employee (id, company_id, name, role_id, role_snapshot, hired_at)
        VALUES (1, 1, '老员工', 1, '{"key":"programmer","name":"程序员","tagline":"","manifest":{"engine":"pi"}}', '2026-11-06T00:00:00Z');
      INSERT INTO employee_session (id, employee_id, engine, agent_dir, sessions_dir, workspace_dir, session_file, updated_at)
        VALUES (7, 1, 'pi', '/old/agent', '/old/sessions', '/old/workspace', '/old/sessions/keep.jsonl', '2026-11-06T00:00:00Z');
    `);
    db.close();

    const store = openStore({ dataDir: dir });
    try {
      const session = store.employeeSessionById(7);
      assert.ok(session, "the old row survives the rebuild");
      assert.equal(session.sessionFile, "/old/sessions/keep.jsonl");

      const codexSession = store.getOrCreateEmployeeSession({
        employeeId: 1,
        engine: "codex",
        agentDir: "/new/agent",
        sessionsDir: "/new/sessions",
        workspaceDir: "/new/workspace",
      });
      assert.notEqual(codexSession.id, 7);
      // and the old UNIQUE is gone: same employee, second session rows coexist
      const piAgain = store.getOrCreateEmployeeSession({
        employeeId: 1,
        engine: "pi",
        agentDir: "/x",
        sessionsDir: "/x",
        workspaceDir: "/x",
      });
      assert.equal(piAgain.id, 7);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
