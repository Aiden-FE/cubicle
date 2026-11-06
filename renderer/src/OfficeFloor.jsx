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
  const ready = status.state === "online" && snapshot;

  return (
    <div className="office-floor">
      {!ready ? (
        <div className="scene-caption" data-testid="scene-caption">
          <span>{bridgeError ? "后台服务未连接，正在自动重试…" : "正在准备办公室…"}</span>
        </div>
      ) : null}

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
      <WorkstationSvg />
      <div className="desk-label">{desk.label}</div>
      <div className="desk-badge">空置</div>
    </div>
  );
}

/**
 * Stylized workstation: desk with legs + shadow, monitor on a stand,
 * keyboard and mouse on the near edge, office chair (headrest, backrest,
 * gas lift, five-star base) between the desk and the viewer. Placeholder
 * art until ticket 07 swaps the SceneRenderer adapter.
 */
function WorkstationSvg() {
  return (
    <svg className="desk-art" viewBox="0 0 170 152" aria-hidden="true">
      <defs>
        <linearGradient id="desk-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d5c4a5" />
          <stop offset="1" stopColor="#c2ad88" />
        </linearGradient>
        <linearGradient id="desk-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#566054" />
          <stop offset="1" stopColor="#3d453c" />
        </linearGradient>
        <linearGradient id="imac-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dcded8" />
          <stop offset="1" stopColor="#b7bab2" />
        </linearGradient>
      </defs>

      {/* floor shadow */}
      <ellipse cx="85" cy="140" rx="64" ry="8" fill="rgba(43,38,32,0.10)" />

      {/* desk legs + top */}
      <rect x="26" y="60" width="7" height="30" rx="2" fill="#b39d78" />
      <rect x="137" y="60" width="7" height="30" rx="2" fill="#b39d78" />
      <rect x="14" y="48" width="142" height="13" rx="4" fill="url(#desk-top)" />

      {/* iMac: aluminum base plate + L stand, silver body, dark screen, chin */}
      <g className="imac">
        <rect x="66" y="49" width="38" height="5" rx="2.5" fill="#c7cac3" />
        <path d="M77 50 L93 50 L90 30 L80 30 Z" fill="#cfd2cb" />
        <path d="M77 50 L93 50 L91.5 41 L78.5 41 Z" fill="#c1c4bd" />
        <rect x="37" y="1" width="96" height="48" rx="6" fill="url(#imac-shell)" />
        <rect x="41" y="5" width="88" height="36" rx="3" fill="url(#desk-screen)" />
        <rect x="41" y="5" width="88" height="36" rx="3" fill="none" stroke="#1f231e" strokeWidth="1.2" />
        <path d="M41 36 Q85 44 129 36 L129 41 Q85 41 41 41 Z" fill="rgba(255,255,255,0.05)" />
        <path
          d="M85.5 43.6 c-1.7 0 -2.9 -1.2 -2.9 -2.9 0 -1.8 1.4 -3 3 -3 .6 0 1.1 .2 1.5 .5 -.4 .3 -.7 .8 -.7 1.4 0 1 .7 1.6 1.6 1.6 .5 0 .9 -.2 1.2 -.5 .2 .4 .3 .9 .3 1.4 -.5 .9 -1.6 1.5 -2.9 1.5 z"
          fill="#9a9d96"
        />
      </g>

      {/* keyboard + mouse on the near edge */}
      <rect x="52" y="52" width="50" height="9" rx="2.5" fill="#e4ddcd" stroke="#b9b1a0" strokeWidth="1" />
      <line x1="56" y1="55" x2="98" y2="55" stroke="#c8c0ae" strokeWidth="1" />
      <line x1="56" y1="58" x2="98" y2="58" stroke="#c8c0ae" strokeWidth="1" />
      <ellipse cx="116" cy="56" rx="7.5" ry="5.5" fill="#e4ddcd" stroke="#b9b1a0" strokeWidth="1" />
      <line x1="116" y1="51.5" x2="116" y2="56" stroke="#b9b1a0" strokeWidth="1" />

      {/* office chair, nearest to the viewer */}
      <g className="chair">
        <rect x="68" y="64" width="34" height="12" rx="6" fill="#5d6459" />
        <rect x="61" y="74" width="48" height="32" rx="11" fill="#4a4f45" />
        <rect x="67" y="80" width="36" height="20" rx="8" fill="#565d50" />
        <rect x="82" y="106" width="6" height="14" fill="#2f332c" />
        <g stroke="#2f332c" strokeWidth="3" strokeLinecap="round">
          <line x1="85" y1="122" x2="63" y2="130" />
          <line x1="85" y1="122" x2="107" y2="130" />
          <line x1="85" y1="122" x2="74" y2="134" />
          <line x1="85" y1="122" x2="96" y2="134" />
        </g>
        <circle cx="63" cy="131" r="3" fill="#2f332c" />
        <circle cx="107" cy="131" r="3" fill="#2f332c" />
        <circle cx="74" cy="135" r="3" fill="#2f332c" />
        <circle cx="96" cy="135" r="3" fill="#2f332c" />
      </g>
    </svg>
  );
}
