import React, { useCallback, useEffect, useRef, useState } from "react";
import { OfficeFloor } from "./OfficeFloor.jsx";
import { HireModal } from "./HireModal.jsx";
import { ChatOverlay } from "./ChatOverlay.jsx";
import { TaskBench } from "./TaskBench.jsx";
import { Switcher } from "./Switcher.jsx";
import { StatusChip } from "./StatusChip.jsx";
import { initialDeskActivity, reduceDeskActivity, expireDeskBlocked } from "./scene/deskActivity.js";
import { initialMotion, advanceMotion, motionOnWork, motionOnRelease } from "./scene/idleMotion.js";

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
  const [benchOpen, setBenchOpen] = useState(false);
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
      <Switcher snapshot={snapshot} onChanged={refresh} />
      {/* 左轨工单台：工单创建/列表只在浮层，主画布永远是办公室（硬约束）。 */}
      <button
        type="button"
        className="task-rail"
        data-testid="task-rail"
        aria-expanded={benchOpen ? "true" : "false"}
        onClick={() => setBenchOpen((open) => !open)}
      >
        工单台
      </button>
      {benchOpen ? <TaskBench snapshot={snapshot} onClose={() => setBenchOpen(false)} /> : null}
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
 * @typedef {object} OfficeSnapshotData
 * @property {{ id: number, name: string, createdAt: string }[]} companies
 * @property {number} activeCompanyId
 * @property {{ id: number, companyId: number, name: string }[]} groups
 * @property {number | null} activeGroupId
 * @property {DeskData[]} desks
 * @property {{ pid: number, startedAt: string, dataDir: string, dbPath: string }} host
 *
 * @typedef {object} HostStatusData
 * @property {string} state
 * @property {number} [pid]
 * @property {string} [startedAt]
 * @property {string} [dataDir]
 * @property {string} [dbPath]
 */
