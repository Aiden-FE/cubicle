import React, { useCallback, useEffect, useState } from "react";
import { OfficeFloor } from "./OfficeFloor.jsx";
import { RailPanel } from "./RailPanel.jsx";
import { StatusChip } from "./StatusChip.jsx";

export function App() {
  const [snapshot, setSnapshot] = useState(/** @type {OfficeSnapshotData | null} */ (null));
  const [status, setStatus] = useState(/** @type {HostStatusData} */ ({ state: "starting" }));
  const [bridgeError, setBridgeError] = useState(/** @type {string | null} */ (null));

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
    const unsubscribe = window.cubicle.onEvents((batch) => {
      let domainChanged = false;
      for (const envelope of batch) {
        if (envelope.topic === "host.status") {
          setStatus((prev) => ({ ...prev, .../** @type {HostStatusData} */ (envelope.payload) }));
        } else if (envelope.topic === "domain.changed") {
          domainChanged = true;
        }
      }
      if (domainChanged) void refresh();
    });
    return unsubscribe;
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
