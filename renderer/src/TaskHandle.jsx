import React, { useCallback, useEffect, useRef, useState } from "react";
import { groupTasksForHandle } from "./scene/handleGroups.js";
import { useDialog } from "./useDialog.js";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const RUN_TOPIC = "run.event";
const DOMAIN_TOPIC = "domain.changed";

const STATUS_LABELS = /** @type {Record<string, string>} */ ({ open: "待办", running: "进行中", review: "待验收", done: "完成", failed: "失败" });

/**
 * 右缘任务把手的抽屉（票 08 验收 2）：拉开是「中断待处置 / 进行中 / 待验收 / 档案」
 * 四段（档案 = 完成 + 失败）。徽标本身在 App（handle-active，走快照 taskCounts
 * 口径）；这里的数据走 task.list 的公司范围查询，分组是 scene/handleGroups.js
 * 的纯函数（node:test 钉四段语义）。
 *
 * 票 10 的第一段「中断待处置」：崩溃/强杀重启后，被自愈标记的任务在这里等
 * 老板三选（续跑 / 重跑 / 放弃）—— 续跑按钮只在 host 说 canResume 时出现
 * （引擎声明可恢复 + 恢复指针在场），否则诚实显示原因并只给重跑/放弃。
 * 不静默自动续跑：这一段不会自己消失，处置完才走。
 *
 * 仍是浮层：absolute 覆盖在画布上，画布尺寸不为它让路（硬约束）。
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   onClose: () => void,
 *   onOpenTask: (taskId?: number | null) => void,
 * }} props
 */
export function TaskHandle({ snapshot, onClose, onOpenTask }) {
  const [tasks, setTasks] = useState(/** @type {{ id: number, title: string, status: string, employeeName: string, latestSessionStatus?: string | null }[]} */ ([]));
  // 票 10: taskId → 续跑判决（canResume + 为什么不能续跑），来自 task.interrupted.list。
  const [resumable, setResumable] = useState(
    /** @type {() => Map<number, { canResume: boolean, resumeHint: string | null }>} */ (() => new Map()),
  );
  const [loadError, setLoadError] = useState(false);
  const companyId = snapshot?.activeCompanyId ?? null;

  const loadTasks = useCallback(async () => {
    if (companyId === null) {
      setTasks([]);
      setResumable(new Map());
      setLoadError(false);
      return;
    }
    try {
      const [listResult, interruptedResult] = await Promise.all([
        window.cubicle.invoke("task.list", { companyId }),
        window.cubicle.invoke("task.interrupted.list", { companyId }).catch(() => ({ tasks: [] })),
      ]);
      setTasks(/** @type {typeof tasks} */ (/** @type {any} */ (listResult).tasks));
      const verdicts = new Map();
      for (const row of /** @type {any[]} */ (/** @type {any} */ (interruptedResult).tasks ?? [])) {
        verdicts.set(Number(row.id), { canResume: row.canResume === true, resumeHint: row.resumeHint ?? null });
      }
      setResumable(verdicts);
      setLoadError(false);
    } catch {
      // A failed load is not an empty office: keep the last list but say so.
      setLoadError(true);
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

  const dialogRef = useDialog(onClose);

  return (
    <aside className="handle-drawer" data-testid="handle-drawer" ref={dialogRef} role="dialog" aria-modal="true" aria-label="工单把手" tabIndex={-1}>
      <header className="task-header">
        <div className="task-title">工单把手</div>
        <button type="button" className="task-close" data-testid="handle-close" onClick={onClose} aria-label="收起工单把手">
          ✕
        </button>
      </header>
      {loadError ? (
        <div className="handle-section">
          <div className="task-note" data-testid="handle-load-error">
            工单列表加载失败。
            <button type="button" className="task-mini-button" onClick={() => void loadTasks()}>重试</button>
          </div>
        </div>
      ) : null}
      {sections.interrupted.length > 0 ? (
        <InterruptedSection tasks={sections.interrupted} resumable={resumable} onActioned={() => void loadTasks()} onOpenTask={onOpenTask} />
      ) : null}
      <HandleSection testid="handle-running" title="进行中" tasks={sections.running} empty="没有进行中的工单。" onOpenTask={onOpenTask} />
      <HandleSection testid="handle-review" title="待验收" tasks={sections.review} empty="没有等验收的工单。" onOpenTask={onOpenTask} />
      <HandleSection testid="handle-archive" title="档案" tasks={sections.archive} empty="档案是空的。" onOpenTask={onOpenTask} />
    </aside>
  );
}

/**
 * 票 10 的「中断待处置」段：每张中断工单一行，三个出口按 host 的判决出现。
 * 处置走 task.resume / task.rerun / task.abandon（host 再验一次门 — 这里的
 * 按钮只是判决的镜像，不是权限本身）。
 *
 * @param {{
 *   tasks: { id: number, title: string, status: string, employeeName: string }[],
 *   resumable: Map<number, { canResume: boolean, resumeHint: string | null }>,
 *   onActioned: () => void,
 *   onOpenTask: (taskId: number) => void,
 * }} props
 */
function InterruptedSection({ tasks, resumable, onActioned, onOpenTask }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  /**
   * @param {"task.resume" | "task.rerun" | "task.abandon"} method
   * @param {number} taskId
   */
  const act = async (method, taskId) => {
    if (busyRef.current) return;
    if (method === "task.abandon" && !confirmAbandon) {
      setConfirmAbandon(true);
      setNote("再点一次「放弃」确认：工单进入失败归档，历史保留。");
      return;
    }
    setConfirmAbandon(false);
    setNote("");
    busyRef.current = true;
    setBusy(true);
    try {
      await window.cubicle.invoke(method, { taskId });
    } catch (err) {
      setNote(/** @type {{ message?: string }} */ (err ?? {}).message ?? "处置失败");
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
    onActioned();
  };
  return (
    <section className="handle-section handle-section-interrupted" data-testid="handle-interrupted">
      <div className="handle-section-title">中断待处置 · {tasks.length}</div>
      <div className="handle-interrupted-note" data-testid="interrupted-note">
        应用崩溃/强杀留下的工单。选一个出口：续跑（从断点继续）/ 重跑（原合同再来）/ 放弃（进失败归档，历史保留）。
      </div>
      {note ? <div className="task-note" data-testid="interrupted-error">{note}</div> : null}
      {tasks.map((task) => {
        const verdict = resumable.get(task.id) ?? { canResume: false, resumeHint: null };
        return (
          <div
            key={task.id}
            className="handle-row handle-row-interrupted"
            data-testid="interrupted-row"
            data-task-id={task.id}
            data-status={task.status}
            data-can-resume={verdict.canResume ? "true" : "false"}
          >
            <span className="task-row-title">#{task.id} {task.title}</span>
            <span className="task-row-meta">
              {task.employeeName} · <span className="task-interrupted-badge" data-testid="interrupted-badge">崩溃中断</span>
            </span>
            <span className="interrupted-actions">
              {verdict.canResume ? (
                <button type="button" className="task-mini-button" data-testid="interrupted-resume" disabled={busy} onClick={() => void act("task.resume", task.id)}>
                  续跑
                </button>
              ) : (
                <span className="interrupted-hint" data-testid="interrupted-hint" title={verdict.resumeHint ?? ""}>不能续跑</span>
              )}
              <button type="button" className="task-mini-button" data-testid="interrupted-rerun" disabled={busy} onClick={() => void act("task.rerun", task.id)}>
                重跑
              </button>
              <button type="button" className="task-mini-button task-mini-danger" data-testid="interrupted-abandon" disabled={busy} onClick={() => void act("task.abandon", task.id)}>
                放弃
              </button>
              <button type="button" className="task-mini-button" data-testid="interrupted-open" onClick={() => onOpenTask(task.id)}>
                查看
              </button>
            </span>
          </div>
        );
      })}
    </section>
  );
}

/**
 * @param {{ testid: string, title: string, tasks: { id: number, title: string, status: string, employeeName: string, latestSessionStatus?: string | null }[], empty: string, onOpenTask: (taskId: number) => void }} props
 */
function HandleSection({ testid, title, tasks, empty, onOpenTask }) {
  return (
    <section className="handle-section" data-testid={testid}>
      <div className="handle-section-title">{title} · {tasks.length}</div>
      {tasks.length === 0 ? <div className="task-empty">{empty}</div> : null}
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className="handle-row"
          data-testid="handle-row"
          data-task-id={task.id}
          data-status={task.status}
          data-paused={task.status === "running" && task.latestSessionStatus === "paused" ? "true" : "false"}
          onClick={() => onOpenTask(task.id)}
          title="在工单台打开"
        >
          <span className="task-row-title">#{task.id} {task.title}</span>
          <span className="task-row-meta">
            {task.employeeName} · {STATUS_LABELS[task.status] ?? task.status}
            {task.status === "running" && task.latestSessionStatus === "paused" ? (
              <span className="task-paused-badge" data-testid="handle-paused-badge">已下班·暂停</span>
            ) : null}
          </span>
        </button>
      ))}
    </section>
  );
}
