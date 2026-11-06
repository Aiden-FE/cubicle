import React from "react";
import { deskStyle } from "./scene/domScene.js";

/**
 * The main canvas — always the office. Desks are drawn from database rows.
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   status: import("./App.jsx").HostStatusData,
 *   bridgeError: string | null,
 * }} props
 */
export function OfficeFloor({ snapshot, status, bridgeError }) {
  const activeCompany = snapshot?.companies.find((c) => c.id === snapshot.activeCompanyId);
  const activeGroup = snapshot?.groups.find((g) => g.id === snapshot.activeGroupId);
  const ready = status.state === "online" && snapshot;

  return (
    <div className="office-floor">
      <div className="scene-caption" data-testid="scene-caption">
        {ready ? (
          <>
            <span data-testid="company-name">{activeCompany?.name ?? "—"}</span>
            <span className="dot-sep">·</span>
            <span data-testid="group-name">{activeGroup?.name ?? "暂无项目组"}</span>
          </>
        ) : (
          <span>{bridgeError ? "后台服务未连接，正在自动重试…" : "正在准备办公室…"}</span>
        )}
      </div>

      <div className="room">
        <div className="room-floor" />
        {snapshot?.desks.map((desk) => (
          <DeskCard key={desk.id} desk={desk} />
        ))}
      </div>
    </div>
  );
}

/**
 * @param {{ desk: import("./App.jsx").OfficeSnapshotData["desks"][number] }} props
 */
function DeskCard({ desk }) {
  return (
    <div className="desk" data-testid="desk" data-empty="true" style={deskStyle(desk)}>
      <div className="desk-monitor">
        <div className="desk-screen" />
      </div>
      <div className="desk-table" />
      <div className="desk-label">{desk.label}</div>
      <div className="desk-badge">空置</div>
    </div>
  );
}
