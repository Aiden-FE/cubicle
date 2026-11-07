import React, { useCallback, useEffect, useState } from "react";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const DOMAIN_TOPIC = "domain.changed";

const PHASE_LABELS = /** @type {Record<string, string>} */ ({ on: "上班中", grace: "宽限中", off: "下班中" });

/**
 * 上下班面板（票 09 左轨入口，浮层 —— 画布仍是 100% 办公室）：
 *  - 每公司一份时间表（上下班时刻 + 宽限秒数）：可改、落库（验收 1）；
 *  - 「立即上班 / 立即下班」= 手动 override：立即生效，且面板明说它不改
 *    时间表（验收 2 的两条独立状态在界面上也分开展示）；
 *  - 当前相位（上班中/宽限中/下班中）来自 host 的 duty 状态，1s 轮询刷新
 *    （相位是时间推出来的，没有事件可订阅 —— 这是视图里唯一诚实的轮询）。
 *
 * @param {{ snapshot: import("./App.jsx").OfficeSnapshotData | null, onClose: () => void }} props
 */
export function WorkClockPanel({ snapshot, onClose }) {
  const companyId = snapshot?.activeCompanyId ?? null;
  const [info, setInfo] = useState(/** @type {ScheduleInfo | null} */ (null));
  const [workStart, setWorkStart] = useState("");
  const [workEnd, setWorkEnd] = useState("");
  const [graceSeconds, setGraceSeconds] = useState("90");
  const [note, setNote] = useState(/** @type {string | null} */ (null));

  const load = useCallback(async () => {
    if (companyId === null) return;
    try {
      const data = /** @type {ScheduleInfo} */ (await window.cubicle.invoke("schedule.get", { companyId }));
      setInfo(data);
      setWorkStart(data.schedule.workStart);
      setWorkEnd(data.schedule.workEnd);
      setGraceSeconds(String(data.schedule.graceSeconds));
    } catch {
      // 后台打了个盹：面板留着上一次读数
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    const unsubscribe = window.cubicle.subscribe(DOMAIN_TOPIC, (envelope) => {
      const reason = /** @type {{ reason?: string }} */ (envelope.payload ?? {}).reason ?? "";
      if (reason === "schedule.set" || reason === "duty.override" || reason === "office.setActive") void load();
    });
    // 相位随真实时间流动（下班点/宽限到点没有 domain 事件）：轻量轮询。
    const timer = setInterval(() => void load(), 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [load]);

  const save = async () => {
    if (companyId === null) return;
    setNote(null);
    try {
      await window.cubicle.invoke("schedule.set", {
        companyId,
        workStart: workStart.trim(),
        workEnd: workEnd.trim(),
        graceSeconds: Number(graceSeconds),
      });
      await load();
      setNote("时间表已保存（落库，重启不丢）。");
    } catch (err) {
      const failure = /** @type {{ code?: string, message?: string }} */ (err);
      setNote(failure.code === "invalid_payload" ? failure.message ?? "时间表不合法。" : `保存失败：${failure.code ?? "unknown"}`);
    }
  };

  const override = async (/** @type {"on" | "off"} */ mode) => {
    if (companyId === null) return;
    setNote(null);
    try {
      const result = /** @type {{ phase: string }} */ (await window.cubicle.invoke("duty.override", { companyId, mode }));
      await load();
      setNote(mode === "off" ? "已立即下班：在跑的活儿先进宽限收尾……" : "已立即上班：有未完成任务的员工开始续跑。");
      void result;
    } catch (err) {
      setNote(`操作失败：${/** @type {{ code?: string }} */ (err).code ?? "unknown"}`);
    }
  };

  const phase = info?.status?.phase ?? "on";

  return (
    <aside className="rail-drawer workclock-panel" data-testid="workclock-panel">
      <header className="task-header">
        <div className="task-title">上下班</div>
        <button type="button" className="task-close" data-testid="workclock-close" onClick={onClose} aria-label="收起上下班面板">
          ✕
        </button>
      </header>

      <div className="workclock-phase-row">
        <span className={`duty-phase chip-phase-${phase}`} data-testid="duty-phase" data-phase={phase}>
          {PHASE_LABELS[phase] ?? phase}
        </span>
        {info?.override ? (
          <span className="duty-override-note" data-testid="duty-override-note">
            手动{info.override.mode === "off" ? "下班" : "上班"}中（到下一个排班时点自动恢复）
          </span>
        ) : null}
      </div>

      <div className="workclock-actions">
        <button type="button" className="duty-on" data-testid="duty-on" onClick={() => void override("on")}>
          立即上班
        </button>
        <button type="button" className="duty-off" data-testid="duty-off" onClick={() => void override("off")}>
          立即下班
        </button>
      </div>
      <div className="workclock-hint" data-testid="workclock-override-hint">
        手动上下班立即生效，不会改动下面的时间表。
      </div>

      <section className="schedule-form" data-testid="schedule-form" data-configured={String(info?.configured ?? false)}>
        <label className="task-field-label" htmlFor="schedule-work-start">上班时间（HH:MM[:SS]）</label>
        <input id="schedule-work-start" className="schedule-input" data-testid="schedule-work-start" value={workStart} onChange={(event) => setWorkStart(event.target.value)} />
        <label className="task-field-label" htmlFor="schedule-work-end">下班时间（HH:MM[:SS]）</label>
        <input id="schedule-work-end" className="schedule-input" data-testid="schedule-work-end" value={workEnd} onChange={(event) => setWorkEnd(event.target.value)} />
        <label className="task-field-label" htmlFor="schedule-grace">下班宽限（秒）</label>
        <input id="schedule-grace" className="schedule-input" data-testid="schedule-grace" type="number" min={0} value={graceSeconds} onChange={(event) => setGraceSeconds(event.target.value)} />
        <button type="button" className="schedule-save" data-testid="schedule-save" onClick={() => void save()}>
          保存时间表
        </button>
      </section>
      {note ? <div className="task-note" data-testid="workclock-note">{note}</div> : null}
    </aside>
  );
}

/**
 * @typedef {object} ScheduleInfo
 * @property {{ workStart: string, workEnd: string, graceSeconds: number }} schedule
 * @property {boolean} configured
 * @property {{ mode: "on" | "off", at: number } | null} override
 * @property {{ phase: string, phaseSince: number | null, graceUntil: number | null }} status
 */
