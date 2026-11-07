import React from "react";
import { Switcher } from "./Switcher.jsx";

/**
 * 左轨（票 08 主界面外壳）：公司切换 / 工单台 / 花名册 / 引擎中心 四个入口。
 * 全部是浮层触发器 —— 主画布永远是办公室（硬约束），这里只是把手。
 *
 * Switcher 从票 02 的悬浮条收进左轨：公司/项目组触发器排成竖列，面板向右
 * 弹出；公司列表里显示各公司活跃数（进行中/待验收，来自 office.get 的
 * taskCounts 聚合）。
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   onChanged: () => Promise<void> | void,
 *   benchOpen: boolean,
 *   onToggleBench: () => void,
 *   rosterOpen: boolean,
 *   onToggleRoster: () => void,
 *   engineOpen: boolean,
 *   onToggleEngine: () => void,
 *   dutyOpen: boolean,
 *   onToggleDuty: () => void,
 *   aboutOpen: boolean,
 *   onToggleAbout: () => void,
 * }} props
 */
export function LeftRail({ snapshot, onChanged, benchOpen, onToggleBench, rosterOpen, onToggleRoster, engineOpen, onToggleEngine, dutyOpen, onToggleDuty, aboutOpen, onToggleAbout }) {
  return (
    <nav className="left-rail" data-testid="left-rail" aria-label="主界面左轨">
      <div className="rail-switcher">
        <Switcher snapshot={snapshot} onChanged={onChanged} />
      </div>
      <button
        type="button"
        className="rail-button"
        data-testid="task-rail"
        aria-expanded={benchOpen ? "true" : "false"}
        onClick={onToggleBench}
      >
        工单台
      </button>
      <button
        type="button"
        className="rail-button"
        data-testid="rail-roster"
        aria-expanded={rosterOpen ? "true" : "false"}
        onClick={onToggleRoster}
      >
        花名册
      </button>
      <button
        type="button"
        className="rail-button"
        data-testid="rail-engine"
        aria-expanded={engineOpen ? "true" : "false"}
        onClick={onToggleEngine}
      >
        引擎中心
      </button>
      {/* 票 09: 上下班 — 时间表配置 + 手动 override + 当前相位，全是浮层。 */}
      <button
        type="button"
        className="rail-button"
        data-testid="rail-duty"
        aria-expanded={dutyOpen ? "true" : "false"}
        onClick={onToggleDuty}
      >
        上下班
      </button>
      {/* 票 13: 关于页 — 版本号（安装包 metadata）浮层，入口排左轨末尾。 */}
      <button
        type="button"
        className="rail-button"
        data-testid="rail-about"
        aria-expanded={aboutOpen ? "true" : "false"}
        onClick={onToggleAbout}
      >
        关于
      </button>
    </nav>
  );
}
