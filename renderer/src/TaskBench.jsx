import React, { useCallback, useEffect, useRef, useState } from "react";
import { budgetStateFor, taskBudgetMarker, tokenText } from "./scene/tokenReadout.js";

// Topic names mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const RUN_TOPIC = "run.event";
const DOMAIN_TOPIC = "domain.changed";

const PLAYBOOK_LABELS = /** @type {Record<string, string>} */ ({ feature: "加功能", bugfix: "修 bug", docs: "写文档", free: "自由" });
// 票 06：五个状态全部可见；转移合法性在 host，浮层只展示 + 触发合法转移。
const STATUS_LABELS = /** @type {Record<string, string>} */ ({ open: "待办", running: "进行中", review: "待验收", done: "完成", failed: "失败" });
const SESSION_LABELS = /** @type {Record<string, string>} */ ({ running: "进行中", completed: "已完成", aborted: "已取消", failed: "失败", interrupted: "中断", paused: "下班暂停" });

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
 * 票 06（验收与打回）: every run settles at 待验收 — 完成 only comes from
 * 通过; 打回 continues the SAME task (one more iteration on the same
 * history); 取消 stops a running task and marks it 失败. The five states
 * (待办/进行中/待验收/完成/失败) are visible on every row, and the detail
 * buttons only ever offer transitions the host accepts anyway.
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
  const [rejectReason, setRejectReason] = useState("");
  // 票 12: run 进行中的预算信号（budget_warning / budget_exhausted 事件带
  // tokens/budget）— 落库的 taskTokenSummary 只含已收尾的轮，黄点必须活在事件上。
  const [liveBudget, setLiveBudget] = useState(() => new Map());
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
      setRejectReason("");
      return;
    }
    void loadDetail(openTaskId);
  }, [openTaskId, loadDetail]);

  // A run settling: re-pull the list and the open task's artifacts. The
  // host's agent_end rides out before the artifact hook finishes writing,
  // so the detail reload is deliberately late.
  useEffect(() => {
    const unsubscribe = window.cubicle.subscribe(RUN_TOPIC, (envelope) => {
      const payload = /** @type {{ taskId?: number | null, event: { type: string } }} */ (envelope.payload);
      if (payload.event.type === "budget_warning" || payload.event.type === "budget_exhausted") {
        // 票 12: 软闸信号 — 黄点/到顶在轮还没收尾时就得上屏
        const signal = /** @type {{ type: string, tokens?: number, budget?: number }} */ (payload.event);
        if (typeof payload.taskId === "number") {
          setLiveBudget((prev) => {
            const next = new Map(prev);
            next.set(payload.taskId, {
              tokens: Number(signal.tokens ?? 0),
              budget: Number(signal.budget ?? 0),
              state: signal.type === "budget_exhausted" ? "exhausted" : "warn",
            });
            return next;
          });
        }
        return;
      }
      if (payload.event.type !== "agent_end") return;
      void loadTasks();
      if (openTaskId !== null) void loadDetail(openTaskId);
    });
    return unsubscribe;
  }, [loadTasks, loadDetail, openTaskId]);

  // 派单/通过/打回/取消 change the domain — keep list and detail honest
  // without polling (ticket 06: the five states stay visible as they move).
  useEffect(() => {
    const unsubscribe = window.cubicle.subscribe(DOMAIN_TOPIC, (envelope) => {
      const reason = /** @type {{ reason?: string }} */ (envelope.payload ?? {}).reason ?? "";
      if (!reason.startsWith("task.")) return;
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
      const failure = /** @type {{ code?: string, message?: string }} */ (err);
      const code = failure.code ?? "task_create_failed";
      setNote(
        code === "not_a_git_workspace"
          ? "这个工作区不是 git 仓库：工单不可用（应用不会替你初始化仓库，先让员工的工作区成为一个 git 仓库）。"
          : code === "no_head_commit"
            ? "git 工作区还没有任何提交：工单不可用。"
            : code === "git_unavailable"
              ? "本机找不到 git 命令：工单需要 git 工作区才能记录起点。"
              : code === "task_running"
                ? "这张工单已经在跑了，等这一轮结束。"
                : code === "off_duty"
                  ? failure.message ?? "公司正在下班中：先在左轨「上下班」点「立即上班」，或等时间表到点自动上班。"
                  : `没能开单：${code}`,
      );
    }
  };

  const detailTask = detail?.task ?? null;

  // 票 12: 三层可见的任务级读层 — 落库账单（taskTokenSummary）+ 活在事件流上的
  // 预算信号，取更坏的那个判定；未计量不判（没数不猜）。
  const live = openTaskId !== null ? liveBudget.get(openTaskId) ?? null : null;
  const persistedTotal = detail?.tokens?.measured === true ? Number(detail.tokens.total ?? 0) : 0;
  const usedTokens = Math.max(persistedTotal, live?.tokens ?? 0);
  const tokensMeasured = detail?.tokens?.measured === true || (live?.tokens ?? 0) > 0;
  const tokenSummary = detail?.tokens || live ? { measured: tokensMeasured, total: usedTokens } : null;
  const budgetValue = detail?.budget ?? live?.budget ?? null;
  const budgetMarker = tokensMeasured ? budgetStateFor(usedTokens, budgetValue) : taskBudgetMarker(detail);
  const liveTokens = live && (live.tokens ?? 0) > persistedTotal ? live.tokens : null;

  /** 「+50%」：host 落库 1.5× 并走 09 的续跑通道；续跑被拒时把可懂的原因上屏。 */
  const extendBudget = async () => {
    if (openTaskId === null) return;
    setNote(null);
    try {
      const result = /** @type {{ resumed?: boolean, resumeNote?: string }} */ (
        await window.cubicle.invoke("task.extendBudget", { taskId: openTaskId })
      );
      if (result.resumeNote) setNote(result.resumeNote);
      setLiveBudget((prev) => {
        const next = new Map(prev);
        next.delete(openTaskId);
        return next;
      });
      await loadTasks();
      await loadDetail(openTaskId);
    } catch (err) {
      const failure = /** @type {{ code?: string, message?: string }} */ (err);
      setNote(
        failure.code === "invalid_transition"
          ? failure.message ?? "这张工单的当前状态不能加预算。"
          : failure.code === "off_duty"
            ? failure.message ?? "公司正在下班中：先在左轨「上下班」点「立即上班」。"
            : `加预算失败：${failure.code ?? "unknown"}`,
      );
    }
  };

  /**
   * 验收动作（票 06：浮层只触发合法转移——合法性由 host 强制；host 拒绝时
   * 错误消息就是诚实的状态说明）.
   *
   * @param {"task.accept" | "task.reject" | "task.cancel" | "task.dispatch" | "task.resume" | "task.rerun" | "task.abandon"} method
   * @param {Record<string, unknown>} payload
   */
  const act = async (method, payload) => {
    if (openTaskId === null) return;
    setNote(null);
    try {
      await window.cubicle.invoke(method, payload);
      if (method === "task.reject") setRejectReason("");
      await loadTasks();
      await loadDetail(openTaskId);
    } catch (err) {
      const failure = /** @type {{ code?: string, message?: string }} */ (err);
      setNote(
        failure.code === "invalid_transition"
          ? failure.message ?? "这张工单的当前状态不允许这个操作。"
          : failure.code === "no_active_run"
            ? "这张工单没有正在执行的运行——它可能已经自己收尾了。"
            : failure.code === "off_duty"
              ? failure.message ?? "公司正在下班中：先在左轨「上下班」点「立即上班」。"
              : `操作失败：${failure.code ?? "unknown"}`,
      );
    }
  };

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
            {/* 票 09: 暂停徽标 — 五状态不变，「进行中」+ 最近一轮 paused = 挂起；
                票 12: 预算到顶的暂停挂「预算到顶」而不是「已下班·暂停」。 */}
            {detailTask.status === "running" && detail?.sessions?.at(-1)?.status === "paused" ? (
              <span
                className="task-paused-badge"
                data-testid="detail-paused-badge"
                data-paused="true"
                data-reason={budgetMarker === "exhausted" ? "budget" : "duty"}
              >
                {budgetMarker === "exhausted" ? "预算到顶" : "已下班·暂停"}
              </span>
            ) : null}
            {/* 票 10: 中断徽标 — 崩溃/强杀留下的 interrupted，等老板三选 */}
            {detail?.interrupted ? (
              <span className="task-interrupted-badge" data-testid="detail-interrupted-badge">
                崩溃中断
              </span>
            ) : null}
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

          <div className="task-tokens" data-testid="task-tokens" data-budget-state={budgetMarker} data-tokens-live={String(liveTokens ?? "")}>
            本任务 token <code>{tokenText(tokenSummary)}</code>
            {/* 未计量就没有 breakdown 可拆 —— 「输入 0 · 输出 0」会把「没数」演成「免费」。 */}
            {detail?.tokens?.measured === true ? (
              <span className="task-tokens-detail">
                （输入 {detail.tokens.input} · 输出 {detail.tokens.output}）
              </span>
            ) : null}
            {/* 票 12 验收 4: 80% 黄点 / 100% 预算到顶（软闸判定在 host，信号走事件流） */}
            {budgetMarker === "warn" ? (
              <span className="budget-dot" data-testid="token-warn-dot" title={`token 用量已过 80%（${liveTokens ?? detail?.tokens?.total ?? 0}/${detail?.budget ?? "?"}）`}>
                ● 80%
              </span>
            ) : null}
            {budgetMarker === "exhausted" ? (
              <span className="budget-capped" data-testid="token-exhausted-badge">
                预算到顶
              </span>
            ) : null}
          </div>
          <div className="task-budget-line" data-testid="task-budget-line" data-budget={String(detail?.budget ?? "")}>
            本任务预算 <code>{detail?.budget ?? "—"}</code> token
            {detailTask.status === "running" && budgetMarker === "exhausted" ? (
              <button
                type="button"
                className="task-budget-extend"
                data-testid="task-budget-plus50"
                onClick={() => void extendBudget()}
              >
                +50% 继续
              </button>
            ) : null}
          </div>

          {detail && detail.sessions.length > 0 ? (
            <div className="task-sessions" data-testid="task-sessions">
              <span className="task-iterations" data-testid="task-iterations">
                迭代 {detail.iterations ?? detail.sessions.length} 轮
              </span>
              {detail.sessions.map((session) => (
                <span key={session.id} className="task-session" data-testid={`task-session-${session.iteration}`}>
                  第 {session.iteration} 轮 · {SESSION_LABELS[session.status] ?? session.status}
                </span>
              ))}
            </div>
          ) : null}

          {/* 票 10: 中断任务的三选出口（host 的判决在 detail.interrupted）。 */}
          {detail?.interrupted ? (
            <div className="task-review" data-testid="detail-interrupted-actions">
              <div className="interrupted-hint">
                崩溃把这张工单留在了中断处：续跑（引擎从断点继续）/ 重跑（原合同新一轮）/ 放弃（进失败归档，历史保留）。
              </div>
              <div className="task-review-actions">
                {detail.interrupted.canResume ? (
                  <button
                    type="button"
                    className="task-accept"
                    data-testid="detail-resume"
                    onClick={() => void act("task.resume", { taskId: detailTask.id })}
                  >
                    续跑
                  </button>
                ) : (
                  <span className="interrupted-hint" data-testid="detail-resume-hint" title={detail.interrupted.resumeHint ?? ""}>
                    {detail.interrupted.resumeHint ?? "不能续跑"}
                  </span>
                )}
                <button
                  type="button"
                  className="task-reject"
                  data-testid="detail-rerun"
                  onClick={() => void act("task.rerun", { taskId: detailTask.id })}
                >
                  重跑
                </button>
                <button
                  type="button"
                  className="task-cancel"
                  data-testid="detail-abandon"
                  onClick={() => void act("task.abandon", { taskId: detailTask.id })}
                >
                  放弃
                </button>
              </div>
            </div>
          ) : null}
          {detailTask.status === "review" ? (
            <div className="task-review" data-testid="task-review">
              <textarea
                className="task-reject-reason"
                data-testid="task-reject-reason"
                rows={2}
                placeholder="打回意见（可留空）：产出哪里没过验收？"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
              <div className="task-review-actions">
                <button
                  type="button"
                  className="task-accept"
                  data-testid="task-accept"
                  onClick={() => void act("task.accept", { taskId: detailTask.id })}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="task-reject"
                  data-testid="task-reject"
                  onClick={() => void act("task.reject", { taskId: detailTask.id, reason: rejectReason })}
                >
                  打回
                </button>
              </div>
            </div>
          ) : null}
          {detailTask.status === "running" ? (
            <button
              type="button"
              className="task-cancel"
              data-testid="task-cancel"
              onClick={() => void act("task.cancel", { taskId: detailTask.id })}
            >
              取消
            </button>
          ) : null}
          {detailTask.status === "failed" ? (
            <div className="task-failure" data-testid="task-failure">
              {/* 票 12 验收 1: host 折叠的人话原因（不是堆栈）+ 一键重试；
                  验收 2: 重试走 task.dispatch = 新会话（06 语义），历史与产出原样。 */}
              <div className="task-fail-reason" data-testid="task-fail-reason">
                {detail?.failure?.reason ?? "这一轮失败了，引擎没有给出更具体的原因。"}
              </div>
              <button
                type="button"
                className="task-retry"
                data-testid="task-retry"
                onClick={() => void act("task.dispatch", { taskId: detailTask.id })}
              >
                重试（新会话再来一轮）
              </button>
            </div>
          ) : null}

          {detail && detail.artifacts.length > 0 ? (
            <div className="task-artifacts">
              {detail.artifacts.map((artifact) => (
                <details key={artifact.id} className="task-artifact" data-testid={`artifact-${artifact.kind}`} open={artifact.kind === "diff_summary"}>
                  <summary>{ARTIFACT_TITLES[artifact.kind] ?? artifact.kind}</summary>
                  <pre>{artifact.content}</pre>
                </details>
              ))}
            </div>
          ) : (
            <div className="task-empty" data-testid="task-detail-hint">
              {detailTask.status === "running"
                ? "员工正在干活，跑完这里会出现四件套；要中途停下点「取消」。"
                : detailTask.status === "open"
                  ? "这张工单还没开工：在上方表单派单。"
                  : "产出还没落盘，稍后刷新。"}
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
              data-paused={task.status === "running" && task.latestSessionStatus === "paused" ? "true" : "false"}
              onClick={() => setOpenTaskId(task.id)}
            >
              <span className="task-row-title">#{task.id} {task.title}</span>
              <span className="task-row-meta">
                {task.employeeName} · {PLAYBOOK_LABELS[task.playbook] ?? "自由"} · {STATUS_LABELS[task.status] ?? task.status}
                {task.status === "running" && task.latestSessionStatus === "paused" ? (
                  <span className="task-paused-badge" data-testid="paused-badge">已下班·暂停</span>
                ) : null}
                {(task.status === "open" || task.status === "running") && task.latestSessionStatus === "interrupted" ? (
                  <span className="task-interrupted-badge" data-testid="bench-interrupted-badge">崩溃中断</span>
                ) : null}
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
 * @typedef {{ id: number, groupId: number, employeeId: number, title: string, goal: string, playbook: string, acceptance: string[], baseHead: string, status: string, createdAt: string, employeeName: string, latestSessionStatus?: string | null }} TaskRowData
 * @typedef {{ id: number, taskId: number, employeeSessionId: number, engine: string, status: string, startedAt: string, endedAt: string | null, sessionFile: string | null, iteration: number }} TaskSessionData
 * @typedef {{ input: number, cachedInput: number, cacheWrite: number, output: number, reasoning: number, total: number, measured?: boolean }} TaskTokenData
 * @typedef {{ task: TaskRowData, sessions: TaskSessionData[], artifacts: { id: number, kind: string, content: string }[], tokens?: TaskTokenData, iterations?: number, budget?: number, failure?: { reason: string | null }, interrupted?: { canResume: boolean, resumeHint: string | null } | null }} TaskDetailData
 */
