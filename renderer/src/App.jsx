import React, { useCallback, useEffect, useRef, useState } from "react";
import { OfficeFloor } from "./OfficeFloor.jsx";
import { HireModal } from "./HireModal.jsx";
import { ChatOverlay } from "./ChatOverlay.jsx";
import { TaskBench } from "./TaskBench.jsx";
import { LeftRail } from "./LeftRail.jsx";
import { RosterPanel } from "./RosterPanel.jsx";
import { EngineCenterPanel } from "./EngineCenterPanel.jsx";
import { WorkClockPanel } from "./WorkClockPanel.jsx";
import { TaskHandle } from "./TaskHandle.jsx";
import { StatusChip } from "./StatusChip.jsx";
import { initialDeskActivity, reduceDeskActivity, expireDeskBlocked } from "./scene/deskActivity.js";
import { initialMotion, advanceMotion, motionOnWork, motionOnRelease } from "./scene/idleMotion.js";
import { activeCountFor } from "./scene/handleGroups.js";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const TOPICS = { hostStatus: "host.status", domainChanged: "domain.changed", runEvent: "run.event" };

/** View tick: fine enough for the 9s/45s idle thresholds, cheap for four desks. */
const DESK_TICK_MS = 500;

export function App() {
  const [snapshot, setSnapshot] = useState(/** @type {OfficeSnapshotData | null} */ (null));
  const [status, setStatus] = useState(/** @type {HostStatusData} */ ({ state: "starting" }));
  const [bridgeError, setBridgeError] = useState(/** @type {string | null} */ (null));
  const [hireDesk, setHireDesk] = useState(/** @type {DeskData | null} */ (null));
  const [chatEmployee, setChatEmployee] = useState(/** @type {DeskOccupantData | null} */ (null));
  /**
   * employeeId → 工位状态（票 07）。activity 只由归一化事件流折叠
   * （deskActivity.js）；motion 是空闲时钟（idleMotion.js），仅在无 run
   * 时推进。状态来自真实事件，不是定时器编造。
   */
  const [deskStates, setDeskStates] = useState(/** @type {() => Map<number, DeskState>} */ (() => new Map()));
  const [viewPrefs, setViewPrefs] = useState(/** @type {() => ViewPrefs} */ (readViewPrefs));
  // 票 08 外壳：四个左轨入口 + 右把手各自开合，全是浮层（画布永远 100%）。
  const [benchOpen, setBenchOpen] = useState(false);
  const [handleOpen, setHandleOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [dutyOpen, setDutyOpen] = useState(false);
  const lastHostState = useRef(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    try {
      const data = /** @type {OfficeSnapshotData} */ (await window.cubicle.invoke("office.get"));
      setSnapshot(data);
      setBridgeError(null);
      // Every seated employee gets a工位 state entry (idle from the moment
      // the view learns about them); existing live states are kept.
      setDeskStates((prev) => {
        const seated = new Set(data.desks.map((desk) => desk.occupant?.id).filter((id) => id !== null && id !== undefined));
        if (seated.size === prev.size && [...seated].every((id) => prev.has(/** @type {number} */ (id)))) return prev;
        const next = new Map(prev);
        const now = Date.now();
        for (const id of seated) {
          if (!next.has(/** @type {number} */ (id))) next.set(/** @type {number} */ (id), { activity: initialDeskActivity(), motion: initialMotion(now) });
        }
        for (const id of [...next.keys()]) if (!seated.has(id)) next.delete(id);
        return next;
      });
    } catch (err) {
      setBridgeError(/** @type {Error & { code?: string }} */ (err).code ?? "office_get_failed");
    }
  }, []);

  /** Fold one normalized engine event into its desk (事件驱动，唯一的忙/屏幕来源). */
  const foldRunEvent = useCallback((/** @type {number} */ employeeId, /** @type {RunEventData["event"]} */ event) => {
    setDeskStates((prev) => {
      const now = Date.now();
      const entry =
        prev.get(employeeId) ?? { activity: initialDeskActivity(), motion: initialMotion(now) };
      const activity = reduceDeskActivity(entry.activity, /** @type {any} */ (event), now);
      let motion = entry.motion;
      if (event.type === "session_start" || event.type === "tool_execution_start") {
        motion = motionOnWork(motion, now);
      } else if (event.type === "agent_end") {
        motion = motionOnRelease(motion, now);
      }
      const next = new Map(prev);
      next.set(employeeId, { activity, motion });
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribeStatus = window.cubicle.subscribe(TOPICS.hostStatus, (envelope) => {
      const payload = /** @type {HostStatusData} */ (envelope.payload);
      setStatus((prev) => ({ ...prev, ...payload }));
      // A host that just (re)appeared: re-pull the domain data even if the
      // view loaded while the host was still down or restarting.
      if (payload.state === "online" && lastHostState.current !== "online") {
        void refresh();
        setDeskStates(new Map());
      }
      lastHostState.current = payload.state;
    });
    const unsubscribeDomain = window.cubicle.subscribe(TOPICS.domainChanged, () => {
      void refresh();
    });
    const unsubscribeRun = window.cubicle.subscribe(TOPICS.runEvent, (envelope) => {
      const payload = /** @type {RunEventData} */ (envelope.payload);
      foldRunEvent(payload.employeeId, payload.event);
      // 票 08: run 收尾后 host 会落任务状态，但没有 domain 事件 —— 重拉一次
      // 快照，左轨公司活跃数与右把手徽标才不会说谎。
      if (payload.event.type === "agent_end") void refresh();
    });
    return () => {
      unsubscribeStatus();
      unsubscribeDomain();
      unsubscribeRun();
    };
  }, [refresh, foldRunEvent]);

  // The idle clock: 摸鱼/咖啡/归位 + fading expired 拒绝 markers. This is the
  // only timer that moves a desk, and advanceMotion/expireDeskBlocked are
  // no-ops while a run is live.
  useEffect(() => {
    const timer = setInterval(() => {
      setDeskStates((prev) => {
        if (prev.size === 0) return prev;
        const now = Date.now();
        const next = new Map();
        for (const [employeeId, entry] of prev) {
          next.set(employeeId, {
            activity: expireDeskBlocked(entry.activity, now),
            motion: advanceMotion(entry.motion, now),
          });
        }
        return next;
      });
    }, DESK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  /** @param {DeskData} desk */
  const openHire = (desk) => {
    if (hireDesk) return;
    setHireDesk(desk);
  };

  /** @param {DeskOccupantData} occupant */
  const openChat = (occupant) => {
    setChatEmployee(occupant);
  };

  const setViewPref = (/** @type {keyof ViewPrefs} */ key, /** @type {boolean} */ value) => {
    setViewPrefs((prev) => {
      const next = { ...prev, [key]: value };
      saveViewPrefs(next);
      return next;
    });
  };

  // 右把手徽标：当前公司的活跃工单数（进行中 + 待验收），与左轨公司切换器
  // 同一个 taskCounts 口径（activeCountFor 纯函数，node:test 钉死）。
  const handleActive = activeCountFor(
    snapshot ? snapshot.taskCounts?.[String(snapshot.activeCompanyId)] ?? null : null,
  );

  return (
    <div className="office-app">
      <OfficeFloor
        snapshot={snapshot}
        status={status}
        bridgeError={bridgeError}
        onHireAt={openHire}
        onTalkTo={openChat}
        deskStates={deskStates}
        viewPrefs={viewPrefs}
      />
      <StatusChip status={status} />
      <div className="view-toggles" data-testid="view-toggles">
        <label className="view-toggle">
          <input
            type="checkbox"
            data-testid="toggle-plate"
            checked={viewPrefs.plate}
            onChange={(event) => setViewPref("plate", event.target.checked)}
          />
          名牌
        </label>
        <label className="view-toggle">
          <input
            type="checkbox"
            data-testid="toggle-bubble"
            checked={viewPrefs.bubble}
            onChange={(event) => setViewPref("bubble", event.target.checked)}
          />
          气泡
        </label>
      </div>
      {/* 左轨四入口（票 08）：公司切换（Switcher 收进来）/ 工单台 / 花名册 /
          引擎中心。工单创建与列表只在浮层，主画布永远是办公室（硬约束）。 */}
      <LeftRail
        snapshot={snapshot}
        onChanged={() => void refresh()}
        benchOpen={benchOpen}
        onToggleBench={() => setBenchOpen((open) => !open)}
        rosterOpen={rosterOpen}
        onToggleRoster={() => setRosterOpen((open) => !open)}
        engineOpen={engineOpen}
        onToggleEngine={() => setEngineOpen((open) => !open)}
        dutyOpen={dutyOpen}
        onToggleDuty={() => setDutyOpen((open) => !open)}
      />
      {benchOpen ? <TaskBench snapshot={snapshot} onClose={() => setBenchOpen(false)} /> : null}
      {rosterOpen ? <RosterPanel snapshot={snapshot} onClose={() => setRosterOpen(false)} /> : null}
      {engineOpen ? <EngineCenterPanel onClose={() => setEngineOpen(false)} /> : null}
      {dutyOpen ? <WorkClockPanel snapshot={snapshot} onClose={() => setDutyOpen(false)} /> : null}
      {/* 右缘任务把手：徽标 = 活跃工单数（进行中+待验收），拉开三段
          进行中 / 待验收 / 档案（done+failed）。 */}
      <button
        type="button"
        className="task-handle"
        data-testid="task-handle"
        data-active={String(handleActive)}
        aria-expanded={handleOpen ? "true" : "false"}
        onClick={() => setHandleOpen((open) => !open)}
        title="任务把手：进行中 / 待验收 / 档案"
      >
        工单
        <span className="handle-badge" data-testid="handle-active">{handleActive}</span>
      </button>
      {handleOpen ? <TaskHandle snapshot={snapshot} onClose={() => setHandleOpen(false)} /> : null}
      {hireDesk ? <HireModal desk={hireDesk} onClose={() => setHireDesk(null)} /> : null}
      {chatEmployee ? <ChatOverlay employee={chatEmployee} onClose={() => setChatEmployee(null)} /> : null}
    </div>
  );
}

/** localStorage-backed view preference (v1 has no sync — see AGENTS 硬约束). */
const VIEW_PREFS_KEY = "cubicle.viewPrefs";

/** @returns {ViewPrefs} */
function readViewPrefs() {
  const fallback = { plate: true, bubble: true };
  try {
    const raw = window.localStorage.getItem(VIEW_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = /** @type {{ plate?: boolean, bubble?: boolean }} */ (JSON.parse(raw));
    return {
      plate: parsed.plate !== false,
      bubble: parsed.bubble !== false,
    };
  } catch {
    return fallback;
  }
}

/** @param {ViewPrefs} prefs */
function saveViewPrefs(prefs) {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private-mode storage must never take the office down
  }
}

/**
 * @typedef {import("./scene/deskActivity.js").DeskActivityState} DeskActivityState
 * @typedef {import("./scene/idleMotion.js").IdleMotionState} IdleMotionState
 */

/**
 * @typedef {object} DeskState
 * @property {DeskActivityState} activity
 * @property {IdleMotionState} motion
 *
 * @typedef {object} ViewPrefs
 * @property {boolean} plate 名牌
 * @property {boolean} bubble 气泡
 *
 * @typedef {{ employeeId: number, event: { type: string, [key: string]: unknown } }} RunEventData
 *
 * @typedef {object} RoleManifestData
 * @property {string} persona
 * @property {string[]} skills
 * @property {string[]} tools
 * @property {string[]} mcpServers
 * @property {string} engine
 * @property {string} model
 * @property {{ tokenBudgetPerTask: number }} cost
 *
 * @typedef {object} RoleData
 * @property {number} id
 * @property {string} key
 * @property {string} name
 * @property {string} tagline
 * @property {RoleManifestData} manifest
 *
 * @typedef {object} RoleSnapshotData
 * @property {string} key
 * @property {string} name
 * @property {string} tagline
 * @property {RoleManifestData} manifest
 *
 * @typedef {object} DeskOccupantData
 * @property {number} id
 * @property {string} name
 * @property {number} roleId
 * @property {string} hiredAt
 * @property {RoleSnapshotData} roleSnapshot
 *
 * @typedef {object} DeskData
 * @property {number} id
 * @property {number} groupId
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {DeskOccupantData | null} occupant
 *
 * @typedef {object} TokenTotalData
 * @property {number} total
 * @property {boolean} measured false = 未计量（显示「未计量」而不是 0）
 *
 * @typedef {object} OfficeSnapshotData
 * @property {{ id: number, name: string, createdAt: string }[]} companies
 * @property {number} activeCompanyId
 * @property {{ id: number, companyId: number, name: string }[]} groups
 * @property {number | null} activeGroupId
 * @property {DeskData[]} desks
 * @property {Record<string, { running: number, review: number }>} taskCounts 票 08: 每公司活跃数（进行中/待验收）
 * @property {Record<string, TokenTotalData>} employeeTokens 票 12: 员工级 token 聚合（名牌数据源）
 * @property {Record<string, TokenTotalData>} companyTokens 票 12: 公司级 token 聚合（公司面板数据源）
 * @property {{ pid: number, startedAt: string, dataDir: string, dbPath: string }} host
 *
 * @typedef {object} HostStatusData
 * @property {string} state
 * @property {number} [pid]
 * @property {string} [startedAt]
 * @property {string} [dataDir]
 * @property {string} [dbPath]
 */
