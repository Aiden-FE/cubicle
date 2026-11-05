import React, { useCallback, useEffect, useRef, useState } from "react";
import { OfficeFloor } from "./OfficeFloor.jsx";
import { RailPanel } from "./RailPanel.jsx";
import { StatusChip } from "./StatusChip.jsx";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const TOPICS = { hostStatus: "host.status", domainChanged: "domain.changed" };

export function App() {
  const [snapshot, setSnapshot] = useState(/** @type {OfficeSnapshotData | null} */ (null));
  const [status, setStatus] = useState(/** @type {HostStatusData} */ ({ state: "starting" }));
  const [bridgeError, setBridgeError] = useState(/** @type {string | null} */ (null));
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
      }
      lastHostState.current = payload.state;
    });
    const unsubscribeDomain = window.cubicle.subscribe(TOPICS.domainChanged, () => {
      void refresh();
    });
    return () => {
      unsubscribeStatus();
      unsubscribeDomain();
    };
  }, [refresh]);

  return (
    <div className="office-app">
      <OfficeFloor snapshot={snapshot} status={status} bridgeError={bridgeError} />
      <StatusChip status={status} />
      <RailPanel snapshot={snapshot} onChanged={refresh} />
    </div>
  );
}

/**
 * @typedef {object} OfficeSnapshotData
 * @property {{ id: number, name: string, createdAt: string }[]} companies
 * @property {number} activeCompanyId
 * @property {{ id: number, companyId: number, name: string }[]} groups
 * @property {number | null} activeGroupId
 * @property {{ id: number, groupId: number, label: string, x: number, y: number, occupant: null }[]} desks
 * @property {{ pid: number, startedAt: string, dataDir: string, dbPath: string }} host
 *
 * @typedef {object} HostStatusData
 * @property {string} state
 * @property {number} [pid]
 * @property {string} [startedAt]
 * @property {string} [dataDir]
 * @property {string} [dbPath]
 */
