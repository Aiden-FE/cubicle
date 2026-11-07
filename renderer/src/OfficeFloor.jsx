import React from "react";
import { deskStyle } from "./scene/domScene.js";
import { appearanceFor } from "./roleAppearance.js";
import { initialDeskActivity } from "./scene/deskActivity.js";
import { initialMotion } from "./scene/idleMotion.js";
import { deskSignals, bubbleTextFor } from "./scene/deskReadout.js";
import { tokenText } from "./scene/tokenReadout.js";

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

  return (
    <div className="office-floor" data-testid="office-floor">
      {!ready ? (
        <div className="scene-caption" data-testid="scene-caption">
          <span>{bridgeError ? "后台服务未连接，正在自动重试…" : "正在准备办公室…"}</span>
        </div>
      ) : null}

      <div className="room" data-testid="room">
        <div className="room-floor" />
        {snapshot?.desks.map((desk) => (
          <DeskCard
            key={desk.id}
            desk={desk}
            onHireAt={onHireAt}
            onTalkTo={onTalkTo}
            deskState={desk.occupant ? deskStates.get(desk.occupant.id) ?? null : null}
            tokenSummary={desk.occupant ? snapshot?.employeeTokens?.[String(desk.occupant.id)] ?? null : null}
            viewPrefs={viewPrefs}
          />
        ))}
      </div>
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
 * }} props
 */
function DeskCard({ desk, onHireAt, onTalkTo, deskState, tokenSummary, viewPrefs }) {
  const occupant = desk.occupant;
  const empty = occupant === null;
  const openDesk = empty ? () => onHireAt(desk) : occupant ? () => onTalkTo(occupant) : undefined;

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
      style={deskStyle(desk)}
      onClick={openDesk}
      onKeyDown={
        openDesk
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") openDesk();
            }
          : undefined
      }
    >
      {/* Layer order paints the seated person INTO the chair: desk &
          monitor → chair seat → person (back view) → chair backrest/base. */}
      <DeskArtSvg activity={activity} />
      <ChairSeatSvg />
      {!empty && !awayFromDesk ? (
        <SeatedPersonSvg roleKey={occupant.roleSnapshot.key} posture={motion.posture} working={working} />
      ) : null}
      {!empty && awayFromDesk ? <CoffeeChairSvg /> : null}
      <ChairBackSvg />

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
              ✋
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
          {working ? "干活中…" : `${occupant.name} · ${occupant.roleSnapshot.name}`}
          {/* 票 12 验收 3: 员工名牌上的员工级 token 聚合（host 聚合走信封）；
              未计量的引擎显示「未计量」，不是 0。 */}
          <span
            className="desk-plate-token"
            data-testid="desk-token"
            data-measured={tokenSummary?.measured === true ? "true" : "false"}
          >
            {tokenText(tokenSummary)}
          </span>
        </div>
      ) : null}
      {empty ? <div className="desk-plate desk-plate-empty">{desk.label} · 空闲</div> : null}
    </div>
  );
}

/**
 * Stylized workstation: desk with legs + shadow, monitor on a stand,
 * keyboard and mouse on the near edge (all facing a worker seated on the
 * viewer side). The monitor SCREEN (ticket 07) repaints with the desk's
 * activity: 读/写/执行/测试 each get their own picture, 测试结果 turns the
 * whole screen 红/绿.
 *
 * @param {{ activity: import("./scene/deskActivity.js").DeskActivityState }} props
 */
function DeskArtSvg({ activity }) {
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
        <ScreenPicture activity={activity} />
        <rect x="41" y="5" width="88" height="36" rx="3" fill="none" stroke="#1f231e" strokeWidth="1.2" />
        <path d="M41 36 Q85 44 129 36 L129 41 Q85 41 41 41 Z" fill="rgba(255,255,255,0.05)" />
        <path
          d="M85.5 43.6 c-1.7 0 -2.9 -1.2 -2.9 -2.9 0 -1.8 1.4 -3 3 -3 .6 0 1.1 .2 1.5 .5 -.4 .3 -.7 .8 -.7 1.4 0 1 .7 1.6 1.6 1.6 .5 0 .9 -.2 1.2 -.5 .2 .4 .3 .9 .3 1.4 -.5 .9 -1.6 1.5 -2.9 1.5 z"
          fill="#9a9d96"
        />
      </g>

      {/* keyboard + mouse on the near edge, toward the seated worker */}
      <rect x="52" y="52" width="50" height="9" rx="2.5" fill="#e4ddcd" stroke="#b9b1a0" strokeWidth="1" />
      <line x1="56" y1="55" x2="98" y2="55" stroke="#c8c0ae" strokeWidth="1" />
      <line x1="56" y1="58" x2="98" y2="58" stroke="#c8c0ae" strokeWidth="1" />
      <ellipse cx="116" cy="56" rx="7.5" ry="5.5" fill="#e4ddcd" stroke="#b9b1a0" strokeWidth="1" />
      <line x1="116" y1="51.5" x2="116" y2="56" stroke="#b9b1a0" strokeWidth="1" />
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

/** Chair seat cushion — painted under the seated person. */
function ChairSeatSvg() {
  return (
    <svg className="desk-art" viewBox="0 0 170 152" aria-hidden="true">
      <rect x="68" y="64" width="34" height="12" rx="6" fill="#5d6459" />
    </svg>
  );
}

/** Chair backrest + gas lift + five-star base — painted OVER the person's
 *  lower torso, so they read as sitting IN the chair, viewer-side. */
function ChairBackSvg() {
  return (
    <svg className="desk-art" viewBox="0 0 170 152" aria-hidden="true">
      <g className="chair">
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

/** The chair left empty while the employee is 去倒咖啡 (chair + mug spot). */
function CoffeeChairSvg() {
  return (
    <svg className="desk-art desk-art-away" viewBox="0 0 170 152" aria-hidden="true" data-testid="desk-empty-chair">
      <circle cx="128" cy="46" r="4" fill="none" stroke="#8a7a63" strokeWidth="1.4" />
      <path d="M124 50 h8 v6 a4 4 0 0 1 -8 0 z" fill="#8a7a63" />
    </svg>
  );
}

/**
 * The seated employee, BACK view — they face the monitor, away from the
 * dollhouse camera. Role reads from clothing color + back-readable features.
 * Posture (ticket 07): work = typing at the keyboard; idle = hands down;
 * slack = leaning back at a glowing phone; coffee = not here (see CoffeeChairSvg).
 *
 * @param {{ roleKey: string, posture: "idle" | "slack" | "coffee" | "work", working: boolean }} props
 */
function SeatedPersonSvg({ roleKey, posture, working }) {
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
      {slacking ? (
        <>
          {/* leaning back, phone held up — screen glow reaches the head */}
          <path d="M72 68 L64 60" stroke={color.top} strokeWidth="8" strokeLinecap="round" />
          <path d="M98 68 L92 61" stroke={color.top} strokeWidth="8" strokeLinecap="round" />
          <circle cx="63" cy="59" r="3.8" fill={color.skin} />
          <circle cx="91" cy="60" r="3.8" fill={color.skin} />
          <rect x="74" y="54" width="9" height="6" rx="1.5" fill="#dfe8f2" className="slack-phone" />
          <path d="M64 94 Q64 66 86 66 Q108 66 108 94 Z" fill={color.top} />
          <rect x="81" y="64" width="10" height="6" rx="2.5" fill={color.skin} />
          <circle cx="86" cy="57" r="10.5" fill={color.hair} className="slack-head" />
        </>
      ) : (
        <>
          {/* arms reaching over the near desk edge to keyboard/mouse */}
          <path d="M72 66 L58 58" stroke={color.top} strokeWidth="8" strokeLinecap="round" />
          <path d="M98 66 L110 58" stroke={color.top} strokeWidth="8" strokeLinecap="round" />
          <circle cx="57" cy="57" r="3.8" fill={color.skin} className="person-hand person-hand-l" />
          <circle cx="111" cy="57" r="3.8" fill={color.skin} className="person-hand person-hand-r" />
          {/* torso: shoulders wide, body continues behind the backrest */}
          <path d="M64 92 Q64 64 85 64 Q106 64 106 92 Z" fill={color.top} />
          {/* scarf/collar across the shoulders (visible from behind) */}
          {color.decor === "tie" ? <path d="M72 70 Q85 76 98 70 L98 74 Q85 80 72 74 Z" fill="#c98a2c" /> : null}
          {/* head from behind: all hair, a hint of neck */}
          <rect x="80" y="62" width="10" height="6" rx="2.5" fill={color.skin} />
          <circle cx="85" cy="55" r="10.5" fill={color.hair} />
          {/* glasses temples running to the ears */}
          {color.decor === "glasses" ? (
            <g stroke="#2b2620" strokeWidth="1.3">
              <line x1="75" y1="55" x2="74" y2="58" />
              <line x1="95" y1="55" x2="96" y2="58" />
            </g>
          ) : null}
          {/* headset seen from behind: band + ear cups */}
          {color.decor === "headset" ? (
            <g>
              <path d="M74.5 52 Q75 43.5 85 43.5 Q95 43.5 95.5 52" stroke="#313831" strokeWidth="2.6" fill="none" />
              <rect x="72.4" y="50" width="4.6" height="9" rx="2.3" fill="#313831" />
              <rect x="93" y="50" width="4.6" height="9" rx="2.3" fill="#313831" />
            </g>
          ) : null}
        </>
      )}
    </svg>
  );
}
