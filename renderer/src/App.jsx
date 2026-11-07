import React, { useCallback, useEffect, useRef, useState } from "react";
import { OfficeFloor } from "./OfficeFloor.jsx";
import { HireModal } from "./HireModal.jsx";
import { ChatOverlay } from "./ChatOverlay.jsx";
import { TaskBench } from "./TaskBench.jsx";
import { Switcher } from "./Switcher.jsx";
import { StatusChip } from "./StatusChip.jsx";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const TOPICS = { hostStatus: "host.status", domainChanged: "domain.changed", runEvent: "run.event" };

export function App() {
  const [snapshot, setSnapshot] = useState(/** @type {OfficeSnapshotData | null} */ (null));
  const [status, setStatus] = useState(/** @type {HostStatusData} */ ({ state: "starting" }));
  const [bridgeError, setBridgeError] = useState(/** @type {string | null} */ (null));
  const [hireDesk, setHireDesk] = useState(/** @type {DeskData | null} */ (null));
  const [chatEmployee, setChatEmployee] = useState(/** @type {DeskOccupantData | null} */ (null));
  const [benchOpen, setBenchOpen] = useState(false);
  /** employeeId → 正在干活（由 run.event 流的 session_start / agent_end 驱动） */
  const [workingIds, setWorkingIds] = useState(/** @type {Set<number>} */ (new Set()));
  const lastHostState = useRef(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    try {
      const data = /** @type {OfficeSnapshotData} */ (await window.cubicle.invoke("office.get"));
      setSnapshot(data);
      setBridgeError(null);
    } catch (err) {
      setBridgeError(/** @type {Error & { code?: string }} */ (err).code ?? "office_get_failed");
    }
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
        setWorkingIds(new Set());
      }
      lastHostState.current = payload.state;
    });
    const unsubscribeDomain = window.cubicle.subscribe(TOPICS.domainChanged, () => {
      void refresh();
    });
    const unsubscribeRun = window.cubicle.subscribe(TOPICS.runEvent, (envelope) => {
      const payload = /** @type {{ employeeId: number, event: { type: string } }} */ (envelope.payload);
      if (payload.event.type === "session_start") {
        setWorkingIds((prev) => new Set(prev).add(payload.employeeId));
      } else if (payload.event.type === "agent_end") {
        setWorkingIds((prev) => {
          const next = new Set(prev);
          next.delete(payload.employeeId);
          return next;
        });
      }
    });
    return () => {
      unsubscribeStatus();
      unsubscribeDomain();
      unsubscribeRun();
    };
  }, [refresh]);

  /** @param {DeskData} desk */
  const openHire = (desk) => {
    if (hireDesk) return;
    setHireDesk(desk);
  };

  /** @param {DeskOccupantData} occupant */
  const openChat = (occupant) => {
    setChatEmployee(occupant);
  };

  return (
    <div className="office-app">
      <OfficeFloor
        snapshot={snapshot}
        status={status}
        bridgeError={bridgeError}
        onHireAt={openHire}
        onTalkTo={openChat}
        workingIds={workingIds}
      />
      <StatusChip status={status} />
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

/**
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
