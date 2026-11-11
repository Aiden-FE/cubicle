import React, { useRef, useState } from "react";
import { deskStyle, projectedDeskStyle } from "./scene/domScene.js";
import { Office3D } from "./scene/Office3D.jsx";
import { appearanceFor } from "./roleAppearance.js";
import { initialDeskActivity } from "./scene/deskActivity.js";
import { initialMotion } from "./scene/idleMotion.js";
import { deskSignals, bubbleTextFor } from "./scene/deskReadout.js";
import { tokenText } from "./scene/tokenReadout.js";

const INITIAL_SCENE_VIEW = {
  zoom: 1,
  percent: 100,
  canZoomIn: true,
  canZoomOut: false,
};

/**
 * The main canvas — always the office (hard constraint). Desks are drawn
 * from database rows; the工位 ANIMATION layer (ticket 07) rides on top:
 *
 *  - screen picture follows tool activity (读/写/执行/测试), 测试 turns it
 *    green/red;
 *  - a 策略拒绝 shows an always-visible marker at the desk;
 *  - idle postures: 9s 摸鱼 (phone glow), 45s 去咖啡 (empty chair), back home;
 *  - 名牌 and 气泡 are switchable — the always-on status light keeps
 *    在忙/在闲 readable with both off (deskReadout.deskSignals).
 *
 * Rendering stays behind the SceneRenderer seam (scene/): this component
 * only maps state → DOM/SVG; swapping the art later touches nothing else.
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   status: import("./App.jsx").HostStatusData,
 *   bridgeError: string | null,
 *   onHireAt: (desk: import("./App.jsx").DeskData) => void,
 *   onTalkTo: (occupant: import("./App.jsx").DeskOccupantData) => void,
 *   deskStates: Map<number, import("./App.jsx").DeskState>,
 *   viewPrefs: import("./App.jsx").ViewPrefs,
 * }} props
 */
export function OfficeFloor({ snapshot, status, bridgeError, onHireAt, onTalkTo, deskStates, viewPrefs }) {
  const ready = status.state === "online" && snapshot;
  const [projected, setProjected] = useState(/** @type {Record<number, { x: number, y: number, width: number, height: number, hitLeft: number, hitTop: number, clipPath: string }> | null} */ (null));
  const [amenities, setAmenities] = useState(/** @type {Record<string, { x: number, y: number }> | null} */ (null));
  const [scene3dFailed, setScene3dFailed] = useState(false);
  const [sceneView, setSceneView] = useState(INITIAL_SCENE_VIEW);
  const sceneApiRef = React.useRef(/** @type {{ zoomIn: () => void, zoomOut: () => void, reset: () => void } | null} */ (null));

  return (
    <div className="office-floor" data-testid="office-floor">
      {!ready ? (
        <div className="scene-caption" data-testid="scene-caption">
          <span>{bridgeError ? "后台服务未连接，正在自动重试…" : "正在准备办公室…"}</span>
        </div>
      ) : null}

      <div
        className="room"
        data-testid="room"
        data-zoom={sceneView.percent}
        data-zoomed={sceneView.zoom > 1.0001 ? "true" : "false"}
      >
        {ready && !scene3dFailed ? (
          <div className="zoom-controls" data-testid="zoom-controls" role="group" aria-label="场景缩放">
            <button
              type="button"
              className="zoom-fit"
              data-testid="zoom-fit"
              onClick={() => sceneApiRef.current?.reset()}
              title="适应视图：回到 100% 全景"
            >
              适应
            </button>
            <div className="zoom-stack">
              <button
                type="button"
                className="zoom-button"
                data-testid="zoom-in"
                onClick={() => sceneApiRef.current?.zoomIn()}
                disabled={!sceneView.canZoomIn}
                aria-label="放大场景"
                title="放大场景（也可在房间内滚动滚轮）"
              >
                +
              </button>
              <span
                className="zoom-percent"
                data-testid="zoom-percent"
                aria-label={`当前场景缩放 ${sceneView.percent}%`}
              >
                {sceneView.percent}%
              </span>
              <button
                type="button"
                className="zoom-button"
                data-testid="zoom-out"
                onClick={() => sceneApiRef.current?.zoomOut()}
                disabled={!sceneView.canZoomOut}
                aria-label="缩小场景"
                title="缩小场景"
              >
                −
              </button>
            </div>
          </div>
        ) : null}
        {scene3dFailed ? (
          <img
            className="room-backdrop"
            src="./office/backdrop.png"
            alt=""
            draggable="false"
            aria-hidden="true"
          />
        ) : null}
        {ready && !scene3dFailed ? (
          <Office3D
            desks={snapshot.desks}
            deskStates={deskStates}
            controlsRef={sceneApiRef}
            onView={(view) => setSceneView(view)}
            onProject={(positions, nextAmenities) => {
              setProjected(positions);
              setAmenities(nextAmenities);
            }}
            onError={() => {
              setScene3dFailed(true);
              setSceneView(INITIAL_SCENE_VIEW);
            }}
          />
        ) : null}
        <div className="room-vignette" aria-hidden="true" />
        <div className="room-floor" />
        {amenities ? (
          <div className="amenity-layer" aria-hidden="true">
            <div className="amenity-tag amenity-coffee" data-testid="amenity-coffee" style={{ left: `${amenities.coffee.x}px`, top: `${amenities.coffee.y}px` }}>
              咖啡机
            </div>
            <div className="amenity-tag amenity-water" data-testid="amenity-water" style={{ left: `${amenities.water.x}px`, top: `${amenities.water.y}px` }}>
              饮水机
            </div>
          </div>
        ) : null}
        <div className="desk-layer">
          {snapshot?.desks.map((desk) => (
            <DeskCard
              key={desk.id}
              desk={desk}
              onHireAt={onHireAt}
              onTalkTo={onTalkTo}
              deskState={desk.occupant ? deskStates.get(desk.occupant.id) ?? null : null}
              tokenSummary={desk.occupant ? snapshot?.employeeTokens?.[String(desk.occupant.id)] ?? null : null}
              viewPrefs={viewPrefs}
              projected={projected}
              showArt={scene3dFailed}
            />
          ))}
        </div>
      </div>
      {snapshot && snapshot.desks.length > 0 && snapshot.desks.every((desk) => desk.occupant === null) ? (
        <div className="office-onboarding" data-testid="office-onboarding">
          点空工位招聘第一位员工，然后用「工单台」派活。
        </div>
      ) : null}
    </div>
  );
}

/**
 * @param {{
 *   desk: import("./App.jsx").DeskData,
 *   onHireAt: (desk: import("./App.jsx").DeskData) => void,
 *   onTalkTo: (occupant: import("./App.jsx").DeskOccupantData) => void,
 *   deskState: import("./App.jsx").DeskState | null,
 *   tokenSummary: import("./App.jsx").TokenTotalData | null,
 *   viewPrefs: import("./App.jsx").ViewPrefs,
 *   projected: Record<number, { x: number, y: number, width: number, height: number, hitLeft: number, hitTop: number, clipPath: string }> | null,
 *   showArt: boolean,
 * }} props
 */
const DeskCard = React.memo(function DeskCard(/** @type {any} */ props) {
  const { desk, onHireAt, onTalkTo, deskState, tokenSummary, viewPrefs, projected, showArt } = props;
  const occupant = desk.occupant;
  const empty = occupant === null;
  const openDesk = empty ? () => onHireAt(desk) : occupant ? () => onTalkTo(occupant) : undefined;
  const projection = projected?.[desk.id];
  const hit = projection && !showArt ? {
    width: `${Math.max(1, projection.width)}px`,
    height: `${Math.max(1, projection.height)}px`,
    left: `calc(50% + ${projection.hitLeft}px)`,
    top: `calc(50% + ${projection.hitTop}px)`,
    clipPath: projection.clipPath,
  } : null;

  const activity = deskState?.activity ?? initialDeskActivity();
  // No state entry yet (hired but the fold hasn't seen this employee): a
  // fresh idle cycle starts NOW, not at epoch.
  const motion = deskState?.motion ?? initialMotion(Date.now());
  const signals = deskSignals(activity, motion);
  const bubbleText = viewPrefs.bubble ? bubbleTextFor(activity, motion) : null;
  const working = signals.busy;
  const awayFromDesk = motion.position === "away";

  return (
    <div
      className={`desk ${empty ? "desk-empty" : "desk-occupied"}`}
      data-testid="desk"
      data-empty={empty ? "true" : "false"}
      data-desk-id={desk.id}
      data-working={working ? "true" : "false"}
      data-busy={signals.busy ? "true" : "false"}
      data-activity={activity.activity ?? ""}
      data-tone={activity.screenTone ?? ""}
      data-posture={motion.posture}
      data-position={motion.position}
      data-blocked={activity.blocked !== null ? "true" : "false"}
      role="button"
      title={empty ? `${desk.label}（空工位 · 点击招聘）` : `${occupant?.name}（点击对话）`}
      tabIndex={0}
      style={projectedDeskStyle(desk, projected)}
      onClick={openDesk}
      onKeyDown={
        openDesk
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") openDesk();
            }
          : undefined
      }
    >
      {showArt ? (
        <>
          {/* Fallback painting (WebGL unavailable): desk → seat → person →
              chair back. The normal path leaves this to the 3D scene. */}
          <DeskArtSvg activity={activity} uid={`desk-${desk.id}`} />
          <ChairSeatSvg uid={`desk-${desk.id}`} />
          {!empty && !awayFromDesk ? (
            <SeatedPersonSvg uid={`desk-${desk.id}`} roleKey={occupant.roleSnapshot.key} posture={motion.posture} working={working} />
          ) : null}
          {!empty && awayFromDesk ? <CoffeeChairSvg /> : null}
          <ChairBackSvg uid={`desk-${desk.id}`} />
        </>
      ) : hit ? (
        <div
          className="desk-hit"
          data-testid="desk-hit"
          aria-hidden="true"
          style={hit}
        />
      ) : null}

      {/* ── always-on readout layer（关掉名牌/气泡仍在）──────────── */}
      {!empty ? (
        <>
          <span className={`desk-status-light ${signals.light}`} data-testid="desk-light" data-tone={signals.light} aria-hidden="true" />
          {activity.blocked !== null ? (
            <div
              className="desk-blocked"
              data-testid="desk-blocked"
              title={`被策略拦下：${activity.blocked.reason}`}
              aria-label="被策略拦下"
            >
              <span aria-hidden="true">禁</span>
            </div>
          ) : null}
        </>
      ) : null}

      {bubbleText !== null ? (
        <div className="desk-bubble" data-testid="desk-bubble" data-bubble={bubbleText}>
          {bubbleText}
        </div>
      ) : null}

      {!empty && viewPrefs.plate ? (
        <div
          className={`desk-plate desk-plate-occupied ${working ? "desk-plate-working" : ""}`}
          data-testid="desk-occupant"
          title={`${occupant.name} · ${occupant.roleSnapshot.name}`}
        >
          {occupant.name} · {working ? "干活中…" : occupant.roleSnapshot.name}
          {/* 票 12 验收 3: 员工名牌上的员工级 token 聚合（host 聚合走信封）；
              未计量的引擎显示「未计量」，不是 0。 */}
          <span
            className="desk-plate-token"
            data-testid="desk-token"
            data-measured={tokenSummary?.measured === true ? "true" : "false"}
          >
            {tokenSummary?.measured === true ? compactToken(tokenSummary.total) : tokenText(tokenSummary)}
          </span>
        </div>
      ) : null}
      {empty ? (
        <div className="desk-vacant" title={`${desk.label} · 空位 · 点击招聘`} aria-label={`${desk.label} 空位，点击招聘`}>
          <span aria-hidden="true">+</span>
          <em>{desk.label} · 空位</em>
        </div>
      ) : null}
    </div>
  );
});

/**
 * Stylized workstation: desk with legs + shadow, monitor on a stand,
 * keyboard and mouse on the near edge (all facing a worker seated on the
 * viewer side). The monitor SCREEN (ticket 07) repaints with the desk's
 * activity: 读/写/执行/测试 each get their own picture, 测试结果 turns the
 * whole screen 红/绿.
 *
 * @param {{ activity: import("./scene/deskActivity.js").DeskActivityState, uid: string }} props
 */
function DeskArtSvg({ activity, uid }) {
  return (
    <svg className="desk-art" viewBox="0 0 170 152" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-desk-top`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4d3b6" />
          <stop offset="0.55" stopColor="#d2bb96" />
          <stop offset="1" stopColor="#bd9f77" />
        </linearGradient>
        <linearGradient id={`${uid}-desk-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b69268" />
          <stop offset="1" stopColor="#866a48" />
        </linearGradient>
        <linearGradient id={`${uid}-screen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#59645a" />
          <stop offset="0.55" stopColor="#374138" />
          <stop offset="1" stopColor="#252d27" />
        </linearGradient>
        <linearGradient id={`${uid}-imac-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0f0e9" />
          <stop offset="0.55" stopColor="#d8d9d0" />
          <stop offset="1" stopColor="#aeb2a8" />
        </linearGradient>
        <linearGradient id={`${uid}-lamp`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1d3a2" />
          <stop offset="1" stopColor="#bd8d51" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#b7d0b4" stopOpacity="0.45" />
          <stop offset="1" stopColor="#b7d0b4" stopOpacity="0" />
        </radialGradient>
        <filter id={`${uid}-soft`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* grounded shadow: two ellipses read as contact + ambient occlusion */}
      <ellipse cx="86" cy="140" rx="67" ry="7.5" fill="rgba(37,28,19,0.20)" filter={`url(#${uid}-soft)`} />
      <ellipse cx="86" cy="139" rx="45" ry="4.2" fill="rgba(37,28,19,0.18)" />

      {/* rear legs and the thin under-desk shadow */}
      <rect x="26" y="58" width="6" height="19" rx="2" fill="#8b6c4a" />
      <rect x="138" y="58" width="6" height="19" rx="2" fill="#8b6c4a" />

      {/* the desk is a shallow trapezoid, front edge closer to the viewer */}
      <path d="M12 52 L158 52 L165 67 L5 67 Z" fill={`url(#${uid}-desk-top)`} />
      <path d="M12 52 L158 52 L159 54 L11 54 Z" fill="rgba(255,248,231,0.55)" />
      <path d="M5 67 L165 67 L165 73 L5 73 Z" fill={`url(#${uid}-desk-edge)`} />
      <path d="M11 73 L159 73 L159 76 L11 76 Z" fill="rgba(54,37,22,0.16)" />
      <rect x="18" y="73" width="7" height="37" rx="2.2" fill="#9c7a53" />
      <rect x="145" y="73" width="7" height="37" rx="2.2" fill="#9c7a53" />
      <rect x="18" y="73" width="2" height="37" fill="rgba(255,244,222,0.28)" />

      {/* warm task lamp, behind the monitor's right shoulder */}
      <g className="desk-lamp">
        <ellipse cx="151" cy="52" rx="9" ry="3" fill="rgba(31,24,18,0.18)" />
        <rect x="149" y="30" width="3" height="22" rx="1" fill="#8e724f" />
        <path d="M139 25 Q151 19 161 26 L157 34 Q151 30 143 34 Z" fill={`url(#${uid}-lamp)`} />
        <path d="M151 34 Q156 43 161 51" stroke="#c79a60" strokeWidth="1" fill="none" opacity="0.5" />
        <ellipse cx="151" cy="35" rx="2.6" ry="1.5" fill="#ffe4b0" />
      </g>

      {/* monitor halo on the wall */}
      <ellipse cx="85" cy="27" rx="62" ry="35" fill={`url(#${uid}-glow)`} />

      {/* iMac: foot, L stand, aluminium shell, screen, chin and camera */}
      <ellipse cx="85" cy="51" rx="28" ry="3" fill="rgba(33,25,18,0.14)" />
      <rect x="67" y="47" width="36" height="5" rx="2.5" fill="#c5c8bf" />
      <path d="M78 47 L92 47 L89 27 L81 27 Z" fill="#d3d6cd" />
      <path d="M78 47 L92 47 L90.5 38 L79.5 38 Z" fill="#bdbfb7" />
      <rect x="33" y="1" width="104" height="48" rx="7" fill={`url(#${uid}-imac-shell)`} />
      <rect x="41" y="5" width="88" height="36" rx="3.2" fill={`url(#${uid}-screen)`} />
      <ScreenPicture activity={activity} />
      <rect x="41" y="5" width="88" height="36" rx="3.2" fill="none" stroke="#1b201b" strokeWidth="1.25" />
      <path d="M43 6 H127 L123 12 H47 Z" fill="rgba(255,255,255,0.06)" />
      <path d="M41 36 Q85 44 129 36 L129 41 L41 41 Z" fill="rgba(255,255,255,0.05)" />
      <circle cx="85" cy="44" r="1.2" fill="#7f857d" />
      <rect x="36" y="1" width="98" height="1.2" rx="0.6" fill="rgba(255,255,255,0.55)" />

      {/* desk objects: notebook, keyboard, mouse, mug */}
      <g className="desk-props">
        <g transform="rotate(-4 32 58)">
          <rect x="17" y="54" width="31" height="12" rx="1.6" fill="#d9c9ad" />
          <rect x="17" y="54" width="31" height="3" rx="1.4" fill="#b9a483" />
          <line x1="21" y1="60" x2="42" y2="60" stroke="#8f7a5c" strokeWidth="1" opacity="0.45" />
          <line x1="21" y1="63" x2="37" y2="63" stroke="#8f7a5c" strokeWidth="1" opacity="0.35" />
        </g>
        <g className="keyboard">
          <path d="M54 54 L118 54 L121 64 L51 64 Z" fill="#ded7c8" stroke="#a89f8d" strokeWidth="1" />
          <path d="M57 56 L115 56 L117 60 L55 60 Z" fill="rgba(255,255,255,0.35)" />
          <g stroke="#b9b09f" strokeWidth="0.9" opacity="0.8">
            <line x1="57" y1="57.5" x2="114" y2="57.5" />
            <line x1="56" y1="59.5" x2="116" y2="59.5" />
            <line x1="55" y1="61.5" x2="118" y2="61.5" />
          </g>
        </g>
        <g className="mouse">
          <ellipse cx="132" cy="60" rx="8" ry="5" fill="#e7e0d3" stroke="#ada493" strokeWidth="1" />
          <line x1="132" y1="55.5" x2="132" y2="58.5" stroke="#afa694" strokeWidth="1" />
          <path d="M126 60 Q126 56.5 129 55.5" stroke="rgba(255,255,255,0.55)" fill="none" strokeWidth="1" />
        </g>
        <g className="mug">
          <ellipse cx="151" cy="64" rx="7" ry="2.2" fill="rgba(37,28,19,0.18)" />
          <path d="M145 55 L157 55 L156 64 Q151 67 146 64 Z" fill="#cfc4b2" stroke="#9e927f" strokeWidth="0.9" />
          <ellipse cx="151" cy="55" rx="6" ry="2.1" fill="#e9e1d3" />
          <path d="M157 58 Q163 58 162 61 Q161 64 156 63" fill="none" stroke="#b3a794" strokeWidth="1.4" />
          <path d="M149 51 Q147 47 150 44 M153 51 Q155 47 152 43" stroke="rgba(255,255,255,0.28)" strokeWidth="1.1" fill="none" />
        </g>
        <g className="desk-plant">
          <ellipse cx="17" cy="51" rx="7" ry="2" fill="rgba(37,28,19,0.16)" />
          <path d="M10 43 L24 43 L22 51 L12 51 Z" fill="#b06e4a" />
          <path d="M20 44 Q15 35 19 30 Q22 35 20 44" fill="#4e7049" />
          <path d="M21 45 Q27 36 25 29 Q30 34 24 46" fill="#63855a" />
          <path d="M18 45 Q11 38 12 32 Q17 37 19 45" fill="#789a6c" />
        </g>
      </g>

      {/* cable from the monitor foot to the desk edge */}
      <path d="M92 51 Q108 52 113 66" stroke="#3a362e" strokeWidth="1" fill="none" opacity="0.35" />
    </svg>
  );
}

/**
 * The monitor's picture, switched by the desk's activity state. Coordinates
 * stay inside the screen rect (41,5)-(129,41).
 *
 * @param {{ activity: import("./scene/deskActivity.js").DeskActivityState }} props
 */
function ScreenPicture({ activity }) {
  const tone = activity.screenTone;
  if (tone === "pass") {
    // 测试通过 → whole screen goes 绿
    return (
      <g data-testid="desk-screen" data-screen="test-pass">
        <rect x="41" y="5" width="88" height="36" rx="3" fill="#3f7d55" className="screen-wash" />
        <polyline points="70,23 80,32 102,13" fill="none" stroke="#eef6ea" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  if (tone === "fail") {
    // 测试失败 → whole screen goes 红
    return (
      <g data-testid="desk-screen" data-screen="test-fail">
        <rect x="41" y="5" width="88" height="36" rx="3" fill="#a03a28" className="screen-wash" />
        <g stroke="#fbeeea" strokeWidth="5" strokeLinecap="round">
          <line x1="74" y1="14" x2="96" y2="33" />
          <line x1="96" y1="14" x2="74" y2="33" />
        </g>
      </g>
    );
  }

  if (activity.activity === null) {
    // 空闲：暗屏 + 待机电源点
    return (
      <g data-testid="desk-screen" data-screen="idle">
        <circle cx="85" cy="39.5" r="0.9" fill="#8fa08c" />
      </g>
    );
  }

  switch (activity.activity) {
    case "read":
      // 阅读：一页文档 + 段落行
      return (
        <g data-testid="desk-screen" data-screen="read">
          <rect x="47" y="8" width="46" height="30" rx="2" fill="#f2ede0" />
          <g fill="#7d7466">
            <rect x="51" y="12" width="34" height="2" rx="1" />
            <rect x="51" y="17" width="38" height="2" rx="1" />
            <rect x="51" y="22" width="30" height="2" rx="1" />
            <rect x="51" y="27" width="36" height="2" rx="1" />
            <rect x="51" y="32" width="24" height="2" rx="1" />
          </g>
          <g fill="#c9c0ae">
            <rect x="99" y="10" width="24" height="3" rx="1.5" />
            <rect x="99" y="16" width="20" height="3" rx="1.5" />
            <rect x="99" y="22" width="24" height="3" rx="1.5" className="screen-line-b" />
            <rect x="99" y="28" width="16" height="3" rx="1.5" />
            <rect x="99" y="34" width="22" height="3" rx="1.5" />
          </g>
        </g>
      );
    case "write":
      // 写代码：彩色代码行 + 闪烁光标
      return (
        <g data-testid="desk-screen" data-screen="write">
          <g>
            <rect x="45" y="9" width="26" height="3" rx="1.5" fill="#c8a24a" />
            <rect x="50" y="15" width="42" height="3" rx="1.5" fill="#8fb0c9" />
            <rect x="50" y="21" width="34" height="3" rx="1.5" fill="#8fb0c9" />
            <rect x="55" y="27" width="48" height="3" rx="1.5" fill="#9ec98f" />
            <rect x="50" y="33" width="22" height="3" rx="1.5" fill="#c9a3b0" />
          </g>
          <rect x="76" y="32" width="3" height="6" fill="#f2ede0" className="screen-cursor" />
          <path d="M104 12 l10 8 -10 8 z" fill="rgba(255,255,255,0.14)" />
        </g>
      );
    case "exec":
      // 终端：提示符 + 输出行 + 光标
      return (
        <g data-testid="desk-screen" data-screen="exec">
          <g fill="#9ec98f">
            <rect x="45" y="9" width="4" height="3" rx="1" />
            <rect x="51" y="9" width="30" height="3" rx="1.5" fill="#f2ede0" />
          </g>
          <g fill="#c9c0ae">
            <rect x="51" y="15" width="44" height="3" rx="1.5" />
            <rect x="51" y="21" width="30" height="3" rx="1.5" />
            <rect x="51" y="27" width="52" height="3" rx="1.5" className="screen-line-b" />
          </g>
          <g fill="#9ec98f">
            <rect x="45" y="33" width="4" height="3" rx="1" />
            <rect x="51" y="33" width="12" height="3" rx="1.5" fill="#f2ede0" />
          </g>
          <rect x="66" y="32" width="3" height="6" fill="#f2ede0" className="screen-cursor" />
        </g>
      );
    case "test":
      // 测试进行中：跑条清单 + 进度条（结果出来整屏红/绿，见上）
      return (
        <g data-testid="desk-screen" data-screen="test-run">
          <g stroke="#9ec98f" strokeWidth="1.6" strokeLinecap="round">
            <polyline points="47,11 49,13 53,8" fill="none" />
            <polyline points="47,18 49,20 53,15" fill="none" />
          </g>
          <g fill="#c9c0ae">
            <rect x="57" y="9" width="38" height="3" rx="1.5" />
            <rect x="57" y="16" width="30" height="3" rx="1.5" />
          </g>
          <rect x="57" y="23" width="4" height="3" rx="1.5" fill="#c8a24a" className="screen-line-b" />
          <rect x="45" y="33" width="76" height="5" rx="2.5" fill="#2c332b" />
          <rect x="47" y="35" width="40" height="1.6" rx="0.8" fill="#9ec98f" className="screen-progress" />
        </g>
      );
    default:
      // 未知工具：通用敲键盘画面（干活，只是说不出在干啥）
      return (
        <g data-testid="desk-screen" data-screen="work">
          <g fill="#c9c0ae">
            <rect x="45" y="11" width="38" height="3" rx="1.5" />
            <rect x="45" y="18" width="52" height="3" rx="1.5" className="screen-line-b" />
            <rect x="45" y="25" width="30" height="3" rx="1.5" />
          </g>
          <rect x="79" y="24" width="3" height="6" fill="#f2ede0" className="screen-cursor" />
        </g>
      );
  }
}

/** Chair seat cushion — painted under the seated person.
 * @param {{ uid: string }} props
 */
function ChairSeatSvg({ uid }) {
  return (
    <svg className="desk-art" viewBox="0 0 170 152" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-chair-seat`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#68715f" />
          <stop offset="1" stopColor="#444b40" />
        </linearGradient>
      </defs>
      <ellipse cx="85" cy="80" rx="27" ry="7" fill="rgba(34,27,21,0.18)" />
      <path d="M63 66 Q85 61 107 66 L112 76 Q85 81 58 76 Z" fill={`url(#${uid}-chair-seat)`} />
      <path d="M63 66 Q85 62 107 66" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" fill="none" />
      <path d="M63 71 Q85 68 107 71" stroke="rgba(22,26,20,0.22)" strokeWidth="1" fill="none" />
    </svg>
  );
}

/** Chair backrest + gas lift + five-star base — painted OVER the person's
 *  lower torso, so they read as sitting IN the chair, viewer-side.
 * @param {{ uid: string }} props
 */
function ChairBackSvg({ uid }) {
  return (
    <svg className="desk-art" viewBox="0 0 170 152" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-chair-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5f6859" />
          <stop offset="0.6" stopColor="#475044" />
          <stop offset="1" stopColor="#343c33" />
        </linearGradient>
        <linearGradient id={`${uid}-chair-mesh`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#737d6c" />
          <stop offset="1" stopColor="#4b5447" />
        </linearGradient>
      </defs>
      <g className="chair">
        <path d="M57 78 Q58 72 64 72 L106 72 Q112 72 113 78 L116 98 Q116 108 106 108 L64 108 Q54 108 54 98 Z" fill={`url(#${uid}-chair-shell)`} />
        <path d="M63 79 Q64 76 68 76 L102 76 Q106 76 107 79 L109 95 Q109 101 103 101 L67 101 Q61 101 61 95 Z" fill={`url(#${uid}-chair-mesh)`} />
        <g stroke="rgba(27,32,25,0.20)" strokeWidth="0.8">
          <line x1="68" y1="78" x2="67" y2="99" />
          <line x1="76" y1="76.5" x2="75" y2="100" />
          <line x1="84" y1="76" x2="84" y2="100" />
          <line x1="92" y1="76.5" x2="93" y2="100" />
          <line x1="100" y1="78" x2="101" y2="99" />
          <line x1="63" y1="85" x2="108" y2="85" />
          <line x1="62" y1="93" x2="109" y2="93" />
        </g>
        <path d="M58 78 Q57 72 64 72" stroke="rgba(255,255,255,0.18)" strokeWidth="1.4" fill="none" />
        <rect x="82" y="107" width="7" height="12" rx="2" fill="#262b24" />
        <rect x="84" y="107" width="2" height="12" fill="rgba(255,255,255,0.12)" />
        <g stroke="#2b3029" strokeWidth="3" strokeLinecap="round">
          <line x1="85" y1="120" x2="60" y2="129" />
          <line x1="85" y1="120" x2="110" y2="129" />
          <line x1="85" y1="120" x2="73" y2="134" />
          <line x1="85" y1="120" x2="97" y2="134" />
        </g>
        <g fill="#232822">
          <circle cx="60" cy="130" r="3.2" />
          <circle cx="110" cy="130" r="3.2" />
          <circle cx="73" cy="135" r="3.2" />
          <circle cx="97" cy="135" r="3.2" />
        </g>
        <g fill="rgba(255,255,255,0.24)">
          <circle cx="59.2" cy="129" r="1" />
          <circle cx="109.2" cy="129" r="1" />
          <circle cx="72.2" cy="134" r="1" />
          <circle cx="96.2" cy="134" r="1" />
        </g>
      </g>
    </svg>
  );
}

/** The chair left empty while the employee is 去倒咖啡 (chair + mug spot). */
function CoffeeChairSvg() {
  return (
    <svg className="desk-art desk-art-away" viewBox="0 0 170 152" aria-hidden="true" data-testid="desk-empty-chair">
      <g className="coffee-cup">
        <ellipse cx="132" cy="68" rx="8" ry="2.4" fill="rgba(34,27,21,0.16)" />
        <path d="M126 58 L138 58 L137 67 Q132 70 127 67 Z" fill="#c9bca8" stroke="#9b8d78" strokeWidth="0.9" />
        <ellipse cx="132" cy="58" rx="6" ry="2.2" fill="#e8dfd1" />
        <path d="M138 61 Q144 61 143 64 Q142 67 137 66" fill="none" stroke="#b1a38e" strokeWidth="1.3" />
        <path d="M130 54 Q128 50 131 47 M134 54 Q136 50 133 46" stroke="rgba(255,255,255,0.30)" strokeWidth="1.1" fill="none" />
      </g>
      <g className="coffee-steam" opacity="0.45">
        <path d="M128 48 Q126 44 129 41" stroke="#f5ead8" strokeWidth="1" fill="none" />
        <path d="M134 47 Q136 43 133 40" stroke="#f5ead8" strokeWidth="1" fill="none" />
      </g>
    </svg>
  );
}

/**
 * The seated employee, BACK view — they face the monitor, away from the
 * dollhouse camera. Role reads from clothing color + back-readable features.
 * Posture (ticket 07): work = typing at the keyboard; idle = hands down;
 * slack = leaning back at a glowing phone; coffee = not here (see CoffeeChairSvg).
 *
 * @param {{ uid: string, roleKey: string, posture: "idle" | "slack" | "coffee" | "work", working: boolean }} props
 */
function SeatedPersonSvg({ uid, roleKey, posture, working }) {
  const color = appearanceFor(roleKey);
  const slacking = posture === "slack";
  return (
    <svg
      className={`desk-art desk-person ${working ? "person-typing" : ""} ${slacking ? "person-slack" : ""}`}
      viewBox="0 0 170 152"
      aria-hidden="true"
      data-testid="desk-person"
      data-role-key={roleKey}
      data-posture={posture}
    >
      <defs>
        <linearGradient id={`${uid}-person-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color.top} />
          <stop offset="1" stopColor="rgba(25,30,33,0.82)" />
        </linearGradient>
        <radialGradient id={`${uid}-person-hair`} cx="35%" cy="24%" r="80%">
          <stop offset="0" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="0.48" stopColor={color.hair} />
          <stop offset="1" stopColor="rgba(18,20,22,0.94)" />
        </radialGradient>
      </defs>

      {slacking ? (
        <g className="person-slack-body">
          {/* leaning back, phone held up — screen glow reaches the head */}
          <path d="M72 70 L63 60" stroke={color.top} strokeWidth="8" strokeLinecap="round" />
          <path d="M99 70 L91 62" stroke={color.top} strokeWidth="8" strokeLinecap="round" />
          <circle cx="62" cy="58.5" r="4.1" fill={color.skin} />
          <circle cx="90.5" cy="60" r="4.1" fill={color.skin} />
          <rect x="73.5" y="53" width="10" height="6.4" rx="1.8" fill="#dfe8f2" className="slack-phone" />
          <path d="M62 94 Q62 66 85 65 Q108 66 108 94 Z" fill={`url(#${uid}-person-top)`} />
          <path d="M70 82 Q85 76 100 82" stroke="rgba(255,255,255,0.10)" strokeWidth="1.2" fill="none" />
          <rect x="80" y="61" width="10" height="6" rx="2.5" fill={color.skin} />
          <circle cx="85" cy="53.5" r="11" fill={`url(#${uid}-person-hair)`} />
          <path d="M75 51 Q78 44 85 43.5" stroke="rgba(255,255,255,0.24)" strokeWidth="1.2" fill="none" />
          {color.decor === "headset" ? (
            <g>
              <path d="M74.5 50 Q75 42 85 42 Q95 42 95.5 50" stroke="#313831" strokeWidth="2.6" fill="none" />
              <rect x="72.4" y="48.5" width="4.6" height="9" rx="2.3" fill="#313831" />
              <rect x="93" y="48.5" width="4.6" height="9" rx="2.3" fill="#313831" />
            </g>
          ) : null}
          <path d="M78 68 Q85 72 92 68" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none" />
        </g>
      ) : (
        <g className="person-work-body">
          {/* arms reaching over the near desk edge to keyboard/mouse */}
          <path d="M72 67 L58 59" stroke={color.top} strokeWidth="8.4" strokeLinecap="round" />
          <path d="M98 67 L111 59" stroke={color.top} strokeWidth="8.4" strokeLinecap="round" />
          <path d="M73 65 L62 58" stroke="rgba(255,255,255,0.12)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M97 65 L108 58" stroke="rgba(255,255,255,0.10)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="57" cy="58" r="4.1" fill={color.skin} className="person-hand person-hand-l" />
          <circle cx="112" cy="58" r="4.1" fill={color.skin} className="person-hand person-hand-r" />
          {/* torso: shoulders wide, body continues behind the backrest */}
          <path d="M63 94 Q63 66 85 65 Q107 66 107 94 Z" fill={`url(#${uid}-person-top)`} />
          <path d="M70 83 Q85 77 100 83" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" fill="none" />
          <path d="M71 67 Q85 73 99 67" stroke="rgba(0,0,0,0.18)" strokeWidth="1.2" fill="none" />
          {/* scarf/collar across the shoulders (visible from behind) */}
          {color.decor === "tie" ? <path d="M72 70 Q85 76 98 70 L98 74 Q85 80 72 74 Z" fill="#c98a2c" /> : null}
          {/* head from behind: all hair, a hint of neck */}
          <rect x="80" y="59" width="10" height="7" rx="2.5" fill={color.skin} />
          <circle cx="85" cy="53.5" r="11" fill={`url(#${uid}-person-hair)`} />
          <path d="M75 51 Q78 44 85 43.5" stroke="rgba(255,255,255,0.24)" strokeWidth="1.2" fill="none" />
          <path d="M92 45 Q98 48 96 54" stroke="rgba(255,255,255,0.10)" strokeWidth="1.2" fill="none" />
          {/* glasses temples running to the ears */}
          {color.decor === "glasses" ? (
            <g stroke="#1d211e" strokeWidth="1.35">
              <line x1="75" y1="53" x2="73.7" y2="56" />
              <line x1="95" y1="53" x2="96.3" y2="56" />
            </g>
          ) : null}
          {/* headset seen from behind: band + ear cups */}
          {color.decor === "headset" ? (
            <g>
              <path d="M74.5 50 Q75 42 85 42 Q95 42 95.5 50" stroke="#313831" strokeWidth="2.6" fill="none" />
              <rect x="72.4" y="48.5" width="4.6" height="9" rx="2.3" fill="#313831" />
              <rect x="93" y="48.5" width="4.6" height="9" rx="2.3" fill="#313831" />
              <circle cx="74.7" cy="54" r="1" fill="rgba(255,255,255,0.24)" />
            </g>
          ) : null}
          <path d="M77 60 Q85 63 93 60" stroke="rgba(0,0,0,0.14)" strokeWidth="1" fill="none" />
        </g>
      )}
    </svg>
  );
}

/**
 * A 52,345-token badge is unreadable on a 12px nameplate; full numbers remain
 * in the task detail / company panel. e2e-12's plate assertion accepts both.
 *
 * @param {number} total
 * @returns {string}
 */
function compactToken(total) {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}m`;
  if (total >= 10_000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}
