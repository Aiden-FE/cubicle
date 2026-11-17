/**
 * AgentHost persistence: the application's single SQLite writer.
 *
 * One database file (`cubicle.db`, WAL) plus the artifact folders live inside
 * the data directory handed in by the main process — never the user's home.
 * Opening a store applies the schema and, on first run, seeds the default
 * company with one project group and four empty desks so the office always
 * has something to show.
 */
import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";

import { appError } from "../shared/apperror.mjs";
import { dataLayout } from "../shared/data-layout.mjs";
import { DEFAULT_TASK_TOKEN_BUDGET } from "./cost/budget.mjs";

/**
 * @typedef {object} CompanyRow
 * @property {number} id
 * @property {string} name
 * @property {string} createdAt
 *
 * @typedef {object} GroupRow
 * @property {number} id
 * @property {number} companyId
 * @property {string} name
 * @property {string} createdAt
 *
 * @typedef {object} DeskRow
 * @property {number} id
 * @property {number} groupId
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {EmployeeOccupant | null} occupant
 *
 * @typedef {object} EmployeeOccupant
 * @property {number} id
 * @property {string} name
 * @property {number} roleId
 * @property {string | null} appearance 票 18: chosen look id (null = role default face)
 * @property {string} hiredAt
 * @property {RoleSnapshot} roleSnapshot
 * @property {string} roleName 票 a01: live role-row name (the snapshot no longer copies it)
 * @property {RoleRow | null} [role] 票 a01: the projection-cache row behind this employee (attached on the employee readers the engine uses — persona / tools / MCP ride it now)
 *
 * @typedef {object} RoleSnapshot
 *   票 a01 v2: hiring pins the version, it copies nothing. Everything the
 *   academy model says an employee owns is here: which role key, which
 *   skill hashes, which engine/model choice. Persona / tagline / display
 *   names live on the role row (the projection cache), not in the snapshot.
 * @property {string} roleKey
 * @property {string[]} domains
 * @property {Record<string, string>} locks    技能名 → hash（Neo 锁钉的版本；旧库快照没有可钉的就是 {}）
 * @property {string} engine
 * @property {string} model
 * @property {string} [provider] ticket 14: model-library provider key
 * @property {string} [reasoningEffort] ticket 14: selected reasoning level
 * @property {{ tokenBudgetPerTask: number }} cost
 *
 * @typedef {object} RoleSkillEntry
 * @property {string} name
 * @property {string} hash
 * @property {"lock" | "dir"} [via]     hash provenance (Neo ledger vs computed from dir content)
 * @property {string} [sourceType]      from the Neo lock entry (git | local | wellknown)
 *
 * @typedef {object} RoleMcpEntry
 * @property {string} name
 * @property {string} transport
 *
 * @typedef {object} RoleManifest
 * @property {string} persona
 * @property {string[]} skills
 * @property {string[]} tools
 * @property {string[]} mcpServers
 * @property {string} engine
 * @property {string} model
 * @property {string} [provider] ticket 14: model-library provider key
 * @property {string} [reasoningEffort] ticket 14: selected reasoning level
 * @property {{ tokenBudgetPerTask: number }} cost
 *
 * @typedef {object} RoleRow
 * @property {number} id
 * @property {string} key
 * @property {string} name
 * @property {string} tagline
 * @property {RoleManifest} manifest
 * @property {string[]} domains      票 a01: Neo 角色声明的领域（预设角色 = []）
 * @property {RoleSkillEntry[]} skills 票 a01: 技能 + 钉住版本（hash）
 * @property {RoleMcpEntry[]} mcp      票 a01: mcp.yaml 摘要（名称 + 传输），不含密钥
 * @property {"preset" | "neo" | "probe"} source 票 a01: 行的来源（探针行不进 listRoles）
 * @property {string | null} syncedAt 票 a01: 投影同步时间（preset = null）
 *
 * @typedef {object} EmployeeSessionRow
 * @property {number} id
 * @property {number} employeeId
 * @property {string} engine
 * @property {string} agentDir
 * @property {string} sessionsDir
 * @property {string} workspaceDir
 * @property {string | null} sessionFile
 * @property {string} updatedAt
 *
 * @typedef {"open" | "running" | "review" | "done" | "failed"} TaskStatus
 *   待办 / 进行中 / 待验收 / 完成 / 失败 (ticket 06: 五个状态不可跳过).
 *
 * @typedef {object} RunRow
 * @property {number} id
 * @property {number} employeeSessionId
 * @property {number} employeeId
 * @property {string} engine
 * @property {"running" | "completed" | "aborted" | "failed" | "interrupted" | "paused"} status
 *   票 09: 'paused' = 下班落盘 — 这一轮收尾合上，任务仍停在「进行中」等上班续跑。
 *   票 12: 预算到顶的自动暂停也落 paused（复用同层，不新增任务第六态）。
 * @property {string} prompt
 * @property {string} startedAt
 * @property {string | null} endedAt
 * @property {number | null} taskId
 * @property {number | null} taskSessionId
 * @property {import("./engine/events.mjs").Usage | null} usage engine-reported tokens, folded at finish (票 06: 本任务 token)
 * @property {string | null} failReason 票 12: 失败的人话原因（折叠自 error 事件 + 引擎最后状态），不是堆栈
 *
 * @typedef {object} TaskRow
 * @property {number} id
 * @property {number} groupId
 * @property {number} employeeId
 * @property {string} workspaceDir
 * @property {string} title
 * @property {string} goal
 * @property {"feature" | "bugfix" | "docs" | "free"} playbook
 * @property {string[]} acceptance
 * @property {string} baseHead
 * @property {TaskStatus} status
 * @property {number} tokenBudget 票 12: 这张工单的 token 预算（创建时从角色 cost 落库，+50% 就地提高）
 * @property {string} createdAt
 *
 * @typedef {TaskRow & { employeeName: string, latestSessionStatus?: string | null }} TaskRowWithEmployee
 *   latestSessionStatus 只在列表查询里携带（票 09: 暂停徽标）；taskById 不带。
 *
 * @typedef {object} TaskSessionRow
 * @property {number} id
 * @property {number} taskId
 * @property {number} employeeSessionId
 * @property {string} engine
 * @property {"running" | "completed" | "aborted" | "failed" | "interrupted" | "paused"} status
 * @property {string} startedAt
 * @property {string | null} endedAt
 * @property {string | null} [sessionFile] employee session's resume pointer (list reads only)
 *
 * @typedef {object} ScheduleRow 票 09: 每公司一份上下班时间表（配置行）
 * @property {number} companyId
 * @property {string} workStart  "HH:MM" 或 "HH:MM:SS"（本地时间）
 * @property {string} workEnd    同上
 * @property {number} graceSeconds 下班宽限（默认 90，可配）
 * @property {string} updatedAt
 *
 * @typedef {object} DutyOverrideRow 票 09: 手动上下班的 override 记录（独立于时间表）
 * @property {number} companyId
 * @property {"on" | "off"} mode
 * @property {number} at epoch ms — 用于「越过下一个排班界点自动失效」判定
 *
 * @typedef {object} DutyStatusRow 票 09: 当前相位（视图显示 + 重启后不撒谎）
 * @property {number} companyId
 * @property {"on" | "grace" | "off"} phase
 * @property {number} phaseSince epoch ms
 * @property {number | null} graceUntil epoch ms（仅宽限相位）
 *
 * @typedef {object} ArtifactRow
 * @property {number} id
 * @property {number} taskId
 * @property {number | null} runId
 * @property {"diff_summary" | "changed_files" | "command_output" | "report"} kind
 * @property {string} content
 * @property {string} createdAt
 *
 * @typedef {object} EngineStateRow
 * @property {string} engine
 * @property {boolean} enabled
 * @property {boolean} manualOverride           带风险手动启用（探针未过）
 * @property {boolean | null} installed         null = 尚未探测
 * @property {string | null} version
 * @property {"unprobed" | "running" | "passed" | "failed"} probeStatus
 * @property {unknown} probe                    { verdicts: { injection, tools, refusal, events }, … }
 * @property {string | null} probeAt
 * @property {string} updatedAt
 *
 * @typedef {object} OfficeSnapshot
 * @property {CompanyRow[]} companies
 * @property {number} activeCompanyId
 * @property {GroupRow[]} groups
 * @property {number | null} activeGroupId
 * @property {DeskRow[]} desks
 * @property {Record<string, CompanyTaskCounts>} taskCounts
 *   票 08: companyId(字符串键) → 各公司活跃数（进行中/待验收），随快照走。
 * @property {Record<string, TokenTotal>} employeeTokens
 *   票 12: employeeId(字符串键) → 员工级 token 聚合（名牌数据源）。
 * @property {Record<string, TokenTotal>} companyTokens
 *   票 12: companyId(字符串键) → 公司级 token 聚合（左轨公司面板数据源）。
 *
 * @typedef {object} CompanyTaskCounts
 * @property {number} running 进行中
 * @property {number} review 待验收
 *
 * @typedef {object} TokenTotal
 * @property {number} total 已计量的 token 总数（只有 measured=false 时 0 才意味着「没数」）
 * @property {boolean} measured false = 未计量（没有一轮引擎报过用量），显示为「未计量」而非 0
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS desk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES project_group(id),
  label TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  employee_id INTEGER UNIQUE REFERENCES employee(id)
);
CREATE TABLE IF NOT EXISTS role (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  manifest TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',
  skills TEXT NOT NULL DEFAULT '[]',
  mcp TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'preset' CHECK (source IN ('preset', 'neo', 'probe')),
  synced_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES role(id),
  role_snapshot TEXT NOT NULL,
  appearance TEXT,
  hired_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  engine TEXT NOT NULL,
  agent_dir TEXT NOT NULL,
  sessions_dir TEXT NOT NULL,
  workspace_dir TEXT NOT NULL,
  session_file TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, engine)
);
CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_session_id INTEGER NOT NULL REFERENCES employee_session(id),
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  engine TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted', 'paused')),
  prompt TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  usage TEXT,
  task_id INTEGER REFERENCES task(id),
  task_session_id INTEGER REFERENCES task_session(id),
  fail_reason TEXT
);
CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES project_group(id),
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  workspace_dir TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  playbook TEXT NOT NULL CHECK (playbook IN ('feature', 'bugfix', 'docs', 'free')),
  acceptance TEXT NOT NULL,
  base_head TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'running', 'review', 'done', 'failed')) DEFAULT 'open',
  token_budget INTEGER NOT NULL DEFAULT 500000,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES task(id),
  employee_session_id INTEGER NOT NULL REFERENCES employee_session(id),
  engine TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted', 'paused')),
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS company_schedule (
  company_id INTEGER PRIMARY KEY REFERENCES company(id),
  work_start TEXT NOT NULL,
  work_end TEXT NOT NULL,
  grace_seconds INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS duty_override (
  company_id INTEGER PRIMARY KEY REFERENCES company(id),
  mode TEXT NOT NULL CHECK (mode IN ('on', 'off')),
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS duty_status (
  company_id INTEGER PRIMARY KEY REFERENCES company(id),
  phase TEXT NOT NULL CHECK (phase IN ('on', 'grace', 'off')),
  phase_since INTEGER NOT NULL,
  grace_until INTEGER
);
CREATE TABLE IF NOT EXISTS artifact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES task(id),
  run_id INTEGER REFERENCES run(id),
  kind TEXT NOT NULL CHECK (kind IN ('diff_summary', 'changed_files', 'command_output', 'report')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS engine_state (
  engine TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  manual_override INTEGER NOT NULL DEFAULT 0,
  installed INTEGER,
  version TEXT,
  probe_status TEXT NOT NULL DEFAULT 'unprobed' CHECK (probe_status IN ('unprobed', 'running', 'passed', 'failed')),
  probe_json TEXT,
  probe_at TEXT,
  updated_at TEXT NOT NULL
);
-- 票 a03: 学院来源标记 — Cubicle 自己的账（Neo 没有 library 技能的「来源」台账）。
-- key 形态：容器级 "d:<domain>" / "r:<role>"，或行级 "d:<domain>/<skill>"。
-- kind: local=本机目录, remote=远端源, written=手写。remote_ack: 远端首次下发确认（一次，持久）。
CREATE TABLE IF NOT EXISTS academy_mark (
  resource_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('local', 'remote', 'written')),
  source TEXT,
  remote_ack INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`;

/**
 * Hot-path indexes. Created after the table-rebuild migrations (a rebuild
 * drops them). Every lookup the host runs per turn/event has a matching index;
 * `run` and `artifact` grow forever, so "small for now" is not a defence.
 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_project_group_company ON project_group(company_id);
CREATE INDEX IF NOT EXISTS idx_desk_group ON desk(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_desk_employee_unique ON desk(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_company ON employee(company_id);
CREATE INDEX IF NOT EXISTS idx_employee_session_employee ON employee_session(employee_id);
CREATE INDEX IF NOT EXISTS idx_task_group ON task(group_id);
CREATE INDEX IF NOT EXISTS idx_task_employee ON task(employee_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);
CREATE INDEX IF NOT EXISTS idx_task_session_task ON task_session(task_id);
CREATE INDEX IF NOT EXISTS idx_run_task ON run(task_id);
CREATE INDEX IF NOT EXISTS idx_run_employee ON run(employee_id);
CREATE INDEX IF NOT EXISTS idx_run_task_session ON run(task_session_id);
CREATE INDEX IF NOT EXISTS idx_run_status ON run(status);
CREATE INDEX IF NOT EXISTS idx_artifact_task ON artifact(task_id);
`;

/**
 * Run outcomes. 'running' is set by createRun; finishRun moves a run to one
 * of the closed states. A run still 'running' when the store opens (host
 * restart / crash) is marked 'interrupted' — ticket 10 builds recovery on
 * top of that fact. Ticket 09 adds 'paused': 下班落盘 closes the row too
 * (ended_at set) — the task keeps its 进行中 status, and 上班 appends a NEW
 * run/task_session instead of reopening this one.
 */
const TERMINAL_RUN_STATUSES = new Set(["completed", "aborted", "failed", "interrupted", "paused"]);

/**
 * Task status machine (ticket 06: 五个状态在界面上可见且不可跳过). The host —
 * not the view — owns legality: every status change funnels through
 * setTaskStatus, which refuses anything the map below does not name.
 *
 *   open ──派单──▶ running ──跑完──▶ review ──通过──▶ done (终态)
 *     ▲    ▲         │  └──取消/失败──▶ failed          │
 *     │    └──打回────┘                        打回 ────┤ (review → running)
 *     └──崩溃自愈                                       │
 *          failed ──重试──▶ running                    │
 *     └──放弃(票 10)──▶ failed
 *
 * 票 10 adds exactly one edge: open → failed, the abandon exit for a task a
 * crash interrupted (the heal parks such tasks back at 待办 with their latest
 * task_session interrupted). The five states themselves do not change — the
 * interrupt lives at the run/task_session layer, not as a sixth task state.
 * Why the edge is honest rather than a hole: it models the boss explicitly
 * giving up on an interrupted work order (the task already failed once by
 * crashing), and the service door (task.abandon) only applies it to that
 * interrupted shape. Fresh, never-dispatched tickets keep 待办→失败 out of
 * reach in practice through that service gate; the map loosens only where
 * the crash story needs it.
 */
const TASK_TRANSITIONS = Object.freeze(
  /** @type {Record<TaskStatus, readonly TaskStatus[]>} */ ({
    open: ["running", "failed"],
    running: ["review", "failed"],
    review: ["done", "running"],
    done: [],
    failed: ["running"],
  }),
);

/**
 * The v1 preset roster (decision 05: 程序员 / 测试 / 产品经理, default
 * engine pi; cost semantics from decision 04: per-task token soft gate).
 * Inserted by key, so an existing database gains roles without duplicates.
 *
 * Shell tool = pi's `powershell` (ticket 07): the app is Windows-first, and
 * pi's `bash` tool resolves to Git-Bash/msys2, whose startup dies under this
 * machine's security policy (NtCreateDirectoryObject → 0xC0000022) — the
 *工位 would show永远失败的执行. PowerShell is the native Windows shell and
 * survives the same policy.
 */
const PRESET_ROLES = [
  {
    key: "programmer",
    name: "程序员",
    tagline: "加功能、修 bug；工作区主力，自主 commit 不 push",
    manifest: {
      persona: "严谨务实的程序员：测试先行、小步提交、不主动 push，回滚靠重新派任务。",
      skills: ["git 工作流", "测试先行"],
      tools: ["read", "write", "edit", "powershell", "grep"],
      mcpServers: [],
      engine: "pi",
      model: "default",
      cost: { tokenBudgetPerTask: 500000 },
    },
  },
  {
    key: "tester",
    name: "测试",
    tagline: "跑测试、验收辅助；只读代码 + 执行测试",
    manifest: {
      persona: "苛刻的测试工程师：一切清单化，优先跑测试，不改动被测试的代码。",
      skills: ["测试清单化"],
      tools: ["read", "powershell", "grep"],
      mcpServers: [],
      engine: "pi",
      model: "default",
      cost: { tokenBudgetPerTask: 500000 },
    },
  },
  {
    key: "pm",
    name: "产品经理",
    tagline: "写文档、做规划；只读写文档，不碰 shell",
    manifest: {
      persona: "有条理的产品经理：先讲清目标与验收标准，再谈方案与文档。",
      skills: ["文档结构约定"],
      tools: ["read", "write"],
      mcpServers: [],
      engine: "pi",
      model: "default",
      cost: { tokenBudgetPerTask: 500000 },
    },
  },
];

/**
 * Eight desk bays (4×2) every project group owns. The order is row-major:
 * back row first, then the front row. It is mirrored by DESK_LAYOUT in
 * renderer/src/scene/Office3D.jsx and by the Desk1..Desk8 names in the
 * Blender scene; changing one without the others breaks the 3D anchors.
 */
const DESK_SLOTS = [
  { x: 100, y: 150 },
  { x: 260, y: 150 },
  { x: 420, y: 150 },
  { x: 580, y: 150 },
  { x: 100, y: 320 },
  { x: 260, y: 320 },
  { x: 420, y: 320 },
  { x: 580, y: 320 },
];

/**
 * @param {Record<string, unknown>} row
 * @returns {CompanyRow}
 */
function toCompany(row) {
  return { id: Number(row.id), name: String(row.name), createdAt: String(row.created_at) };
}

/**
 * Corrupt JSON in a column must degrade, never take the whole office down:
 * the same rule toTask/parseUsage already follow.
 *
 * @template T
 * @param {unknown} value
 * @param {T} fallback
 * @returns {T}
 */
function parseJsonOr(value, fallback) {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : /** @type {T} */ (parsed);
  } catch {
    return fallback;
  }
}

/** The snapshot a corrupt employee row degrades to: a readable unknown role. */
/** @type {RoleSnapshot} */
const UNKNOWN_ROLE_SNAPSHOT = {
  roleKey: "unknown",
  domains: [],
  locks: {},
  engine: "pi",
  model: "default",
  cost: { tokenBudgetPerTask: DEFAULT_TASK_TOKEN_BUDGET },
};

/**
 * @param {Record<string, unknown>} row
 * @returns {GroupRow}
 */
function toGroup(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

/** Shared columns for reading a desk row joined with its occupant's employee row. */
const DESK_JOIN = `d.*,
  e.id AS e_id, e.name AS e_name, e.role_id AS e_role_id,
  e.role_snapshot AS e_role_snapshot, e.appearance AS e_appearance, e.hired_at AS e_hired_at,
  r.name AS e_role_name`;

/**
 * @param {Record<string, unknown>} row desk row joined with its occupant
 * @returns {DeskRow}
 */
function toDesk(row) {
  const occupantId = row.e_id === null || row.e_id === undefined ? null : Number(row.e_id);
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    label: String(row.label),
    x: Number(row.x),
    y: Number(row.y),
    occupant:
      occupantId === null
        ? null
        : {
            id: occupantId,
            name: String(row.e_name),
            roleId: Number(row.e_role_id),
            appearance: row.e_appearance === null || row.e_appearance === undefined ? null : String(row.e_appearance),
            hiredAt: String(row.e_hired_at),
            roleSnapshot: /** @type {RoleSnapshot} */ (parseJsonOr(row.e_role_snapshot, UNKNOWN_ROLE_SNAPSHOT)),
            roleName: row.e_role_name === null || row.e_role_name === undefined ? "未知角色" : String(row.e_role_name),
          },
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {RoleRow}
 */
function toRole(row) {
  return {
    id: Number(row.id),
    key: String(row.key),
    name: String(row.name),
    tagline: String(row.tagline),
    manifest: /** @type {RoleManifest} */ (parseJsonOr(row.manifest, {})),
    // 票 a01: 投影缓存字段。旧库缺列时（SELECT * 读不到）落到安全默认。
    domains: /** @type {string[]} */ (parseJsonOr(row.domains, [])),
    skills: /** @type {RoleSkillEntry[]} */ (parseJsonOr(row.skills, [])),
    mcp: /** @type {RoleMcpEntry[]} */ (parseJsonOr(row.mcp, [])),
    source: row.source === "neo" || row.source === "probe" ? row.source : "preset",
    syncedAt: row.synced_at === null || row.synced_at === undefined ? null : String(row.synced_at),
  };
}

/** 票 a03: academy_mark 行 → 面板视图。 */
/** @param {Record<string, unknown>} row */
function toAcademyMark(row) {
  return {
    resourceKey: String(row.resource_key),
    kind: /** @type {"local" | "remote" | "written"} */ (
      row.kind === "local" || row.kind === "remote" || row.kind === "written" ? row.kind : "written"
    ),
    source: row.source === null || row.source === undefined ? null : String(row.source),
    remoteAck: Number(row.remote_ack) === 1,
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {EmployeeSessionRow}
 */
function toEmployeeSession(row) {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    engine: String(row.engine),
    agentDir: String(row.agent_dir),
    sessionsDir: String(row.sessions_dir),
    workspaceDir: String(row.workspace_dir),
    sessionFile: row.session_file === null || row.session_file === undefined ? null : String(row.session_file),
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {RunRow}
 */
function toRun(row) {
  return {
    id: Number(row.id),
    employeeSessionId: Number(row.employee_session_id),
    employeeId: Number(row.employee_id),
    engine: String(row.engine),
    status: /** @type {RunRow["status"]} */ (String(row.status)),
    prompt: String(row.prompt),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
    taskId: row.task_id === null || row.task_id === undefined ? null : Number(row.task_id),
    taskSessionId:
      row.task_session_id === null || row.task_session_id === undefined ? null : Number(row.task_session_id),
    usage: parseUsage(row.usage),
    failReason: row.fail_reason === null || row.fail_reason === undefined ? null : String(row.fail_reason),
  };
}

/**
 * Stored run usage is a JSON blob of the neutral Usage shape; anything
 * unreadable reads as “no usage reported”, never a crash.
 *
 * @param {unknown} raw
 * @returns {import("./engine/events.mjs").Usage | null}
 */
function parseUsage(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    const usage = /** @type {Record<string, unknown>} */ (parsed);
    const count = (/** @type {unknown} */ value) =>
      typeof value === "number" && Number.isFinite(value) ? value : 0;
    return {
      input: count(usage.input),
      cachedInput: count(usage.cachedInput),
      cacheWrite: count(usage.cacheWrite),
      output: count(usage.output),
      reasoning: count(usage.reasoning),
    };
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} row
 * @returns {TaskRow}
 */
function toTask(row) {
  /** @type {string[]} */
  let acceptance = [];
  try {
    const parsed = JSON.parse(String(row.acceptance));
    if (Array.isArray(parsed)) acceptance = parsed.map((line) => String(line));
  } catch {
    // a corrupted acceptance column reads as "no criteria", never a crash
  }
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    employeeId: Number(row.employee_id),
    workspaceDir: String(row.workspace_dir),
    title: String(row.title),
    goal: String(row.goal),
    playbook: /** @type {TaskRow["playbook"]} */ (String(row.playbook)),
    acceptance,
    baseHead: String(row.base_head),
    status: /** @type {TaskRow["status"]} */ (String(row.status)),
    // 票 12: 预算落在任务行上（角色 cost 建单时抄进来，+50% 就地改这一行）。
    tokenBudget:
      typeof row.token_budget === "number" && row.token_budget > 0 ? row.token_budget : DEFAULT_TASK_TOKEN_BUDGET,
    createdAt: String(row.created_at),
    ...(row.latest_session_status === undefined
      ? {}
      : {
          // 票 09: 暂停徽标的数据源 — 最近一轮 task_session 的状态（列表查询携带）
          latestSessionStatus:
            row.latest_session_status === null || row.latest_session_status === undefined
              ? null
              : String(row.latest_session_status),
        }),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {TaskSessionRow}
 */
function toTaskSession(row) {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    employeeSessionId: Number(row.employee_session_id),
    engine: String(row.engine),
    status: /** @type {TaskSessionRow["status"]} */ (String(row.status)),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
    ...(row.session_file === undefined
      ? {}
      : {
          sessionFile:
            row.session_file === null || row.session_file === undefined ? null : String(row.session_file),
        }),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {ArtifactRow}
 */
function toArtifact(row) {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    runId: row.run_id === null || row.run_id === undefined ? null : Number(row.run_id),
    kind: /** @type {ArtifactRow["kind"]} */ (String(row.kind)),
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {ScheduleRow}
 */
function toSchedule(row) {
  return {
    companyId: Number(row.company_id),
    workStart: String(row.work_start),
    workEnd: String(row.work_end),
    graceSeconds: Number(row.grace_seconds),
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {DutyStatusRow}
 */
function toDutyStatus(row) {
  return {
    companyId: Number(row.company_id),
    phase: /** @type {DutyStatusRow["phase"]} */ (String(row.phase)),
    phaseSince: Number(row.phase_since),
    graceUntil: row.grace_until === null || row.grace_until === undefined ? null : Number(row.grace_until),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {EngineStateRow}
 */
function toEngineState(row) {
  /** @type {unknown} */
  let probe = null;
  if (typeof row.probe_json === "string" && row.probe_json.length > 0) {
    try {
      probe = JSON.parse(row.probe_json);
    } catch {
      probe = null;
    }
  }
  return {
    engine: String(row.engine),
    enabled: Number(row.enabled) === 1,
    manualOverride: Number(row.manual_override) === 1,
    installed: row.installed === null || row.installed === undefined ? null : Number(row.installed) === 1,
    version: row.version === null || row.version === undefined ? null : String(row.version),
    probeStatus: /** @type {EngineStateRow["probeStatus"]} */ (String(row.probe_status)),
    probe,
    probeAt: row.probe_at === null || row.probe_at === undefined ? null : String(row.probe_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Engines the app ships with. pi is enabled out of the box (its SDK is
 * bundled — ticket 04 already runs on it); every other engine must clear
 * the admission probe (ticket 11) or be hand-enabled with the risk flag
 * before it can take work.
 */
const ENGINE_SEEDS = [
  { engine: "pi", enabled: true, installed: true },
  { engine: "codex", enabled: false, installed: null },
  { engine: "dsh", enabled: false, installed: null },
];

/** @param {DatabaseSync} db */
function seedEngineStates(db) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO engine_state (engine, enabled, installed, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(engine) DO NOTHING",
  );
  for (const seed of ENGINE_SEEDS) {
    insert.run(seed.engine, seed.enabled ? 1 : 0, seed.installed === null ? null : seed.installed ? 1 : 0, now);
  }
}

/**
 * One-shot schema repair for pre-ticket-11 databases: the old table pinned
 * the per-employee UNIQUE on the column, so a second (engine-switched)
 * session row was impossible. Rebuild with UNIQUE (employee_id, engine),
 * keeping ids — run rows reference them.
 *
 * Rebuild order matters: NEVER rename the old table first. With foreign_keys
 * OFF, SQLite does not rewrite child REFERENCES, and a `RENAME` would leave
 * run/task_session pointing at a table that is then dropped. Build the new
 * table under a temporary name, copy, drop the old, rename the new one into
 * the original name — the child REFERENCES keep pointing at the right name.
 *
 * @param {DatabaseSync} db
 */
function migrateEmployeeSessionPerEngine(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employee_session'").get();
  const sql = String(/** @type {Record<string, unknown>} */ (table ?? {}).sql ?? "");
  if (!/employee_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(sql)) return;
  db.exec("BEGIN");
  try {
    db.exec(SCHEMA_SESSION_ONLY.replace("CREATE TABLE employee_session", "CREATE TABLE employee_session_new"));
    db.exec(`
      INSERT INTO employee_session_new (id, employee_id, engine, agent_dir, sessions_dir, workspace_dir, session_file, updated_at)
      SELECT id, employee_id, engine, agent_dir, sessions_dir, workspace_dir, session_file, updated_at FROM employee_session
    `);
    db.exec("DROP TABLE employee_session");
    db.exec("ALTER TABLE employee_session_new RENAME TO employee_session");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** The employee_session DDL, duplicated here so the migration can create
 *  exactly that table without re-running unrelated schema statements. */
const SCHEMA_SESSION_ONLY = `
CREATE TABLE employee_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  engine TEXT NOT NULL,
  agent_dir TEXT NOT NULL,
  sessions_dir TEXT NOT NULL,
  workspace_dir TEXT NOT NULL,
  session_file TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, engine)
);
`;

/**
 * Freeze a role row into the snapshot shape stored on every employee.
 * 票 a01 v2: the snapshot pins identity + versions only — roleKey, the role's
 * domains, the skill hashes as they are right now (locks: 技能名 → sha) — plus
 * the hire-time engine/model choice and cost. Persona / skills / tools / 标语
 * are content: they live on the role row (the projection cache), never in the
 * snapshot ("只钉版本，不复制内容").
 *
 * @param {RoleRow} role
 * @returns {RoleSnapshot}
 */
function toRoleSnapshot(role) {
  const manifest = /** @type {Record<string, any>} */ (role.manifest ?? {});
  /** @type {Record<string, string>} */
  const locks = {};
  for (const skill of role.skills ?? []) {
    if (skill && typeof skill.name === "string" && typeof skill.hash === "string") {
      locks[skill.name] = skill.hash;
    }
  }
  /** @type {RoleSnapshot} */
  const snapshot = {
    roleKey: role.key,
    domains: role.domains ?? [],
    locks,
    engine: typeof manifest.engine === "string" ? manifest.engine : "pi",
    model: typeof manifest.model === "string" ? manifest.model : "default",
    cost:
      manifest.cost && typeof manifest.cost === "object"
        ? /** @type {{ tokenBudgetPerTask: number }} */ (manifest.cost)
        : { tokenBudgetPerTask: DEFAULT_TASK_TOKEN_BUDGET },
  };
  if (typeof manifest.provider === "string" && manifest.provider.length > 0) snapshot.provider = manifest.provider;
  if (typeof manifest.reasoningEffort === "string" && manifest.reasoningEffort.length > 0) {
    snapshot.reasoningEffort = manifest.reasoningEffort;
  }
  return snapshot;
}

/**
 * @param {{ dataDir: string }} options
 */
export function openStore({ dataDir }) {
  // 票 13: 数据目录清单只有一个主人（src/shared/data-layout.mjs），
  // 首启按它建，打包验收按它查。
  const layout = dataLayout(dataDir);
  const dbPath = layout.dbPath;
  mkdirSync(layout.root, { recursive: true });
  for (const folder of layout.folders) {
    mkdirSync(folder.dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  // A second process can briefly hold the WAL (crash residue, backup tooling).
  // The single-writer design makes this rare, not impossible: wait instead of
  // throwing SQLITE_BUSY on the first tick.
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  // node:sqlite enables foreign keys by default. Several migrations rebuild
  // parent tables (task / run / task_session / employee_session) whose child
  // rows still reference them; with FK enforcement on, `DROP TABLE` fails and
  // the host crash-loops on every launch. Run migrations with FK off, then
  // verify the result with foreign_key_check. (PRAGMA cannot be toggled inside
  // a transaction, so this sits outside the per-migration BEGIN/COMMIT.)
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    migrateRunTaskColumns(db);
    migrateTaskStateMachine(db);
    migrateRunPauseState(db);
    // Ticket 11 widens employee_session from one-per-employee to one-per
    // employee × engine (switching engines keeps each engine's resume story).
    // Databases built before that carry the UNIQUE on the column itself —
    // rebuild them in place, ids first (run rows reference those ids).
    migrateEmployeeSessionPerEngine(db);
    migrateCostColumns(db);
    // Ticket 18: PEOPLE look different, so the employee row carries the look
    // id chosen at hire time. Older rows stay NULL and fall back to the role's
    // default face in the renderer.
    migrateEmployeeAppearance(db);
    // 票 a01: the role table widens into the Neo projection cache, and old
    // employees' whole-manifest snapshots upgrade to the version-pin shape.
    migrateRoleProjectionColumns(db);
    migrateRoleSnapshotsToV2(db);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
  const orphans = db.prepare("PRAGMA foreign_key_check").all();
  if (orphans.length > 0) {
    throw new Error(`store migration left ${orphans.length} orphan foreign-key rows`);
  }
  assertRequiredColumns(db);
  // Indexes are created AFTER the rebuild migrations: dropping a table drops
  // its indexes with it. Hot paths (turn_end → run.task_id, listTasks →
  // task_session.task_id) would otherwise scan the whole table.
  db.exec(INDEXES);
  // A workspace belongs to the employee, not to the engine (see
  // engine/paths.mjs). Older databases kept one workspace per engine; move the
  // employee's current workspace to the shared location once, then point every
  // engine session (and tasks recorded in that workspace) at it.
  migrateEmployeeWorkspaces(db, dataDir);
  // A host that died (or was killed) mid-run must not leave phantom 'running'
  // rows behind: they become 'interrupted' the moment a host opens the store.
  markInterruptedRuns(db);
  // Same honesty rule for the admission probe (ticket 11): a probe can never
  // outlive the host that started it, so a "running" verdict state is stale —
  // land it as failed instead of wedging the engine card on 运行中… forever.
  markInterruptedProbes(db);
  seedIfFirstRun(db);
  seedRoles(db);
  seedEngineStates(db);
  // Ticket 14 widened the office from 4 to 8 bays. Older databases keep
  // their existing desks and gain the missing back/front-row bays in place.
  ensureDeskCapacity(db);

  /**
   * Shared employee-row → occupant mapping (票 a01). The live role row travels
   * with the employee: persona / tools / MCP are role-row content now — the
   * frozen snapshot only pins versions — and the engine adapters read the role
   * through it. (Desk rows use the cheaper join in DESK_JOIN.)
   *
   * @param {Record<string, unknown>} row employee row (id … hired_at; appearance optional)
   */
  const employeeRecord = (row) => {
    const roleId = Number(row.role_id);
    const roleRow = db.prepare("SELECT * FROM role WHERE id = ?").get(roleId);
    return {
      id: Number(row.id),
      companyId: Number(row.company_id),
      name: String(row.name),
      roleId,
      appearance: row.appearance === null || row.appearance === undefined ? null : String(row.appearance),
      roleSnapshot: /** @type {RoleSnapshot} */ (parseJsonOr(row.role_snapshot, UNKNOWN_ROLE_SNAPSHOT)),
      hiredAt: String(row.hired_at),
      roleName: roleRow ? String(/** @type {Record<string, unknown>} */ (roleRow).name) : "未知角色",
      role: roleRow ? toRole(/** @type {Record<string, unknown>} */ (roleRow)) : null,
    };
  };

  return {
    dataDir,
    dbPath,

    /** @returns {string} */
    journalMode() {
      return String(db.prepare("PRAGMA journal_mode").get()?.journal_mode);
    },

    /** @param {string} folder @returns {boolean} */
    directoryExists(folder) {
      return existsSync(path.join(dataDir, folder));
    },

    /** @param {{ name: string }} input @returns {CompanyRow} */
    createCompany({ name }) {
      const createdAt = new Date().toISOString();
      const info = db.prepare("INSERT INTO company (name, created_at) VALUES (?, ?)").run(name, createdAt);
      return { id: Number(info.lastInsertRowid), name, createdAt };
    },

    /** @param {number} companyId @returns {boolean} */
    companyExists(companyId) {
      return db.prepare("SELECT 1 AS ok FROM company WHERE id = ?").get(companyId) !== undefined;
    },

    /**
     * Just the company ids. The duty tick and existence checks must not pay for
     * a full office snapshot (two run-table token scans) every second.
     *
     * @returns {number[]}
     */
    companyIds() {
      return db
        .prepare("SELECT id FROM company ORDER BY id")
        .all()
        .map((row) => Number(/** @type {Record<string, unknown>} */ (row).id));
    },

    /** @param {{ companyId: number, name: string }} input @returns {GroupRow} */
    createProjectGroup({ companyId, name }) {
      const company = db.prepare("SELECT id FROM company WHERE id = ?").get(companyId);
      if (!company) throw appError("unknown_company", `no company with id ${companyId}`);
      const createdAt = new Date().toISOString();
      const info = db
        .prepare("INSERT INTO project_group (company_id, name, created_at) VALUES (?, ?, ?)")
        .run(companyId, name, createdAt);
      const groupId = Number(info.lastInsertRowid);
      insertProjectGroupDesks(db, groupId);
      return { id: groupId, companyId, name, createdAt };
    },

    /** @param {{ companyId: number }} input @returns {GroupRow[]} */
    listGroups({ companyId }) {
      const rows = db
        .prepare("SELECT * FROM project_group WHERE company_id = ? ORDER BY id")
        .all(companyId);
      return rows.map((row) => toGroup(/** @type {Record<string, unknown>} */ (row)));
    },

    /** @param {{ groupId: number }} input @returns {DeskRow[]} */
    listDesks({ groupId }) {
      const rows = db
        .prepare(
          `SELECT ${DESK_JOIN} FROM desk d
           LEFT JOIN employee e ON e.id = d.employee_id
           LEFT JOIN role r ON r.id = e.role_id
           WHERE d.group_id = ? ORDER BY d.id`,
        )
        .all(groupId);
      return rows.map((row) => toDesk(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * Factory roles, in seed order. The roster is (re)inserted by key on
     * every open, so old databases gain new presets without duplicates.
     *
     * @returns {RoleRow[]}
     */
    listRoles() {
      // 票 a01: probe rows are hidden plumbing (the admission probe's persona
      // carrier), never part of the hireable library.
      const rows = db.prepare("SELECT * FROM role WHERE source <> 'probe' ORDER BY id").all();
      return rows.map((row) => toRole(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * 票 a01: the projection "刷新" — write the Neo roles just read from
     * `~/.neo` (see academy/neo-roles.mjs) into the `role` cache. Neo-published
     * rows gain skills+hash / domains / mcp 摘要 / source='neo' / synced_at.
     * Rows Neo no longer publishes: preset keys fall back to their seed row,
     * unreferenced Neo rows are removed, and rows still referenced by an
     * employee stay so frozen snapshots keep explaining themselves.
     *
     * TODO(materialize): the projection input is the interim direct-read shape;
     * after Neo's materialize lands it comes from `neo materialize --json`.
     *
     * @param {import("./academy/neo-roles.mjs").NeoRoleProjection[]} projections
     * @returns {{ inserted: number, updated: number, removed: number }}
     */
    syncRoleProjection(projections) {
      const now = new Date().toISOString();
      let inserted = 0;
      let updated = 0;
      let removed = 0;
      db.exec("BEGIN");
      try {
        const roleByKey = db.prepare("SELECT * FROM role WHERE key = ?");
        const upsert = db.prepare(
          `INSERT INTO role (key, name, tagline, manifest, domains, skills, mcp, source, synced_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'neo', ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             name = excluded.name,
             tagline = excluded.tagline,
             manifest = excluded.manifest,
             domains = excluded.domains,
             skills = excluded.skills,
             mcp = excluded.mcp,
             source = 'neo',
             synced_at = excluded.synced_at`,
        );
        for (const projection of projections) {
          if (typeof projection?.key !== "string" || projection.key.length === 0) continue;
          const skills = Array.isArray(projection.skills) ? projection.skills : [];
          const mcp = Array.isArray(projection.mcp) ? projection.mcp : [];
          const domains = Array.isArray(projection.domains)
            ? projection.domains.filter((domain) => typeof domain === "string")
            : [];
          const priorRow = roleByKey.get(projection.key);
          const prior = priorRow ? toRole(/** @type {Record<string, unknown>} */ (priorRow)) : null;
          // The manifest keeps assembly fallback (engine / model / cost) across
          // refreshes — a Neo role says WHAT it assembles, not which of the
          // app's engines or models the hire will use. persona = AGENTS.md.
          const manifest = {
            persona: typeof projection.persona === "string" ? projection.persona : "",
            skills: skills.map((skill) => String(skill.name)),
            tools: prior?.manifest?.tools ?? [],
            mcpServers: mcp.map((server) => String(server.name)),
            engine: prior?.manifest?.engine ?? "pi",
            model: prior?.manifest?.model ?? "default",
            cost: prior?.manifest?.cost ?? { tokenBudgetPerTask: DEFAULT_TASK_TOKEN_BUDGET },
          };
          upsert.run(
            projection.key,
            projection.name ?? projection.key,
            projection.tagline ?? "",
            JSON.stringify(manifest),
            JSON.stringify(domains),
            JSON.stringify(skills),
            JSON.stringify(mcp),
            now,
            now,
          );
          if (prior) updated += 1;
          else inserted += 1;
        }
        // Rows the new projection no longer publishes.
        const published = projections.map((projection) => projection?.key ?? "");
        const missing =
          published.length === 0
            ? db.prepare("SELECT id, key, source FROM role WHERE source <> 'probe'").all()
            : db
                .prepare(
                  `SELECT id, key, source FROM role
                   WHERE source <> 'probe' AND key NOT IN (${published.map(() => "?").join(", ")})`,
                )
                .all(...published);
        const restorePreset = db.prepare(
          `UPDATE role SET name = ?, tagline = ?, manifest = ?, domains = '[]', skills = '[]', mcp = '[]',
             source = 'preset', synced_at = NULL
           WHERE id = ?`,
        );
        const deleteUnreferenced = db.prepare(
          "DELETE FROM role WHERE id = ? AND id NOT IN (SELECT DISTINCT role_id FROM employee)",
        );
        for (const row of missing) {
          const preset = PRESET_ROLES.find((entry) => entry.key === row.key);
          if (preset) {
            restorePreset.run(preset.name, preset.tagline, JSON.stringify(preset.manifest), Number(row.id));
          } else if (row.source === "neo") {
            removed += Number(deleteUnreferenced.run(Number(row.id)).changes);
          }
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { inserted, updated, removed };
    },

    // — 票 a03: 学院来源标记（来源=本机/远端/手写 + 远端首次下发的一次性确认）—

    /**
     * Upsert a panel-side mark for an academy resource (container key
     * `d:<domain>` / `r:<role>` or row key `d:<domain>/<skill>`). Never
     * touches remote_ack — a re-install does not re-ask what the boss already
     * confirmed once.
     *
     * @param {{ resourceKey: string, kind: "local" | "remote" | "written", source?: string | null }} input
     */
    upsertAcademyMark({ resourceKey, kind, source }) {
      if (typeof resourceKey !== "string" || resourceKey.length === 0 || resourceKey.length > 200) {
        throw appError("invalid_academy_mark", "resourceKey must be a non-empty short string");
      }
      if (kind !== "local" && kind !== "remote" && kind !== "written") {
        throw appError("invalid_academy_mark", `unknown academy mark kind: ${String(kind)}`);
      }
      db.prepare(
        `INSERT INTO academy_mark (resource_key, kind, source, remote_ack, updated_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(resource_key) DO UPDATE SET
           kind = excluded.kind,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      ).run(resourceKey, kind, source ?? null, new Date().toISOString());
    },

    /**
     * Record the one-time 远端下发 confirmation. Creates the row (kind
     * 'remote') when the mark was inferred (e.g. from a lock sourceType) and
     * no panel install had happened yet.
     *
     * @param {string} resourceKey
     */
    ackAcademyRemote(resourceKey) {
      if (typeof resourceKey !== "string" || resourceKey.length === 0 || resourceKey.length > 200) {
        throw appError("invalid_academy_mark", "resourceKey must be a non-empty short string");
      }
      db.prepare(
        `INSERT INTO academy_mark (resource_key, kind, source, remote_ack, updated_at)
         VALUES (?, 'remote', NULL, 1, ?)
         ON CONFLICT(resource_key) DO UPDATE SET remote_ack = 1, updated_at = excluded.updated_at`,
      ).run(resourceKey, new Date().toISOString());
    },

    /** @param {string} resourceKey @returns {{ resourceKey: string, kind: "local" | "remote" | "written", source: string | null, remoteAck: boolean, updatedAt: string } | null} */
    getAcademyMark(resourceKey) {
      const row = db.prepare("SELECT * FROM academy_mark WHERE resource_key = ?").get(resourceKey);
      return row ? toAcademyMark(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /** @returns {{ resourceKey: string, kind: "local" | "remote" | "written", source: string | null, remoteAck: boolean, updatedAt: string }[]} */
    listAcademyMarks() {
      return db
        .prepare("SELECT * FROM academy_mark ORDER BY resource_key")
        .all()
        .map((row) => toAcademyMark(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * Hire an employee onto a free desk, freezing the role as it is right now
     * into the employee (decision 02: hiring takes a snapshot; later role
     * edits never infect people already hired). One transaction so a desk is
     * never half-occupied.
     *
     * @param {{ deskId: number, roleId: number, name?: string, appearance?: string | null, engine?: string, provider?: string, model?: string, reasoningEffort?: string | null }} input
     * @returns {{ employee: { id: number, companyId: number, name: string, roleId: number, roleSnapshot: RoleSnapshot, appearance: string | null, hiredAt: string }, desk: DeskRow | null }}
     */
    hireEmployee({ deskId, roleId, name, appearance, engine, provider, model, reasoningEffort }) {
      const deskRow = db
        .prepare(
          `SELECT ${DESK_JOIN}, g.company_id AS g_company_id
           FROM desk d
           JOIN project_group g ON g.id = d.group_id
           LEFT JOIN employee e ON e.id = d.employee_id
           LEFT JOIN role r ON r.id = e.role_id
           WHERE d.id = ?`,
        )
        .get(deskId);
      if (!deskRow) throw appError("unknown_desk", `no desk with id ${deskId}`);
      if (deskRow.e_id !== null && deskRow.e_id !== undefined) {
        throw appError("desk_occupied", `desk ${deskId} already has an occupant`);
      }
      const roleRow = db.prepare("SELECT * FROM role WHERE id = ?").get(roleId);
      if (!roleRow) throw appError("unknown_role", `no role with id ${roleId}`);

      const role = toRole(/** @type {Record<string, unknown>} */ (roleRow));
      // 票 a01: the snapshot pins the role's version (roleKey + locks) plus the
      // hire-time model choice; role content stays on the role row, so later
      // library / Neo changes can never infect people already hired.
      const roleSnapshot = /** @type {Record<string, any>} */ (toRoleSnapshot(role));
      if (engine !== undefined) roleSnapshot.engine = engine;
      if (provider !== undefined) roleSnapshot.provider = provider;
      if (model !== undefined) roleSnapshot.model = model;
      if (reasoningEffort !== undefined) {
        if (reasoningEffort === null) delete roleSnapshot.reasoningEffort;
        else roleSnapshot.reasoningEffort = reasoningEffort;
      }
      const employeeName = name !== undefined && name.trim().length > 0 ? name.trim() : role.name;
      const hiredAt = new Date().toISOString();
      let employeeId = 0;

      db.exec("BEGIN");
      try {
        const info = db
          .prepare("INSERT INTO employee (company_id, name, role_id, role_snapshot, appearance, hired_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(
            Number(deskRow.g_company_id),
            employeeName,
            role.id,
            JSON.stringify(roleSnapshot),
            appearance ?? null,
            hiredAt,
          );
        employeeId = Number(info.lastInsertRowid);
        // Guard against a racing occupy inside this transaction.
        const occupied = db
          .prepare("UPDATE desk SET employee_id = ? WHERE id = ? AND employee_id IS NULL")
          .run(employeeId, deskId);
        if (occupied.changes !== 1) throw appError("desk_occupied", `desk ${deskId} already has an occupant`);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      return {
        employee: {
          id: employeeId,
          companyId: Number(deskRow.g_company_id),
          name: employeeName,
          roleId: role.id,
          roleSnapshot: /** @type {RoleSnapshot} */ (roleSnapshot),
          appearance: appearance ?? null,
          hiredAt,
        },
        desk: this.listDesks({ groupId: Number(deskRow.group_id) }).find((d) => d.id === deskId) ?? null,
      };
    },

    /**
     * Every seated employee of a company, across its project groups — the
     * 花名册 is a company roster, not "the active group's desks".
     *
     * @param {{ companyId: number }} input
     * @returns {{ id: number, name: string, roleName: string, roleSnapshot: RoleSnapshot, deskLabel: string, groupName: string }[]}
     */
    listEmployeesForCompany({ companyId }) {
      const rows = db
        .prepare(
          `SELECT e.id AS id, e.name AS name, e.role_snapshot AS role_snapshot, e.appearance AS appearance,
                  d.label AS desk_label, g.name AS group_name, r.name AS role_name
           FROM employee e
           JOIN desk d ON d.employee_id = e.id
           JOIN project_group g ON g.id = d.group_id
           LEFT JOIN role r ON r.id = e.role_id
           WHERE e.company_id = ?
           ORDER BY e.id`,
        )
        .all(companyId);
      return rows.map((raw) => {
        const row = /** @type {Record<string, unknown>} */ (raw);
        const snapshot = /** @type {RoleSnapshot} */ (parseJsonOr(row.role_snapshot, UNKNOWN_ROLE_SNAPSHOT));
        return {
          id: Number(row.id),
          name: String(row.name),
          // 票 a01: the role label rides the live role row; the snapshot pins versions only.
          roleName: row.role_name === null || row.role_name === undefined ? "未知角色" : String(row.role_name),
          roleSnapshot: snapshot,
          appearance: row.appearance === null || row.appearance === undefined ? null : String(row.appearance),
          deskLabel: String(row.desk_label),
          groupName: String(row.group_name),
        };
      });
    },

    /**
     * @param {number} employeeId
     * @returns {(EmployeeOccupant & { companyId: number, role: RoleRow | null }) | null}
     */
    employeeById(employeeId) {
      const row = db
        .prepare("SELECT id, company_id, name, role_id, role_snapshot, appearance, hired_at FROM employee WHERE id = ?")
        .get(employeeId);
      if (!row) return null;
      return employeeRecord(/** @type {Record<string, unknown>} */ (row));
    },

    /**
     * Every employee row (all companies) — model-reassign on delete needs a
     * complete reference scan, not only the active company's roster.
     *
     * @returns {(EmployeeOccupant & { companyId: number })[]}
     */
    listAllEmployees() {
      const rows = db.prepare("SELECT id, company_id, name, role_id, role_snapshot, appearance, hired_at FROM employee ORDER BY id").all();
      return rows.map((row) => employeeRecord(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * One conversation session per employee × engine (ticket 04: 同一员工连续
     * 两次对话复用同一会话; ticket 11: 切换引擎后每个引擎各自保留自己的会话与
     * 恢复指针，换回原引擎照常续). The row also carries the engine-owned
     * directory layout and — once the engine has written one — the resume
     * pointer (session file). Directories are only applied on creation; the
     * session entity is the stable thing, not the paths.
     *
     * @param {{ employeeId: number, engine: string, agentDir: string, sessionsDir: string, workspaceDir: string }} input
     * @returns {EmployeeSessionRow}
     */
    getOrCreateEmployeeSession({ employeeId, engine, agentDir, sessionsDir, workspaceDir }) {
      if (!db.prepare("SELECT id FROM employee WHERE id = ?").get(employeeId)) {
        throw appError("unknown_employee", `no employee with id ${employeeId}`);
      }
      const existing = db
        .prepare("SELECT * FROM employee_session WHERE employee_id = ? AND engine = ?")
        .get(employeeId, engine);
      if (existing) return toEmployeeSession(/** @type {Record<string, unknown>} */ (existing));
      const now = new Date().toISOString();
      const info = db
        .prepare(
          "INSERT INTO employee_session (employee_id, engine, agent_dir, sessions_dir, workspace_dir, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(employeeId, engine, agentDir, sessionsDir, workspaceDir, now);
      return toEmployeeSession(
        /** @type {Record<string, unknown>} */ (
          db.prepare("SELECT * FROM employee_session WHERE id = ?").get(Number(info.lastInsertRowid))
        ),
      );
    },

    /**
     * Record the engine adapter's resume pointer (its session file).
     *
     * @param {{ employeeSessionId: number, sessionFile: string }} input
     */
    setEmployeeSessionFile({ employeeSessionId, sessionFile }) {
      db.prepare("UPDATE employee_session SET session_file = ?, updated_at = ? WHERE id = ?").run(
        sessionFile,
        new Date().toISOString(),
        employeeSessionId,
      );
    },

    /** @param {number} employeeSessionId @returns {EmployeeSessionRow | null} */
    employeeSessionById(employeeSessionId) {
      const row = db.prepare("SELECT * FROM employee_session WHERE id = ?").get(employeeSessionId);
      return row ? toEmployeeSession(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /**
     * @param {{ employeeId: number, employeeSessionId: number, engine: string, prompt: string, taskId?: number | null, taskSessionId?: number | null }} input
     * @returns {RunRow}
     */
    createRun({ employeeId, employeeSessionId, engine, prompt, taskId, taskSessionId }) {
      const startedAt = new Date().toISOString();
      const info = db
        .prepare(
          "INSERT INTO run (employee_session_id, employee_id, engine, status, prompt, started_at, task_id, task_session_id) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)",
        )
        .run(employeeSessionId, employeeId, engine, prompt, startedAt, taskId ?? null, taskSessionId ?? null);
      return toRun(/** @type {Record<string, unknown>} */ (db.prepare("SELECT * FROM run WHERE id = ?").get(Number(info.lastInsertRowid))));
    },

    /**
     * @param {{ runId: number, status: "completed" | "aborted" | "failed" | "interrupted" | "paused", usage?: import("./engine/events.mjs").Usage | null, failReason?: string | null }} input
     * @returns {RunRow}
     */
    finishRun({ runId, status, usage, failReason }) {
      if (!TERMINAL_RUN_STATUSES.has(status)) {
        throw appError("invalid_payload", `run cannot finish with status ${status}`);
      }
      // 票 12: usage 的三态在这里定型 —— 引擎报了什么就存什么（全 0 也是「计量到 0」），
      // 只有「从没报过」才留 null（未计量）。把 0 塌回 null 会毁掉缺失/0 的区分。
      const usageJson = usage ? JSON.stringify(usage) : null;
      const info = db
        .prepare("UPDATE run SET status = ?, ended_at = ?, usage = ?, fail_reason = ? WHERE id = ? AND status = 'running'")
        .run(status, new Date().toISOString(), usageJson, failReason ?? null, runId);
      if (info.changes !== 1) {
        throw appError("run_already_settled", `run ${runId} was no longer running when it tried to finish as ${status}`);
      }
      const row = db.prepare("SELECT * FROM run WHERE id = ?").get(runId);
      if (!row) throw appError("unknown_run", `no run with id ${runId}`);
      return toRun(/** @type {Record<string, unknown>} */ (row));
    },

    /** @param {number} employeeId @returns {RunRow | null} */
    latestRunForEmployee(employeeId) {
      const row = db.prepare("SELECT * FROM run WHERE employee_id = ? ORDER BY id DESC LIMIT 1").get(employeeId);
      return row ? toRun(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /** @param {number} runId @returns {RunRow | null} */
    runById(runId) {
      const row = db.prepare("SELECT * FROM run WHERE id = ?").get(runId);
      return row ? toRun(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /**
     * The project group an employee sits in (their tasks live there).
     *
     * @param {number} employeeId
     * @returns {number | null}
     */
    groupOfEmployee(employeeId) {
      const row = db
        .prepare("SELECT d.group_id AS g FROM employee e JOIN desk d ON d.employee_id = e.id WHERE e.id = ?")
        .get(employeeId);
      return row ? Number(/** @type {Record<string, unknown>} */ (row).g) : null;
    },

    // — tasks (ticket 05: 工单与产出) —

    /**
     * A work order: the goal + editable acceptance criteria the boss
     * approved, the employee that owns it, and the git start HEAD recorded
     * at creation (every later diff is relative to this point).
     *
     * @param {{ groupId: number, employeeId: number, workspaceDir: string, title: string, goal: string, playbook: string, acceptance: string[], baseHead: string, tokenBudget?: number }} input
     * @returns {TaskRow}
     */
    createTask({ groupId, employeeId, workspaceDir, title, goal, playbook, acceptance, baseHead, tokenBudget }) {
      if (!db.prepare("SELECT id FROM project_group WHERE id = ?").get(groupId)) {
        throw appError("unknown_group", `no project group with id ${groupId}`);
      }
      if (!db.prepare("SELECT id FROM employee WHERE id = ?").get(employeeId)) {
        throw appError("unknown_employee", `no employee with id ${employeeId}`);
      }
      const budget =
        typeof tokenBudget === "number" && Number.isInteger(tokenBudget) && tokenBudget > 0
          ? tokenBudget
          : DEFAULT_TASK_TOKEN_BUDGET;
      const createdAt = new Date().toISOString();
      const info = db
        .prepare(
          "INSERT INTO task (group_id, employee_id, workspace_dir, title, goal, playbook, acceptance, base_head, status, token_budget, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
        )
        .run(
          groupId,
          employeeId,
          workspaceDir,
          title,
          goal,
          playbook,
          JSON.stringify(Array.isArray(acceptance) ? acceptance.map(String) : []),
          baseHead,
          budget,
          createdAt,
        );
      return toTask(/** @type {Record<string, unknown>} */ (db.prepare("SELECT * FROM task WHERE id = ?").get(Number(info.lastInsertRowid))));
    },

    /** @param {number} taskId @returns {TaskRow | null} */
    taskById(taskId) {
      const row = db.prepare("SELECT * FROM task WHERE id = ?").get(taskId);
      return row ? toTask(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /** @param {{ groupId: number }} input @returns {TaskRowWithEmployee[]} newest first */
    listTasks({ groupId }) {
      const rows = db
        .prepare(
          `SELECT t.*, e.name AS e_name,
            (SELECT ts.status FROM task_session ts WHERE ts.task_id = t.id ORDER BY ts.id DESC LIMIT 1) AS latest_session_status
           FROM task t JOIN employee e ON e.id = t.employee_id
           WHERE t.group_id = ? ORDER BY t.id DESC`,
        )
        .all(groupId);
      return rows.map((row) => ({
        ...toTask(/** @type {Record<string, unknown>} */ (row)),
        employeeName: String(/** @type {Record<string, unknown>} */ (row).e_name),
      }));
    },

    /**
     * Every task across EVERY project group of one company (票 08: 右把手按
     * 公司看三段列表；工单台仍按组看)。Newest first.
     *
     * @param {{ companyId: number }} input @returns {TaskRowWithEmployee[]}
     */
    listTasksForCompany({ companyId }) {
      const rows = db
        .prepare(
          `SELECT t.*, e.name AS e_name,
            (SELECT ts.status FROM task_session ts WHERE ts.task_id = t.id ORDER BY ts.id DESC LIMIT 1) AS latest_session_status
           FROM task t
           JOIN employee e ON e.id = t.employee_id
           JOIN project_group g ON g.id = t.group_id
           WHERE g.company_id = ? ORDER BY t.id DESC`,
        )
        .all(companyId);
      return rows.map((row) => ({
        ...toTask(/** @type {Record<string, unknown>} */ (row)),
        employeeName: String(/** @type {Record<string, unknown>} */ (row).e_name),
      }));
    },

    /**
     * Active work-order counts per company — 进行中 + 待验收 — aggregated
     * across every project group of the company (票 08: 公司切换器显示各公司
     * 活跃数). Companies without tasks read 0/0, so the UI never guesses.
     *
     * @returns {Record<string, CompanyTaskCounts>} keyed by companyId (string
     *   because JSON map keys are strings; Number() them back at the seam).
     */
    companyTaskCounts() {
      const rows = db
        .prepare(
          `SELECT g.company_id AS cid, t.status AS status, COUNT(*) AS n
           FROM task t JOIN project_group g ON g.id = t.group_id
           WHERE t.status IN ('running', 'review')
           GROUP BY g.company_id, t.status`,
        )
        .all();
      /** @type {Map<number, CompanyTaskCounts>} */
      const byCompany = new Map();
      const bucket = (/** @type {number} */ companyId) => {
        let entry = byCompany.get(companyId);
        if (!entry) {
          entry = { running: 0, review: 0 };
          byCompany.set(companyId, entry);
        }
        return entry;
      };
      for (const raw of rows) {
        const row = /** @type {Record<string, unknown>} */ (raw);
        const entry = bucket(Number(row.cid));
        if (String(row.status) === "running") entry.running += Number(row.n);
        else entry.review += Number(row.n);
      }
      /** @type {Record<string, CompanyTaskCounts>} */
      const counts = {};
      for (const company of db.prepare("SELECT id FROM company ORDER BY id").all()) {
        const companyId = Number(/** @type {Record<string, unknown>} */ (company).id);
        counts[String(companyId)] = bucket(companyId);
      }
      return counts;
    },

    /**
     * The 中断的任务 list (ticket 10: 强杀/崩溃重启后等用户三选). A task is
     * interrupted when its LATEST task_session is 'interrupted' while the task
     * itself is still open (crash-healed back to 待办) or running (crash after
     * 上班续跑 — the 09 heal keeps it 进行中). Tasks whose latest session is
     * paused belong to the 09 badge story, not this list; review/done/failed
     * are closed chapters.
     *
     * Each row carries what the 三选 needs without another query: the engine
     * (capability lookup), the employee session's resume pointer (a lost
     * pointer means 「只能重跑」), the iteration count, and when the crash
     * closed the session (interruptedAt). Newest first.
     *
     * @param {{ companyId: number }} input
     * @returns {(TaskRowWithEmployee & { engine: string, sessionFile: string | null, iterations: number, interruptedAt: string | null })[]}
     */
    listInterruptedTasks({ companyId }) {
      const rows = db
        .prepare(
          `SELECT t.*, e.name AS e_name,
            ls.status AS latest_session_status,
            ls.engine AS engine,
            ls.ended_at AS interrupted_at,
            es.session_file AS session_file,
            (SELECT COUNT(*) FROM task_session c WHERE c.task_id = t.id) AS iterations
           FROM task t
           JOIN employee e ON e.id = t.employee_id
           JOIN project_group g ON g.id = t.group_id
           JOIN task_session ls ON ls.id = (
             SELECT ts.id FROM task_session ts WHERE ts.task_id = t.id ORDER BY ts.id DESC LIMIT 1
           )
           LEFT JOIN employee_session es ON es.id = ls.employee_session_id
           WHERE g.company_id = ?
             AND t.status IN ('open', 'running')
             AND ls.status = 'interrupted'
           ORDER BY t.id DESC`,
        )
        .all(companyId);
      return rows.map((raw) => {
        const row = /** @type {Record<string, unknown>} */ (raw);
        return {
          ...toTask(row),
          employeeName: String(row.e_name),
          engine: String(row.engine),
          sessionFile: row.session_file === null || row.session_file === undefined ? null : String(row.session_file),
          iterations: Number(row.iterations),
          interruptedAt: row.interrupted_at === null || row.interrupted_at === undefined ? null : String(row.interrupted_at),
        };
      });
    },

    /**
     * The only door to a task's status: the five-state transition map makes
     * illegal jumps (待办→完成, 完成→任何) impossible at the host, so the UI
     * only ever displays states and triggers legal ones (票 06 验收 5).
     *
     * @param {number} taskId
     * @param {TaskStatus} status
     * @returns {TaskRow}
     */
    setTaskStatus(taskId, status) {
      if (!Object.hasOwn(TASK_TRANSITIONS, status)) {
        throw appError("invalid_payload", `task cannot have status ${status}`);
      }
      const row = db.prepare("SELECT * FROM task WHERE id = ?").get(taskId);
      if (!row) throw appError("unknown_task", `no task with id ${taskId}`);
      const current = toTask(/** @type {Record<string, unknown>} */ (row)).status;
      if (!TASK_TRANSITIONS[current].includes(status)) {
        throw appError("invalid_transition", `任务状态不能从 ${current} 直接跳到 ${status}`);
      }
      db.prepare("UPDATE task SET status = ? WHERE id = ?").run(status, taskId);
      return toTask(/** @type {Record<string, unknown>} */ (db.prepare("SELECT * FROM task WHERE id = ?").get(taskId)));
    },

    /**
     * One transaction for the whole "a task run begins" story: legal state
     * transition + task_session row + run row. Any failure rolls all three
     * back, so a rejected dispatch can never leave a task 进行中 with no run
     * (or a half-written session) behind — the ticket-06 "no dangling rows"
     * rule made structural.
     *
     * @param {{ taskId: number, employeeSessionId: number, engine: string, prompt: string, resume?: boolean }} input
     * @returns {{ task: TaskRow, taskSession: TaskSessionRow, run: RunRow }}
     */
    beginTaskRun({ taskId, employeeSessionId, engine, prompt, resume = false }) {
      db.exec("BEGIN");
      try {
        const task = this.taskById(taskId);
        if (!task) throw appError("unknown_task", `no task with id ${taskId}`);
        if (resume) {
          if (task.status !== "running") {
            if (task.status === "open" && this.latestTaskSessionForTask(taskId)?.status === "interrupted") {
              this.setTaskStatus(taskId, "running");
            } else {
              throw appError(
                "invalid_transition",
                `只有「进行中」（含下班暂停）或崩溃中断落回待办的任务能续跑，这张是 ${task.status}`,
              );
            }
          }
        } else {
          this.setTaskStatus(taskId, "running");
        }
        const taskSession = this.openTaskSession({ taskId, employeeSessionId, engine });
        const run = this.createRun({
          employeeId: task.employeeId,
          employeeSessionId,
          engine,
          prompt,
          taskId,
          taskSessionId: taskSession.id,
        });
        db.exec("COMMIT");
        return { task: /** @type {TaskRow} */ (this.taskById(taskId)), taskSession, run };
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    /**
     * The task-level Session entity (GLOSSARY: 会话挂在任务下，可多条):
     * one per dispatch/retry, wrapping the engine run and its outcome.
     *
     * @param {{ taskId: number, employeeSessionId: number, engine: string }} input
     * @returns {TaskSessionRow}
     */
    openTaskSession({ taskId, employeeSessionId, engine }) {
      const startedAt = new Date().toISOString();
      const info = db
        .prepare(
          "INSERT INTO task_session (task_id, employee_session_id, engine, status, started_at) VALUES (?, ?, ?, 'running', ?)",
        )
        .run(taskId, employeeSessionId, engine, startedAt);
      return toTaskSession(
        /** @type {Record<string, unknown>} */ (db.prepare("SELECT * FROM task_session WHERE id = ?").get(Number(info.lastInsertRowid))),
      );
    },

    /**
     * @param {{ taskSessionId: number, status: "completed" | "aborted" | "failed" | "interrupted" | "paused" }} input
     * @returns {TaskSessionRow}
     */
    finishTaskSession({ taskSessionId, status }) {
      if (!TERMINAL_RUN_STATUSES.has(status)) {
        throw appError("invalid_payload", `task session cannot finish with status ${status}`);
      }
      const info = db.prepare("UPDATE task_session SET status = ?, ended_at = ? WHERE id = ? AND status = 'running'").run(
        status,
        new Date().toISOString(),
        taskSessionId,
      );
      if (info.changes !== 1) {
        throw appError(
          "task_session_already_settled",
          `task session ${taskSessionId} was no longer running when it tried to finish as ${status}`,
        );
      }
      const row = db.prepare("SELECT * FROM task_session WHERE id = ?").get(taskSessionId);
      if (!row) throw appError("unknown_task_session", `no task session with id ${taskSessionId}`);
      return toTaskSession(/** @type {Record<string, unknown>} */ (row));
    },

    /** @param {number} taskId @returns {TaskSessionRow | null} */
    latestTaskSessionForTask(taskId) {
      const row = db.prepare("SELECT * FROM task_session WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(taskId);
      return row ? toTaskSession(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /**
     * All sessions of a task (oldest first), each carrying the employee
     * session's current resume pointer so the UI can show 恢复指针.
     *
     * @param {number} taskId
     * @returns {TaskSessionRow[]}
     */
    listTaskSessions(taskId) {
      const rows = db
        .prepare(
          `SELECT ts.*, es.session_file AS session_file FROM task_session ts
           LEFT JOIN employee_session es ON es.id = ts.employee_session_id
           WHERE ts.task_id = ? ORDER BY ts.id`,
        )
        .all(taskId);
      return rows.map((row) => toTaskSession(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * One of the four deliverables a finished task run leaves behind.
     *
     * @param {{ taskId: number, runId: number | null, kind: "diff_summary" | "changed_files" | "command_output" | "report", content: string }} input
     * @returns {ArtifactRow}
     */
    createArtifact({ taskId, runId, kind, content }) {
      if (!["diff_summary", "changed_files", "command_output", "report"].includes(kind)) {
        throw appError("invalid_payload", `unknown artifact kind ${kind}`);
      }
      const createdAt = new Date().toISOString();
      const info = db
        .prepare("INSERT INTO artifact (task_id, run_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(taskId, runId ?? null, kind, content, createdAt);
      return toArtifact(
        /** @type {Record<string, unknown>} */ (db.prepare("SELECT * FROM artifact WHERE id = ?").get(Number(info.lastInsertRowid))),
      );
    },

    /** @param {{ taskId: number, latestRunOnly?: boolean }} input @returns {ArtifactRow[]} creation order */
    listArtifacts({ taskId, latestRunOnly = false }) {
      if (latestRunOnly) {
        const latest = db
          .prepare("SELECT id FROM run WHERE task_id = ? AND status <> 'running' ORDER BY id DESC LIMIT 1")
          .get(taskId);
        if (!latest) return [];
        const rows = db
          .prepare("SELECT * FROM artifact WHERE task_id = ? AND run_id = ? ORDER BY id")
          .all(taskId, Number(/** @type {Record<string, unknown>} */ (latest).id));
        return rows.map((row) => toArtifact(/** @type {Record<string, unknown>} */ (row)));
      }
      const rows = db.prepare("SELECT * FROM artifact WHERE task_id = ? ORDER BY id").all(taskId);
      return rows.map((row) => toArtifact(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * The task's token bill (票 06: 侧边栏展示本任务 token; 票 12: + 未计量三态):
     * every run of every iteration of the task, with its engine-reported usage
     * summed. `measured=false` means no run of this task ever reported usage —
     * the UI must show 「未计量」, not 0 (验收 5: 缺失与 0 严格区分).
     *
     * @param {number} taskId
     * @returns {{ input: number, cachedInput: number, cacheWrite: number, output: number, reasoning: number, total: number, measured: boolean }}
     */
    taskTokenSummary(taskId) {
      const rows = db
        .prepare("SELECT usage FROM run WHERE task_id = ?")
        .all(taskId);
      const summary = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, measured: false };
      for (const row of rows) {
        const usage = parseUsage(/** @type {Record<string, unknown>} */ (row).usage);
        if (!usage) continue;
        summary.measured = true;
        summary.input += usage.input;
        summary.cachedInput += usage.cachedInput;
        summary.cacheWrite += usage.cacheWrite;
        summary.output += usage.output;
        summary.reasoning += usage.reasoning;
      }
      summary.total = summary.input + summary.cachedInput + summary.cacheWrite + summary.output + summary.reasoning;
      return summary;
    },

    // — 失败与成本 (ticket 12: 人话失败原因 / 任务预算 / 三层 token 聚合) —

    /**
     * 票 12 验收 1: the human reason of the task's LATEST session's run.
     * Only failed/aborted runs carry a reason, so a retry that is running or
     * completed naturally reads null — the failure box only renders for a
     * failed task anyway. Reads back through the session (one owner of the
     * run lifecycle: the run manager), so the UI never re-derives anything.
     *
     * @param {number} taskId
     * @returns {string | null}
     */
    latestFailReasonForTask(taskId) {
      const row = db
        .prepare(
          `SELECT r.fail_reason AS fr
           FROM task_session ts LEFT JOIN run r ON r.task_session_id = ts.id
           WHERE ts.task_id = ? ORDER BY ts.id DESC LIMIT 1`,
        )
        .get(taskId);
      if (!row) return null;
      const reason = /** @type {Record<string, unknown>} */ (row).fr;
      return reason === null || reason === undefined ? null : String(reason);
    },

    /**
     * 「+50%」 lands here: raise THIS task's budget (落库、可再审). Validation of
     * the 1.5× step lives in cost/budget.mjs (pure); this is the write.
     *
     * @param {number} taskId
     * @param {number} tokenBudget
     * @returns {TaskRow}
     */
    setTaskTokenBudget(taskId, tokenBudget) {
      if (typeof tokenBudget !== "number" || !Number.isInteger(tokenBudget) || tokenBudget <= 0) {
        throw appError("invalid_payload", "tokenBudget must be a positive integer");
      }
      const changes = db.prepare("UPDATE task SET token_budget = ? WHERE id = ?").run(tokenBudget, taskId).changes;
      if (changes !== 1) throw appError("unknown_task", `no task with id ${taskId}`);
      return /** @type {TaskRow} */ (this.taskById(taskId));
    },

    /**
     * 票 12 验收 3: employee-level token aggregation (员工名牌数据源).
     * Employees who never ran — or only ran on unmeasured engines — read
     * measured=false: 「未计量」, never a fake 0.
     *
     * @returns {Record<string, TokenTotal>} keyed by employeeId (string keys at the envelope)
     */
    employeeTokenTotals() {
      const rows = db.prepare("SELECT employee_id AS bucket_id, usage FROM run").all();
      return foldTokenTotals(db, "employee", rows, (row) => Number(/** @type {Record<string, unknown>} */ (row).bucket_id));
    },

    /**
     * 票 12 验收 3: company-level token aggregation (公司面板数据源) — every run
     * under every employee of the company.
     *
     * @returns {Record<string, TokenTotal>} keyed by companyId (string keys at the envelope)
     */
    companyTokenTotals() {
      const rows = db
        .prepare("SELECT e.company_id AS bucket_id, r.usage AS usage FROM run r JOIN employee e ON e.id = r.employee_id")
        .all();
      return foldTokenTotals(db, "company", rows, (row) => Number(/** @type {Record<string, unknown>} */ (row).bucket_id));
    },

    // — 上下班 (ticket 09: 时间表落库可改 / override 独立 / 相位可恢复) —

    /**
     * The company's 上下班 timetable row, or null when nobody configured one
     * (the duty layer supplies the default; the store never invents rows).
     *
     * @param {number} companyId
     * @returns {ScheduleRow | null}
     */
    getCompanySchedule(companyId) {
      const row = db.prepare("SELECT * FROM company_schedule WHERE company_id = ?").get(companyId);
      return row ? toSchedule(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /**
     * Upsert: one timetable row per company, edited in place (票 09 验收 1:
     * 可配上下班时刻，落库可改). Validation lives in the duty layer.
     *
     * @param {{ companyId: number, workStart: string, workEnd: string, graceSeconds: number }} input
     * @returns {ScheduleRow}
     */
    upsertCompanySchedule({ companyId, workStart, workEnd, graceSeconds }) {
      if (!db.prepare("SELECT id FROM company WHERE id = ?").get(companyId)) {
        throw appError("unknown_company", `no company with id ${companyId}`);
      }
      const updatedAt = new Date().toISOString();
      db
        .prepare(
          `INSERT INTO company_schedule (company_id, work_start, work_end, grace_seconds, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(company_id) DO UPDATE SET
             work_start = excluded.work_start, work_end = excluded.work_end,
             grace_seconds = excluded.grace_seconds, updated_at = excluded.updated_at`,
        )
        .run(companyId, workStart, workEnd, graceSeconds, updatedAt);
      return /** @type {ScheduleRow} */ (this.getCompanySchedule(companyId));
    },

    /** @param {number} companyId @returns {DutyOverrideRow | null} */
    getDutyOverride(companyId) {
      const row = db.prepare("SELECT * FROM duty_override WHERE company_id = ?").get(companyId);
      if (!row) return null;
      const record = /** @type {Record<string, unknown>} */ (row);
      return {
        companyId: Number(record.company_id),
        mode: /** @type {"on" | "off"} */ (String(record.mode)),
        at: Number(record.at),
      };
    },

    // — engine admission state (ticket 11: 徽章三态 + 准入探针 + 风险启用) —

    /**
     * @param {string} engine
     * @returns {EngineStateRow | null}
     */
    engineState(engine) {
      const row = db.prepare("SELECT * FROM engine_state WHERE engine = ?").get(engine);
      return row ? toEngineState(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /** @returns {EngineStateRow[]} */
    listEngineStates() {
      const rows = db.prepare("SELECT * FROM engine_state ORDER BY engine").all();
      return rows.map((row) => toEngineState(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * Record what engine detection (版本探测) learned about the binary.
     *
     * @param {{ engine: string, installed: boolean, version?: string | null }} input
     */
    setEngineInstalled({ engine, installed, version = null }) {
      db.prepare(
        `INSERT INTO engine_state (engine, installed, version, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(engine) DO UPDATE SET installed = excluded.installed, version = excluded.version, updated_at = excluded.updated_at`,
      ).run(engine, installed ? 1 : 0, version, new Date().toISOString());
    },

    /**
     * Persist an admission probe's four verdicts. A pass is an admission:
     * it enables the engine and clears any hand-enabled risk flag.
     *
     * @param {{ engine: string, status: "running" | "passed" | "failed", probe?: unknown }} input
     */
    setEngineProbeResult({ engine, status, probe }) {
      const now = new Date().toISOString();
      const json = probe === undefined ? null : JSON.stringify(probe);
      db.prepare(
        `INSERT INTO engine_state (engine, probe_status, probe_json, probe_at, enabled, manual_override, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?)
         ON CONFLICT(engine) DO UPDATE SET
           probe_status = excluded.probe_status,
           probe_json = COALESCE(excluded.probe_json, engine_state.probe_json),
           probe_at = excluded.probe_at,
           updated_at = excluded.updated_at`,
      ).run(engine, status, json, now, now);
      if (status === "passed") {
        db.prepare("UPDATE engine_state SET enabled = 1, manual_override = 0, updated_at = ? WHERE engine = ?").run(now, engine);
      }
    },

    /**
     * Enable/disable an engine. manualOverride marks a hand-enable after a
     * failed (or skipped) probe — the engine card must show it as a risk.
     *
     * @param {{ engine: string, enabled: boolean, manualOverride?: boolean }} input
     */
    setEngineEnabled({ engine, enabled, manualOverride = false }) {
      if (!db.prepare("SELECT engine FROM engine_state WHERE engine = ?").get(engine)) {
        throw appError("unknown_engine", `no engine state for ${engine}`);
      }
      db.prepare("UPDATE engine_state SET enabled = ?, manual_override = ?, updated_at = ? WHERE engine = ?").run(
        enabled ? 1 : 0,
        manualOverride ? 1 : 0,
        new Date().toISOString(),
        engine,
      );
    },

    /**
     * @param {string} name
     * @returns {(EmployeeOccupant & { role: RoleRow | null }) | null}
     */
    employeeByName(name) {
      const row = db
        .prepare("SELECT id, company_id, name, role_id, role_snapshot, appearance, hired_at FROM employee WHERE name = ?")
        .get(name);
      if (!row) return null;
      return employeeRecord(/** @type {Record<string, unknown>} */ (row));
    },

    /**
     * The manual override record (票 09 验收 2). Deliberately a different
     * table from the timetable: overriding never touches the schedule rows.
     *
     * @param {{ companyId: number, mode: "on" | "off", at: number }} input
     * @returns {DutyOverrideRow}
     */
    setDutyOverride({ companyId, mode, at }) {
      if (mode !== "on" && mode !== "off") throw appError("invalid_payload", `duty override mode must be on/off, got ${mode}`);
      db
        .prepare(
          `INSERT INTO duty_override (company_id, mode, at) VALUES (?, ?, ?)
           ON CONFLICT(company_id) DO UPDATE SET mode = excluded.mode, at = excluded.at`,
        )
        .run(companyId, mode, at);
      return /** @type {DutyOverrideRow} */ (this.getDutyOverride(companyId));
    },

    /** @param {number} companyId */
    clearDutyOverride(companyId) {
      db.prepare("DELETE FROM duty_override WHERE company_id = ?").run(companyId);
    },

    /** @param {number} companyId @returns {DutyStatusRow | null} */
    getDutyStatus(companyId) {
      const row = db.prepare("SELECT * FROM duty_status WHERE company_id = ?").get(companyId);
      return row ? toDutyStatus(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /**
     * The current duty phase, persisted so the view (and a restarting host)
     * never claims 上班中 while the schedule says otherwise.
     *
     * @param {{ companyId: number, phase: "on" | "grace" | "off", phaseSince: number, graceUntil?: number | null }} input
     * @returns {DutyStatusRow}
     */
    setDutyStatus({ companyId, phase, phaseSince, graceUntil }) {
      if (!["on", "grace", "off"].includes(phase)) {
        throw appError("invalid_payload", `duty phase must be on/grace/off, got ${phase}`);
      }
      db
        .prepare(
          `INSERT INTO duty_status (company_id, phase, phase_since, grace_until) VALUES (?, ?, ?, ?)
           ON CONFLICT(company_id) DO UPDATE SET
             phase = excluded.phase, phase_since = excluded.phase_since, grace_until = excluded.grace_until`,
        )
        .run(companyId, phase, phaseSince, graceUntil ?? null);
      return /** @type {DutyStatusRow} */ (this.getDutyStatus(companyId));
    },

    /**
     * Hidden desk-less employee used by the admission probe (ticket 11):
     * conversation plumbing works for it (run-manager only needs an
     * employee row) while the office view — driven by desks — never sees it.
     *
     * 票 a01: the marker persona / tools ride the dedicated probe role row
     * (source='probe', invisible to listRoles); the snapshot pins only the
     * probe engine / model / a small cost gate.
     *
     * @param {{ name: string, engine: string, persona: string, roleSnapshot: RoleSnapshot }} input
     * @returns {(EmployeeOccupant & { role: RoleRow | null })}
     */
    ensureProbeEmployee({ name, engine, persona, roleSnapshot }) {
      const existing = this.employeeByName(name);
      if (existing) {
        // Re-runs must not drift onto another engine mid-probe history: keep
        // one probe employee per engine.
        if (existing.roleSnapshot?.engine === engine) return existing;
      }
      const company = db.prepare("SELECT id FROM company ORDER BY id LIMIT 1").get();
      if (!company) throw appError("invalid_state", "probe employee needs a company");
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO role (key, name, tagline, manifest, domains, skills, mcp, source, synced_at, created_at)
         VALUES ('cubicle-probe', '探针', '引擎准入探针', ?, '[]', '[]', '[]', 'probe', ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           name = excluded.name,
           tagline = excluded.tagline,
           manifest = excluded.manifest,
           synced_at = excluded.synced_at`,
      ).run(
        JSON.stringify({
          persona,
          skills: [],
          tools: ["read", "powershell"],
          mcpServers: [],
          engine,
          model: "default",
          cost: { tokenBudgetPerTask: 50000 },
        }),
        now,
        now,
      );
      const role = db.prepare("SELECT id FROM role WHERE key = 'cubicle-probe'").get();
      if (!role) throw appError("invalid_state", "probe employee needs a role");
      const hiredAt = new Date().toISOString();
      const info = db
        .prepare("INSERT INTO employee (company_id, name, role_id, role_snapshot, hired_at) VALUES (?, ?, ?, ?, ?)")
        .run(Number(company.id), name, Number(role.id), JSON.stringify(roleSnapshot), hiredAt);
      const hired = db
        .prepare("SELECT id, company_id, name, role_id, role_snapshot, appearance, hired_at FROM employee WHERE id = ?")
        .get(Number(info.lastInsertRowid));
      return employeeRecord(/** @type {Record<string, unknown>} */ (hired));
    },

    /**
     * Switch an employee's engine by rewriting the frozen role snapshot's
     * engine pin — the snapshot stays frozen for everything else
     * (decision 02: 入职冻结, but the ticket-11 switch is an explicit act).
     *
     * @param {{ employeeId: number, engine: string }} input
     * @returns {(EmployeeOccupant & { role: RoleRow | null })}
     */
    setEmployeeEngine({ employeeId, engine }) {
      const row = db.prepare("SELECT role_snapshot FROM employee WHERE id = ?").get(employeeId);
      if (!row) throw appError("unknown_employee", `no employee with id ${employeeId}`);
      const snapshot = /** @type {any} */ (parseJsonOr(row.role_snapshot, {}));
      snapshot.engine = engine;
      db.prepare("UPDATE employee SET role_snapshot = ? WHERE id = ?").run(JSON.stringify(snapshot), employeeId);
      return /** @type {any} */ (this.employeeById(employeeId));
    },

    /**
     * Edit an employee's name / look / engine / provider / model / reasoning
     * effort (ticket 14 + 18). Only provided fields are touched; the rest of
     * the frozen snapshot stays frozen.
     *
     * @param {{ employeeId: number, name?: string, appearance?: string | null, engine?: string, provider?: string, model?: string, reasoningEffort?: string | null }} input
     */
    updateEmployee({ employeeId, name, appearance, engine, provider, model, reasoningEffort }) {
      const row = db
        .prepare("SELECT name, role_snapshot FROM employee WHERE id = ?")
        .get(employeeId);
      if (!row) throw appError("unknown_employee", `no employee with id ${employeeId}`);
      const record = /** @type {Record<string, unknown>} */ (row);
      const snapshot = /** @type {any} */ (parseJsonOr(record.role_snapshot, {}));
      if (name !== undefined) {
        const trimmed = name.trim();
        if (trimmed.length === 0) throw appError("invalid_payload", "员工名字不能为空");
        if (trimmed.length > 40) throw appError("invalid_payload", "员工名字最多 40 个字符");
      }
      if (engine !== undefined) snapshot.engine = engine;
      if (provider !== undefined) snapshot.provider = provider;
      if (model !== undefined) snapshot.model = model;
      if (reasoningEffort !== undefined) {
        if (reasoningEffort === null) delete snapshot.reasoningEffort;
        else snapshot.reasoningEffort = reasoningEffort;
      }
      db.prepare("UPDATE employee SET name = ?, role_snapshot = ?, appearance = COALESCE(?, appearance) WHERE id = ?").run(
        name !== undefined ? name.trim() : String(record.name),
        JSON.stringify(snapshot),
        appearance ?? null,
        employeeId,
      );
      return /** @type {any} */ (this.employeeById(employeeId));
    },

    /**
     * The project group the view currently follows, without building a whole
     * office snapshot (that would run two full token aggregations).
     *
     * @returns {number | null}
     */
    activeGroupId() {
      const active = readActive(db);
      const groups = this.listGroups({ companyId: active.companyId });
      const chosen = active.groups[active.companyId];
      if (groups.some((group) => group.id === chosen)) return chosen;
      return groups.at(-1)?.id ?? null;
    },

    /**
     * Remember which company / project group the office view follows.
     * Partial updates are allowed: pass companyId, groupId, or both.
     *
     * @param {{ companyId?: number, groupId?: number }} selection
     */
    setActive({ companyId, groupId }) {
      const current = readActive(db);
      const next = {
        companyId: companyId ?? current.companyId,
        groups: { ...current.groups },
      };
      if (groupId !== undefined) {
        if (companyId === undefined) throw appError("invalid_payload", "groupId requires companyId");
        next.groups[companyId] = groupId;
      }
      writeActive(db, next);
    },

    /**
     * @returns {OfficeSnapshot}
     */
    officeSnapshot() {
      const companies = db.prepare("SELECT * FROM company ORDER BY id").all().map((row) =>
        toCompany(/** @type {Record<string, unknown>} */ (row)),
      );
      const active = readActive(db);
      let activeCompanyId = companies.some((c) => c.id === active.companyId)
        ? active.companyId
        : (companies[0]?.id ?? 0);
      const groups = this.listGroups({ companyId: activeCompanyId });
      const chosen = active.groups[activeCompanyId];
      const activeGroupId = groups.some((g) => g.id === chosen)
        ? chosen
        : (groups.at(-1)?.id ?? null);
      const desks = activeGroupId === null ? [] : this.listDesks({ groupId: activeGroupId });
      return {
        companies,
        activeCompanyId,
        groups,
        activeGroupId,
        desks,
        taskCounts: this.companyTaskCounts(),
        // 票 12: 员工级/公司级 token 聚合随快照走（host 聚合走信封，视图只读）。
        employeeTokens: this.employeeTokenTotals(),
        companyTokens: this.companyTokenTotals(),
      };
    },

    close() {
      db.close();
    },
  };
}

/**
 * One employee → one workspace. Pre-fix databases had
 * `engines/<engine>/employee-<id>/workspace` per engine; a task created under
 * pi then dispatched after switching to codex ran in a different, empty repo.
 * Move the current engine's workspace to `<dataDir>/workspaces/employee-<id>`,
 * point every engine session at it, and rewrite the tasks that were recorded
 * in the moved directory. Best-effort: a locked workspace is copied, not
 * deleted; the old directory is left for the user.
 *
 * @param {DatabaseSync} db
 * @param {string} dataDir
 */
function migrateEmployeeWorkspaces(db, dataDir) {
  const employees = db.prepare("SELECT id, role_snapshot FROM employee").all();
  if (employees.length === 0) return;
  const sessionsFor = db.prepare("SELECT id, engine, workspace_dir FROM employee_session WHERE employee_id = ?");
  const updateSessions = db.prepare("UPDATE employee_session SET workspace_dir = ?, updated_at = ? WHERE employee_id = ?");
  const updateTasks = db.prepare("UPDATE task SET workspace_dir = ? WHERE employee_id = ? AND workspace_dir = ?");
  const now = new Date().toISOString();

  for (const raw of employees) {
    const employeeId = Number(/** @type {Record<string, unknown>} */ (raw).id);
    const stable = path.join(dataDir, "workspaces", `employee-${employeeId}`);
    const sessions = sessionsFor.all(employeeId).map((row) => ({
      engine: String(/** @type {Record<string, unknown>} */ (row).engine),
      workspaceDir: String(/** @type {Record<string, unknown>} */ (row).workspace_dir ?? ""),
    }));
    if (sessions.length === 0) continue;
    if (sessions.every((session) => session.workspaceDir === stable)) continue;

    const snapshot = /** @type {any} */ (parseJsonOr(/** @type {Record<string, unknown>} */ (raw).role_snapshot, UNKNOWN_ROLE_SNAPSHOT));
    // 票 a01: engine is a top-level snapshot pin (v1 kept it under manifest —
    // this migration runs right after the snapshot upgrade, but stay tolerant).
    const currentEngine = snapshot?.engine ?? snapshot?.manifest?.engine ?? "pi";
    const preferred =
      sessions.find((session) => session.engine === currentEngine && existsSync(session.workspaceDir)) ??
      sessions.find((session) => existsSync(session.workspaceDir));
    let movedFrom = null;
    if (!existsSync(stable) && preferred) {
      try {
        mkdirSync(path.dirname(stable), { recursive: true });
        renameSync(preferred.workspaceDir, stable);
        movedFrom = preferred.workspaceDir;
      } catch {
        try {
          cpSync(preferred.workspaceDir, stable, { recursive: true });
          movedFrom = preferred.workspaceDir;
        } catch {
          // a locked old workspace: keep the old path, just repoint sessions
        }
      }
    }
    if (!existsSync(stable)) mkdirSync(stable, { recursive: true });
    updateSessions.run(stable, now, employeeId);
    if (movedFrom) updateTasks.run(stable, employeeId, movedFrom);
  }
}

/**
 * Ticket 18 adds the employee's chosen look (a preset id) to a table that
 * already exists in older databases. NULL means "not chosen", which the
 * renderer maps to the role's default face.
 *
 * @param {DatabaseSync} db
 */
function migrateEmployeeAppearance(db) {
  const columns = tableColumns(db, "employee");
  if (!columns.has("appearance")) db.exec("ALTER TABLE employee ADD COLUMN appearance TEXT");
}

/**
 * 票 a01: the role table becomes a projection cache of Neo. Older databases
 * gain the cache columns in place (SQLite cannot attach a CHECK via ALTER —
 * the fresh schema declares it, and every writer here only uses the three
 * known source states).
 *
 * @param {DatabaseSync} db
 */
function migrateRoleProjectionColumns(db) {
  const columns = tableColumns(db, "role");
  if (!columns.has("domains")) db.exec("ALTER TABLE role ADD COLUMN domains TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has("skills")) db.exec("ALTER TABLE role ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has("mcp")) db.exec("ALTER TABLE role ADD COLUMN mcp TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has("source")) db.exec("ALTER TABLE role ADD COLUMN source TEXT NOT NULL DEFAULT 'preset'");
  if (!columns.has("synced_at")) db.exec("ALTER TABLE role ADD COLUMN synced_at TEXT");
}

/**
 * 票 a01: rewrite pre-academy employee snapshots (v1: a whole copied manifest)
 * into the version-pin shape (v2). Same one-shot-in-place style as the old
 * role-manifest upgrade: v2 rows are left byte-identical (the ticket-03
 * restart check compares hire-time bytes), and an unreadable row is left for
 * parseJsonOr to degrade at read time rather than rewritten into a lie.
 *
 * @param {DatabaseSync} db
 */
function migrateRoleSnapshotsToV2(db) {
  const rows = db.prepare("SELECT id, role_snapshot FROM employee").all();
  const update = db.prepare("UPDATE employee SET role_snapshot = ? WHERE id = ?");
  for (const raw of rows) {
    const row = /** @type {Record<string, unknown>} */ (raw);
    const current = parseJsonOr(row.role_snapshot, null);
    if (current === null || typeof current !== "object" || Array.isArray(current)) continue;
    const legacy = /** @type {Record<string, unknown>} */ (current);
    if (typeof legacy.roleKey === "string" && legacy.manifest === undefined) continue; // already v2
    update.run(JSON.stringify(upgradeRoleSnapshot(legacy)), Number(row.id));
  }
}

/**
 * v1 → v2 snapshot translation. v1 froze the whole manifest (persona, skills,
 * tools, tagline); v2 pins identity + versions + the model choice only —
 * persona 与技能正文不再进快照（内容归角色行 / 学院）。v1 没有 hash 可钉，
 * locks 留空而不是凭空造 hash。
 *
 * @param {Record<string, unknown>} legacy
 * @returns {RoleSnapshot}
 */
function upgradeRoleSnapshot(legacy) {
  const manifest =
    typeof legacy.manifest === "object" && legacy.manifest !== null && !Array.isArray(legacy.manifest)
      ? /** @type {Record<string, unknown>} */ (legacy.manifest)
      : {};
  /** @type {RoleSnapshot} */
  const snapshot = {
    roleKey: String(legacy.roleKey ?? legacy.key ?? "unknown"),
    domains: [],
    locks: {},
    engine: typeof manifest.engine === "string" ? manifest.engine : "pi",
    model: typeof manifest.model === "string" ? manifest.model : "default",
    cost:
      typeof manifest.cost === "object" && manifest.cost !== null && !Array.isArray(manifest.cost)
        ? /** @type {{ tokenBudgetPerTask: number }} */ (manifest.cost)
        : { tokenBudgetPerTask: DEFAULT_TASK_TOKEN_BUDGET },
  };
  if (typeof manifest.provider === "string" && manifest.provider.length > 0) snapshot.provider = manifest.provider;
  if (typeof manifest.reasoningEffort === "string" && manifest.reasoningEffort.length > 0) {
    snapshot.reasoningEffort = manifest.reasoningEffort;
  }
  return snapshot;
}

/**
 * @param {DatabaseSync} db
 * @param {string} table
 * @returns {Set<string>}
 */
function tableColumns(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((row) => String(/** @type {Record<string, unknown>} */ (row).name)));
}

/**
 * Migrations rebuild tables by hand; a missing column would otherwise be a
 * silent runtime failure far from the schema. Assert the contract at open.
 *
 * @param {DatabaseSync} db
 */
function assertRequiredColumns(db) {
  /** @type {Record<string, string[]>} */
  const required = {
    task: ["group_id", "employee_id", "workspace_dir", "status", "base_head", "token_budget"],
    task_session: ["task_id", "employee_session_id", "engine", "status"],
    run: ["employee_session_id", "employee_id", "engine", "status", "usage", "task_id", "task_session_id", "fail_reason"],
    employee_session: ["employee_id", "engine", "agent_dir", "sessions_dir", "workspace_dir", "session_file"],
    employee: ["appearance"],
    role: ["domains", "skills", "mcp", "source", "synced_at"],
    artifact: ["task_id", "run_id", "kind", "content"],
  };
  for (const [table, columns] of Object.entries(required)) {
    const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(/** @type {Record<string, unknown>} */ (row).name)));
    for (const column of columns) {
      if (!present.has(column)) throw new Error(`store schema drift: ${table}.${column} is missing after migrations`);
    }
  }
}

/**
 * Runs left 'running' belong to a host that is no longer alive: close that
 * chapter before any new host starts. Ticket 10 (crash recovery) builds the
 * resume story on top of this marker. Task sessions follow their runs, and
 * a task whose session was interrupted goes back to 'open' so the boss can
 * dispatch it again (ticket 06 will add the richer retry story).
 *
 * 票 09: a task parked by 下班 (its latest task_session is 'paused') is NOT
 * a crash leftover — it deliberately stays 进行中 with a 暂停 badge, and
 * 上班续跑 appends the next session. Only never-paused 进行中 tasks fall
 * back to 待办.
 *
 * @param {DatabaseSync} db
 */
function markInterruptedRuns(db) {
  db.exec("BEGIN");
  try {
    const running = db.prepare("SELECT id FROM run WHERE status = 'running'").all();
    const interruptSessions = db.prepare("UPDATE task_session SET status = 'interrupted', ended_at = ? WHERE status = 'running'");
    const reopenTasks = db.prepare(
      `UPDATE task SET status = 'open'
       WHERE status = 'running'
         AND id NOT IN (SELECT task_id FROM task_session WHERE status = 'paused')`,
    );
    const endedAt = new Date().toISOString();
    if (running.length > 0) {
      const finish = db.prepare("UPDATE run SET status = 'interrupted', ended_at = ? WHERE id = ?");
      for (const row of running) finish.run(endedAt, Number(/** @type {Record<string, unknown>} */ (row).id));
    }
    interruptSessions.run(endedAt);
    reopenTasks.run();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Ticket 05 adds task columns to a `run` table that older databases already
 * created (CREATE IF NOT EXISTS never touches them). Heal them in place.
 * (SQLite cannot attach FK clauses via ALTER, so migrated databases carry
 * these two columns without the REFERENCES the fresh schema declares — the
 * only writers (service / run manager) always pass ids that exist.)
 *
 * @param {DatabaseSync} db
 */
function migrateRunTaskColumns(db) {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(run)")
      .all()
      .map((row) => String(/** @type {Record<string, unknown>} */ (row).name)),
  );
  if (!columns.has("task_id")) db.exec("ALTER TABLE run ADD COLUMN task_id INTEGER");
  if (!columns.has("task_session_id")) db.exec("ALTER TABLE run ADD COLUMN task_session_id INTEGER");
  if (!columns.has("usage")) db.exec("ALTER TABLE run ADD COLUMN usage TEXT");
}

/**
 * Ticket 06 gives the task table a new status CHECK (five states). SQLite
 * cannot relax a CHECK in place, and `CREATE TABLE IF NOT EXISTS` never
 * touches a pre-existing table — so a database still carrying the ticket-05
 * CHECK (open/running/finished) is rebuilt here, mapping 已交产出 rows onto
 * 待验收 (the boss still owes them a decision). References from run /
 * task_session / artifact follow the table by name; foreign keys are not
 * enforced in this store (single writer), so the swap is safe inside a
 * transaction.
 *
 * @param {DatabaseSync} db
 */
function migrateTaskStateMachine(db) {
  const current = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task'").get();
  const sql = current ? String(/** @type {Record<string, unknown>} */ (current).sql ?? "") : "";
  if (sql.length === 0 || !sql.includes("'finished'")) return;

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE task_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES project_group(id),
        employee_id INTEGER NOT NULL REFERENCES employee(id),
        workspace_dir TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        playbook TEXT NOT NULL CHECK (playbook IN ('feature', 'bugfix', 'docs', 'free')),
        acceptance TEXT NOT NULL,
        base_head TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'running', 'review', 'done', 'failed')) DEFAULT 'open',
        created_at TEXT NOT NULL
      );
      INSERT INTO task_v6 (id, group_id, employee_id, workspace_dir, title, goal, playbook, acceptance, base_head, status, created_at)
      SELECT id, group_id, employee_id, workspace_dir, title, goal, playbook, acceptance, base_head,
        CASE status WHEN 'finished' THEN 'review' ELSE status END,
        created_at
      FROM task;
      DROP TABLE task;
      ALTER TABLE task_v6 RENAME TO task;
    `);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Ticket 09 widens the run / task_session status CHECK with 'paused'
 * (下班落盘). Same table-swap dance as migrateTaskStateMachine: CREATE IF
 * NOT EXISTS never relaxes a pre-existing CHECK, so a database still
 * missing 'paused' is rebuilt in place. Rows carry over unchanged — the
 * statuses they hold are a subset of the new set.
 *
 * @param {DatabaseSync} db
 */
function migrateRunPauseState(db) {
  for (const table of ["run", "task_session"]) {
    const current = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    const sql = current ? String(/** @type {Record<string, unknown>} */ (current).sql ?? "") : "";
    if (sql.length === 0 || sql.includes("'paused'")) continue;

    db.exec("BEGIN");
    try {
      if (table === "run") {
        db.exec(`
          CREATE TABLE run_v9 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_session_id INTEGER NOT NULL REFERENCES employee_session(id),
            employee_id INTEGER NOT NULL REFERENCES employee(id),
            engine TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted', 'paused')),
            prompt TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            usage TEXT,
            task_id INTEGER,
            task_session_id INTEGER
          );
          INSERT INTO run_v9 (id, employee_session_id, employee_id, engine, status, prompt, started_at, ended_at, usage, task_id, task_session_id)
          SELECT id, employee_session_id, employee_id, engine, status, prompt, started_at, ended_at, usage, task_id, task_session_id FROM run;
          DROP TABLE run;
          ALTER TABLE run_v9 RENAME TO run;
        `);
      } else {
        db.exec(`
          CREATE TABLE task_session_v9 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES task(id),
            employee_session_id INTEGER NOT NULL REFERENCES employee_session(id),
            engine TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted', 'paused')),
            started_at TEXT NOT NULL,
            ended_at TEXT
          );
          INSERT INTO task_session_v9 (id, task_id, employee_session_id, engine, status, started_at, ended_at)
          SELECT id, task_id, employee_session_id, engine, status, started_at, ended_at FROM task_session;
          DROP TABLE task_session;
          ALTER TABLE task_session_v9 RENAME TO task_session;
        `);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/**
 * A probe's "running" verdict belongs to a host that is no longer alive: the
 * probe itself is in-process, so no verdict will ever arrive for it. Land it
 * as failed (with the reason visible on the engine card) so the engine can be
 * re-probed or hand-enabled instead of stuck.
 *
 * @param {DatabaseSync} db
 */
function markInterruptedProbes(db) {
  const stale = db.prepare("SELECT engine FROM engine_state WHERE probe_status = 'running'").all();
  if (stale.length === 0) return;
  const now = new Date().toISOString();
  const update = db.prepare(
    "UPDATE engine_state SET probe_status = 'failed', probe_json = ?, updated_at = ? WHERE engine = ?",
  );
  const reason = JSON.stringify({ verdicts: null, error: "上一次探针随 AgentHost 一起结束，没有拿到结论" });
  for (const row of stale) update.run(reason, now, String(/** @type {Record<string, unknown>} */ (row).engine));
}

/**
 * Fold usage rows into { entity id → { total, measured } }. The entity table
 * is walked too, so a never-run employee / company still reads measured=false
 * (「未计量」) instead of vanishing or faking a 0. `entityTable` is a fixed
 * internal literal at both call sites ("employee" / "company") — never input.
 *
 * @param {DatabaseSync} db
 * @param {"employee" | "company"} entityTable
 * @param {unknown[]} usageRows rows carrying bucket_id + usage
 * @param {(row: unknown) => number} keyOf
 * @returns {Record<string, TokenTotal>}
 */
function foldTokenTotals(db, entityTable, usageRows, keyOf) {
  /** @type {Map<number, TokenTotal>} */
  const byId = new Map();
  /** @param {number} id @returns {TokenTotal} */
  const bucket = (id) => {
    let entry = byId.get(id);
    if (!entry) {
      entry = { total: 0, measured: false };
      byId.set(id, entry);
    }
    return entry;
  };
  for (const row of usageRows) {
    const entry = bucket(keyOf(row));
    const usage = parseUsage(/** @type {Record<string, unknown>} */ (row).usage);
    if (!usage) continue;
    entry.measured = true;
    entry.total += usage.input + usage.cachedInput + usage.cacheWrite + usage.output + usage.reasoning;
  }
  /** @type {Record<string, TokenTotal>} */
  const totals = {};
  for (const row of db.prepare(`SELECT id FROM ${entityTable} ORDER BY id`).all()) {
    const id = Number(/** @type {Record<string, unknown>} */ (row).id);
    totals[String(id)] = bucket(id);
  }
  return totals;
}

/**
 * Ticket 12 gives an existing database its cost columns (票 06 的 usage 列先例):
 * `run.fail_reason`（人话失败原因）and `task.token_budget`（工单自己的预算）.
 * Old tasks land on the preset default budget; old runs honestly have no reason.
 *
 * @param {DatabaseSync} db
 */
function migrateCostColumns(db) {
  const taskColumns = new Set(
    db
      .prepare("PRAGMA table_info(task)")
      .all()
      .map((row) => String(/** @type {Record<string, unknown>} */ (row).name)),
  );
  if (!taskColumns.has("token_budget")) {
    db.exec(`ALTER TABLE task ADD COLUMN token_budget INTEGER NOT NULL DEFAULT ${DEFAULT_TASK_TOKEN_BUDGET}`);
  }
  const runColumns = new Set(
    db
      .prepare("PRAGMA table_info(run)")
      .all()
      .map((row) => String(/** @type {Record<string, unknown>} */ (row).name)),
  );
  if (!runColumns.has("fail_reason")) db.exec("ALTER TABLE run ADD COLUMN fail_reason TEXT");
}

/**
 * @param {DatabaseSync} db
 * @param {number} groupId
 */
function insertProjectGroupDesks(db, groupId) {
  const insert = db.prepare("INSERT INTO desk (group_id, label, x, y) VALUES (?, ?, ?, ?)");
  DESK_SLOTS.forEach((slot, index) => {
    insert.run(groupId, `工位 ${index + 1}`, slot.x, slot.y);
  });
}

/**
 * The office view's current selection, persisted in meta as one JSON value:
 * { companyId, groups: { [companyId]: groupId } }. Unknown ids fall back at
 * read time, so a deleted row never wedges the snapshot.
 *
 * @param {DatabaseSync} db
 * @returns {{ companyId: number, groups: Record<number, number> }}
 */
function readActive(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'active'").get();
  try {
    const parsed = JSON.parse(String(row?.value ?? "null"));
    return {
      companyId: Number(parsed?.companyId) || 0,
      groups: Object.fromEntries(
        Object.entries(parsed?.groups ?? {}).map(([k, v]) => [Number(k), Number(v)]),
      ),
    };
  } catch {
    return { companyId: 0, groups: {} };
  }
}

/**
 * @param {DatabaseSync} db
 * @param {{ companyId: number, groups: Record<number, number> }} active
 */
function writeActive(db, active) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('active', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(active));
}

/**
 * Bump whenever PRESET_ROLES changes in a way existing databases must receive
 * (new tool, new cost field, engine default). Hired snapshots stay frozen.
 */
const ROLE_SEED_REV = 2;

/**
 * Insert or refresh the preset roster. Runs on every open; a versioned meta
 * key makes the refresh a one-shot upgrade rather than a write per launch.
 * Existing hires keep their frozen snapshots — only the role library moves.
 *
 * @param {DatabaseSync} db
 */
function seedRoles(db) {
  const seeded = db.prepare("SELECT value FROM meta WHERE key = 'role_seed_rev'").get();
  if (String(/** @type {Record<string, unknown>} */ (seeded ?? {}).value ?? "") === String(ROLE_SEED_REV)) return;
  const createdAt = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO role (key, name, tagline, manifest, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       tagline = excluded.tagline,
       manifest = excluded.manifest
     WHERE role.source = 'preset'`,
  );
  for (const preset of PRESET_ROLES) {
    upsert.run(preset.key, preset.name, preset.tagline, JSON.stringify(preset.manifest), createdAt);
  }
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('role_seed_rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(ROLE_SEED_REV));
}

/**
 * Heal old databases that still have the pre-8-bay layout. Existing desk ids
 * and occupants are untouched; only missing slot indexes are appended.
 * @param {DatabaseSync} db
 */
function ensureDeskCapacity(db) {
  const groups = /** @type {{ id: number }[]} */ (db.prepare("SELECT id FROM project_group ORDER BY id").all());
  const insert = db.prepare("INSERT INTO desk (group_id, label, x, y) VALUES (?, ?, ?, ?)");
  for (const group of groups) {
    const desks = /** @type {{ id: number }[]} */ (db.prepare("SELECT id FROM desk WHERE group_id = ? ORDER BY id").all(group.id));
    if (desks.length >= DESK_SLOTS.length) continue;
    db.exec("BEGIN");
    try {
      for (let index = desks.length; index < DESK_SLOTS.length; index += 1) {
        const slot = DESK_SLOTS[index];
        insert.run(group.id, `工位 ${index + 1}`, slot.x, slot.y);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/**
 * @param {DatabaseSync} db
 */
function seedIfFirstRun(db) {
  const seeded = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
  if (seeded) return;
  db.exec("BEGIN");
  try {
    const createdAt = new Date().toISOString();
    const company = db
      .prepare("INSERT INTO company (name, created_at) VALUES (?, ?)")
      .run("默认公司", createdAt);
    const group = db
      .prepare("INSERT INTO project_group (company_id, name, created_at) VALUES (?, ?, ?)")
      .run(Number(company.lastInsertRowid), "默认项目组", createdAt);
    insertProjectGroupDesks(db, Number(group.lastInsertRowid));
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
