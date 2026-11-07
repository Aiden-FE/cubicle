import React, { useCallback, useEffect, useState } from "react";
import { groupTasksForHandle } from "./scene/handleGroups.js";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const RUN_TOPIC = "run.event";
const DOMAIN_TOPIC = "domain.changed";

const STATUS_LABELS = /** @type {Record<string, string>} */ ({ open: "待办", running: "进行中", review: "待验收", done: "完成", failed: "失败" });

/**
 * 右缘任务把手的抽屉（票 08 验收 2）：拉开是「进行中 / 待验收 / 档案」三段
 * （档案 = 完成 + 失败）。徽标本身在 App（handle-active，走快照 taskCounts
 * 口径）；这里的数据走 task.list 的公司范围查询，分组是 scene/handleGroups.js
 * 的纯函数（node:test 钉三段语义）。
 *
 * 仍是浮层：absolute 覆盖在画布上，画布尺寸不为它让路（硬约束）。
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   onClose: () => void,
 * }} props
 */
export function TaskHandle({ snapshot, onClose }) {
  const [tasks, setTasks] = useState(/** @type {{ id: number, title: string, status: string, employeeName: string }[]} */ ([]));
  const companyId = snapshot?.activeCompanyId ?? null;

  const loadTasks = useCallback(async () => {
    if (companyId === null) {
      setTasks([]);
      return;
    }
    try {
      const result = /** @type {{ tasks: typeof tasks }} */ (await window.cubicle.invoke("task.list", { companyId }));
      setTasks(result.tasks);
    } catch {
      // 后台打了个盹：把手留着上一次列表，下一次事件再更新
    }
  }, [companyId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // 与工单台同一个更新节奏：任务域事件 + run 收尾（收尾后状态由 host 落库，
  // 没有 domain 事件，只能认 agent_end）。
  useEffect(() => {
    const unsubscribeDomain = window.cubicle.subscribe(DOMAIN_TOPIC, (envelope) => {
      const reason = /** @type {{ reason?: string }} */ (envelope.payload ?? {}).reason ?? "";
      if (!reason.startsWith("task.") && reason !== "office.setActive") return;
      void loadTasks();
    });
    const unsubscribeRun = window.cubicle.subscribe(RUN_TOPIC, (envelope) => {
      const payload = /** @type {{ event: { type: string } }} */ (envelope.payload);
      if (payload.event.type !== "agent_end") return;
      void loadTasks();
    });
    return () => {
      unsubscribeDomain();
      unsubscribeRun();
    };
  }, [loadTasks]);

  const sections = groupTasksForHandle(tasks);

  return (
    <aside className="handle-drawer" data-testid="handle-drawer">
      <header className="task-header">
        <div className="task-title">任务把手</div>
        <button type="button" className="task-close" data-testid="handle-close" onClick={onClose} aria-label="收起任务把手">
          ✕
        </button>
      </header>
      <HandleSection testid="handle-running" title="进行中" tasks={sections.running} empty="没有进行中的工单。" />
      <HandleSection testid="handle-review" title="待验收" tasks={sections.review} empty="没有等验收的工单。" />
      <HandleSection testid="handle-archive" title="档案" tasks={sections.archive} empty="档案是空的。" />
    </aside>
  );
}

/**
 * @param {{ testid: string, title: string, tasks: { id: number, title: string, status: string, employeeName: string }[], empty: string }} props
 */
function HandleSection({ testid, title, tasks, empty }) {
  return (
    <section className="handle-section" data-testid={testid}>
      <div className="handle-section-title">{title} · {tasks.length}</div>
      {tasks.length === 0 ? <div className="task-empty">{empty}</div> : null}
      {tasks.map((task) => (
        <div key={task.id} className="handle-row" data-testid="handle-row" data-task-id={task.id} data-status={task.status}>
          <span className="task-row-title">#{task.id} {task.title}</span>
          <span className="task-row-meta">
            {task.employeeName} · {STATUS_LABELS[task.status] ?? task.status}
          </span>
        </div>
      ))}
    </section>
  );
}
