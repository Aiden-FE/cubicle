import React, { useCallback, useEffect, useRef, useState } from "react";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const RUN_TOPIC = "run.event";

const PLAYBOOK_LABELS = /** @type {Record<string, string>} */ ({ feature: "加功能", bugfix: "修 bug", docs: "写文档", free: "自由" });
const STATUS_LABELS = /** @type {Record<string, string>} */ ({ open: "待派单", running: "工作中", finished: "已交产出" });

/**
 * 工单台 — the work-order desk, a left-rail drawer (hard constraint: the
 * office stays the main canvas; 工单创建/列表只在浮层).
 *
 * One sentence → `task.draft` prefills a playbook + goal + acceptance
 * criteria, all editable (票 05: 一句话自动套 playbook，可手改目标与验收
 * 标准). 派单 creates the task (git start HEAD recorded or the host says
 * 工作区不是 git 仓库) and dispatches it. Finished tasks show the 四件套:
 * diff 摘要 / 变更文件清单 / 命令输出 / 收尾报告.
 *
 * @param {{ snapshot: import("./App.jsx").OfficeSnapshotData | null, onClose: () => void }} props
 */
export function TaskBench({ snapshot, onClose }) {
  const [tasks, setTasks] = useState(/** @type {TaskRowData[]} */ ([]));
  const [sentence, setSentence] = useState("");
  const [draft, setDraft] = useState(/** @type {TaskDraftData | null} */ (null));
  const [goal, setGoal] = useState("");
  const [acceptance, setAcceptance] = useState(/** @type {string[]} */ ([]));
  const [employeeId, setEmployeeId] = useState(/** @type {string} */ (""));
  const [note, setNote] = useState(/** @type {string | null} */ (null));
  const [openTaskId, setOpenTaskId] = useState(/** @type {number | null} */ (null));
  const [detail, setDetail] = useState(/** @type {TaskDetailData | null} */ (null));
  const editedContract = useRef(false);
  const draftTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  const groupId = snapshot?.activeGroupId ?? null;

  const loadTasks = useCallback(async () => {
    if (groupId === null) {
      setTasks([]);
      return;
    }
    try {
      const result = /** @type {{ tasks: TaskRowData[] }} */ (await window.cubicle.invoke("task.list", { groupId }));
      setTasks(result.tasks);
    } catch {
      // the desk keeps its last list if the host blinks
    }
  }, [groupId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // One sentence in — the playbook draft lands prefilled until the boss
  // edits goal/acceptance by hand.
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (sentence.trim().length === 0) {
      setDraft(null);
      return;
    }
    draftTimer.current = setTimeout(async () => {
      try {
        const result = /** @type {TaskDraftData} */ (await window.cubicle.invoke("task.draft", { text: sentence }));
        setDraft(result);
        if (!editedContract.current) {
          setGoal(result.goal);
          setAcceptance(result.acceptance);
        }
      } catch {
        setDraft(null);
      }
    }, 250);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [sentence]);

  const loadDetail = useCallback(
    /** @param {number} taskId */
    async (taskId) => {
      try {
        setDetail(/** @type {TaskDetailData} */ (await window.cubicle.invoke("task.detail", { taskId })));
      } catch {
        setDetail(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (openTaskId === null) {
      setDetail(null);
      return;
    }
    void loadDetail(openTaskId);
  }, [openTaskId, loadDetail]);

  // A run settling: re-pull the list and the open task's artifacts.
  useEffect(() => {
    const unsubscribe = window.cubicle.subscribe(RUN_TOPIC, (envelope) => {
      const payload = /** @type {{ event: { type: string } }} */ (envelope.payload);
      if (payload.event.type !== "agent_end") return;
      void loadTasks();
      if (openTaskId !== null) void loadDetail(openTaskId);
    });
    return unsubscribe;
  }, [loadTasks, loadDetail, openTaskId]);

  const employees = (snapshot?.desks ?? [])
    .map((desk) => desk.occupant)
    .filter((occupant) => occupant !== null);

  const dispatch = async () => {
    if (sentence.trim().length === 0 || !employeeId) return;
    setNote(null);
    try {
      const created = /** @type {{ task: TaskRowData }} */ (
        await window.cubicle.invoke("task.create", {
          employeeId: Number(employeeId),
          text: sentence.trim(),
          goal,
          acceptance,
          playbook: draft?.playbook,
        })
      );
      await window.cubicle.invoke("task.dispatch", { taskId: created.task.id });
      setSentence("");
      setDraft(null);
      setGoal("");
      setAcceptance([]);
      editedContract.current = false;
      await loadTasks();
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err).code ?? "task_create_failed";
      setNote(
        code === "not_a_git_workspace"
          ? "这个工作区不是 git 仓库：工单不可用（应用不会替你初始化仓库，先让员工的工作区成为一个 git 仓库）。"
          : code === "no_head_commit"
            ? "git 工作区还没有任何提交：工单不可用。"
            : code === "git_unavailable"
              ? "本机找不到 git 命令：工单需要 git 工作区才能记录起点。"
              : code === "task_running"
                ? "这张工单已经在跑了，等这一轮结束。"
                : `没能开单：${code}`,
      );
    }
  };

  const detailTask = detail?.task ?? null;

  return (
    <aside className="task-drawer" data-testid="task-bench">
      <header className="task-header">
        <div className="task-title">工单台</div>
        <button type="button" className="task-close" data-testid="task-close" onClick={onClose} aria-label="收起工单台">
          ✕
        </button>
      </header>

      <section className="task-form">
        <label className="task-field-label" htmlFor="task-sentence">一句话派活</label>
        <textarea
          id="task-sentence"
          className="task-sentence"
          data-testid="task-sentence"
          rows={2}
          placeholder="例如：给 greet.txt 加一行欢迎语"
          value={sentence}
          onChange={(event) => setSentence(event.target.value)}
        />

        {draft ? (
          <div className="task-playbook" data-testid="task-playbook" data-key={draft.playbook}>
            自动套用：{draft.label}
            <span className="task-playbook-hint">（目标与验收标准可手改）</span>
          </div>
        ) : null}

        <label className="task-field-label" htmlFor="task-goal">目标</label>
        <textarea
          id="task-goal"
          className="task-goal"
          data-testid="task-goal"
          rows={2}
          value={goal}
          onChange={(event) => {
            editedContract.current = true;
            setGoal(event.target.value);
          }}
        />

        <label className="task-field-label">验收标准</label>
        <ul className="task-acceptance-list" data-testid="task-acceptance-list">
          {acceptance.map((line, index) => (
            <li key={index} className="task-acceptance-row">
              <input
                className="task-acceptance-input"
                data-testid="task-acceptance"
                value={line}
                onChange={(event) => {
                  editedContract.current = true;
                  setAcceptance((prev) => prev.map((item, i) => (i === index ? event.target.value : item)));
                }}
              />
              <button
                type="button"
                className="task-acceptance-remove"
                data-testid="task-acceptance-remove"
                aria-label="删除这条验收标准"
                onClick={() => {
                  editedContract.current = true;
                  setAcceptance((prev) => prev.filter((_, i) => i !== index));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="task-acceptance-add"
          data-testid="task-acceptance-add"
          onClick={() => {
            editedContract.current = true;
            setAcceptance((prev) => [...prev, ""]);
          }}
        >
          + 加一条
        </button>

        <label className="task-field-label" htmlFor="task-employee">交给</label>
        <select
          id="task-employee"
          className="task-employee"
          data-testid="task-employee"
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
        >
          <option value="">（选一名在岗员工）</option>
          {employees.map((occupant) => (
            <option key={occupant.id} value={String(occupant.id)}>
              {occupant.name}（{occupant.roleSnapshot.name}）
            </option>
          ))}
        </select>

        <button
          type="button"
          className="task-dispatch"
          data-testid="task-dispatch"
          disabled={sentence.trim().length === 0 || !employeeId}
          onClick={() => void dispatch()}
        >
          派单
        </button>
        {note ? <div className="task-note" data-testid="task-error">{note}</div> : null}
      </section>

      {detailTask ? (
        <section className="task-detail" data-testid="task-detail" data-task-id={detailTask.id}>
          <div className="task-detail-head">
            <span className={`task-chip chip-${detailTask.playbook}`}>{PLAYBOOK_LABELS[detailTask.playbook] ?? "自由"}</span>
            <span className={`task-state`} data-testid="task-status" data-status={detailTask.status}>
              {STATUS_LABELS[detailTask.status] ?? detailTask.status}
            </span>
            <button type="button" className="task-back" data-testid="task-back" onClick={() => setOpenTaskId(null)}>
              ← 列表
            </button>
          </div>
          <div className="task-detail-goal" data-testid="task-goal-view">{detailTask.goal}</div>
          <ul className="task-detail-acceptance" data-testid="task-acceptance-view">
            {detailTask.acceptance.map((line, index) => (
              <li key={index} data-testid="task-acceptance-view-item">{line}</li>
            ))}
          </ul>
          <div className="task-base-head" data-testid="task-base-head">
            起点 HEAD <code>{detailTask.baseHead.slice(0, 7)}…</code>（所有 diff 相对它）
          </div>

          {detailTask.status === "finished" ? (
            <div className="task-artifacts">
              {detail?.artifacts.length === 0 ? <div className="task-empty">产出还没落盘，稍后刷新。</div> : null}
              {detail?.artifacts.map((artifact) => (
                <details key={artifact.id} className="task-artifact" data-testid={`artifact-${artifact.kind}`} open={artifact.kind === "diff_summary"}>
                  <summary>{ARTIFACT_TITLES[artifact.kind] ?? artifact.kind}</summary>
                  <pre>{artifact.content}</pre>
                </details>
              ))}
            </div>
          ) : (
            <div className="task-empty" data-testid="task-detail-hint">
              {detailTask.status === "running" ? "员工正在干活，跑完这里会出现四件套。" : "这张工单还没开工，点派单或回列表派单。"}
            </div>
          )}
        </section>
      ) : (
        <section className="task-list" data-testid="task-list">
          {tasks.length === 0 ? <div className="task-empty">还没有工单。一句话派活试试。</div> : null}
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="task-row"
              data-testid="task-row"
              data-task-id={task.id}
              data-status={task.status}
              onClick={() => setOpenTaskId(task.id)}
            >
              <span className="task-row-title">#{task.id} {task.title}</span>
              <span className="task-row-meta">
                {task.employeeName} · {PLAYBOOK_LABELS[task.playbook] ?? "自由"} · {STATUS_LABELS[task.status] ?? task.status}
              </span>
            </button>
          ))}
        </section>
      )}
    </aside>
  );
}

const ARTIFACT_TITLES = /** @type {Record<string, string>} */ ({
  diff_summary: "diff 摘要（相对起点）",
  changed_files: "变更文件清单",
  command_output: "命令输出",
  report: "收尾报告",
});

/**
 * Renderer-side mirrors of host payload shapes (process boundary).
 * @typedef {{ playbook: string, label: string, goal: string, acceptance: string[] }} TaskDraftData
 * @typedef {{ id: number, groupId: number, employeeId: number, title: string, goal: string, playbook: string, acceptance: string[], baseHead: string, status: string, createdAt: string, employeeName: string }} TaskRowData
 * @typedef {{ task: TaskRowData, sessions: Record<string, unknown>[], artifacts: { id: number, kind: string, content: string }[] }} TaskDetailData
 */
