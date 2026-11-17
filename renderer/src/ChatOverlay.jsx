import React, { useCallback, useEffect, useRef, useState } from "react";
import { EngineCard } from "./EngineCard.jsx";
import { useDialog } from "./useDialog.js";

// Topic name mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const RUN_TOPIC = "run.event";

/**
 * Talk to an employee (ticket 04): one sentence goes in through
 * run.start; the engine's normalized event stream (session_start, text
 * deltas, tool calls, turn ends, agent_end, errors) comes back on the
 * run.event topic and paints the timeline below the input. Tool events
 * collapse/expand; the abort button cancels a running job (run.abort).
 *
 * An overlay drawer — the office stays the main canvas (hard constraint).
 *
 * @param {{
 *   employee: import("./App.jsx").DeskOccupantData,
 *   onClose: () => void,
 * }} props
 */
export function ChatOverlay({ employee, onClose }) {
  const [items, setItems] = useState(/** @type {TimelineItem[]} */ ([]));
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [busyNote, setBusyNote] = useState(/** @type {string | null} */ (null));
  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const stickToBottom = useRef(true);
  const pendingEvents = useRef(/** @type {{ event: EngineEvent, at: number }[]} */ ([]));
  const flushTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  /** @type {(event: EngineEvent) => void} */
  const flushEvents = useCallback(() => {
    flushTimer.current = null;
    const batch = pendingEvents.current;
    pendingEvents.current = [];
    if (batch.length === 0) return;
    setItems((prev) => capTimeline(batch.reduce((acc, entry) => appendEvent(acc, entry.event, entry.at), prev)));
  }, []);

  const applyEvent = useCallback(
    /** @param {EngineEvent} event @param {number} [at] */
    (event, at = Date.now()) => {
      if (event.type === "session_start") setRunning(true);
      if (event.type === "agent_end") setRunning(false);
      // Coalesce text deltas: a run can stream thousands of token events; one
      // React commit per delta re-renders the whole drawer. 50ms is invisible
      // to a human and cuts the render count by ~10-50x.
      pendingEvents.current.push({ event, at });
      if (flushTimer.current === null) {
        flushTimer.current = setTimeout(flushEvents, 50);
      }
    },
    [flushEvents],
  );

  /** 折叠/展开某条工具事件（index 稳定：时间线只追加与原地补全） */
  const toggleTool = useCallback(
    /** @param {number} index */
    (index) => {
      setItems((prev) =>
        prev.map((item, i) => (i === index && item.kind === "tool" ? { ...item, expanded: !item.expanded } : item)),
      );
    },
    [],
  );

  useEffect(() => {
    // Re-opening the drawer for another employee must not show the previous
    // employee's conversation.
    setItems([]);
    setRunning(false);
    pendingEvents.current = [];
    if (flushTimer.current !== null) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    let alive = true;
    const unsubscribe = window.cubicle.subscribe(RUN_TOPIC, (envelope) => {
      const payload = /** @type {{ employeeId: number, event: EngineEvent, at?: number }} */ (envelope.payload);
      if (payload.employeeId !== employee.id) return;
      applyEvent(payload.event, payload.at);
    });
    // Re-paint the last run for late openers / after a view reload: the host
    // keeps the event tail of the most recent run per employee.
    void window.cubicle
      .invoke("run.history", { employeeId: employee.id })
      .then((result) => {
        if (!alive) return;
        const history = /** @type {{ lastRun: { status: string, prompt?: string } | null, events: { event: EngineEvent, at: number }[] }} */ (result);
        setRunning(history.lastRun?.status === "running");
        if (history.events && history.events.length > 0) {
          setItems((prev) =>
            prev.length > 0
              ? prev
              : [
                  ...(history.lastRun?.prompt
                    ? [/** @type {TimelineItem} */ ({ kind: "user", text: history.lastRun.prompt })]
                    : []),
                  ...history.events.reduce((acc, entry) => appendEvent(acc, entry.event, entry.at), /** @type {TimelineItem[]} */ ([])),
                ],
          );
        } else if (history.lastRun?.prompt) {
          setItems((prev) => (prev.length > 0 ? prev : [{ kind: "user", text: /** @type {string} */ (history.lastRun?.prompt) }]));
        }
      })
      .catch(() => {
        // history is a convenience; the live stream still paints
      });
    return () => {
      alive = false;
      unsubscribe();
      pendingEvents.current = [];
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [employee.id, applyEvent]);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [items]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    setBusyNote(null);
    stickToBottom.current = true;
    const userItem = /** @type {TimelineItem} */ ({ kind: "user", text });
    setItems((prev) => capTimeline([...prev, userItem]));
    try {
      await window.cubicle.invoke("run.start", { employeeId: employee.id, text });
    } catch (err) {
      // The send failed: remove the optimistic bubble and give the text back.
      setItems((prev) => prev.filter((item) => item !== userItem));
      setDraft((prev) => (prev.length > 0 ? prev : text));
      const failure = /** @type {{ code?: string, message?: string }} */ (err);
      const code = failure.code ?? "run_start_failed";
      setBusyNote(
        code === "employee_busy"
          ? "TA 正在干活，先等这一轮结束（或点中止）。"
          : code === "engine_not_configured"
            ? "引擎还没配好：把 BYOK 模型配置 engines/pi/models.json 放进应用数据目录后再试。"
            : code === "off_duty"
              ? failure.message ?? "公司正在下班中：先在左轨「上下班」点「立即上班」。"
              : code === "method_not_allowed"
                ? "界面调用被 IPC 白名单拒绝。"
                : `没能开始：${code}`,
      );
    }
  };

  const abort = async () => {
    setBusyNote(null);
    try {
      await window.cubicle.invoke("run.abort", { employeeId: employee.id });
    } catch {
      // it may already have settled between the click and the invoke
    }
  };

  const dialogRef = useDialog(onClose);

  return (
    <aside className="chat-drawer" data-testid="chat-overlay" data-employee-id={employee.id} ref={dialogRef} role="dialog" aria-modal="true" aria-label="员工对话" tabIndex={-1}>
      <header className="chat-header">
        <div>
          <div className="chat-title" data-testid="chat-title">{employee.name}</div>
          <div className="chat-subtitle">
            {employee.roleName ?? employee.roleSnapshot.roleKey} · 引擎 {employee.roleSnapshot.engine}
            <span className={`chat-state ${running ? "running" : ""}`} data-testid="chat-running" data-running={running ? "true" : "false"}>
              {running ? "工作中…" : "空闲"}
            </span>
          </div>
        </div>
        <button type="button" className="chat-close" data-testid="chat-close" onClick={onClose} aria-label="关闭对话">
          ✕
        </button>
      </header>

      <EngineCard employee={employee} />

      <div className="chat-events" data-testid="chat-events" ref={listRef} onScroll={onScroll}>
        {items.length === 0 ? (
          <div className="chat-empty">对 TA 说一句话，事件会按时间出现在这里。</div>
        ) : null}
        {items.map((item, index) => (
          <EventItem key={index} item={item} onToggle={() => toggleTool(index)} />
        ))}
      </div>

      {busyNote ? <div className="chat-note" data-testid="chat-note">{busyNote}</div> : null}

      <footer className="chat-input-row">
        <textarea
          className="chat-input"
          data-testid="chat-input"
          rows={2}
          placeholder={running ? "正在干活…" : "说一句话，例如：读一下 hello.txt，说说里面写了什么"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // IME composition: Enter is "commit the candidate", not "send".
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-actions">
          {running ? (
            <button type="button" className="chat-abort" data-testid="chat-abort" onClick={() => void abort()}>
              中止
            </button>
          ) : null}
          <button
            type="button"
            className="chat-send"
            data-testid="chat-send"
            disabled={running || draft.trim().length === 0}
            onClick={() => void send()}
          >
            发送
          </button>
        </div>
      </footer>
    </aside>
  );
}

/**
 * @param {{ item: TimelineItem, onToggle: () => void }} props
 */
function EventItem({ item, onToggle }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="chat-item chat-user" data-testid="chat-user" data-type="user">
          {item.text}
        </div>
      );
    case "text":
      return (
        <div className="chat-item chat-text" data-testid="event-item" data-type="text">
          {item.text}
        </div>
      );
    case "thinking":
      return (
        <details className="chat-item chat-thinking" data-testid="event-item" data-type="thinking">
          <summary>思考片段</summary>
          <div className="chat-thinking-body">{item.text}</div>
        </details>
      );
    case "tool":
      return (
        <div
          className={`chat-item chat-tool ${item.done ? (item.isError ? "failed" : "done") : "running"}`}
          data-testid="event-item"
          data-tool-event=""
          data-type="tool"
          data-tool={item.toolName}
          data-expanded={item.expanded ? "true" : "false"}
          data-done={item.done ? "true" : "false"}
          data-error={item.isError ? "true" : "false"}
        >
          <button
            type="button"
            className="chat-tool-head"
            data-testid="tool-toggle"
            onClick={onToggle}
            aria-expanded={item.expanded ? "true" : "false"}
          >
            <span className="chat-tool-icon" aria-hidden="true">工具</span>
            <span className="chat-tool-name">{item.toolName}</span>
            <span className="chat-tool-state">
              {item.done ? (item.isError ? "失败" : "完成") : "执行中…"}
            </span>
            <span className="chat-tool-caret">{item.expanded ? "收起" : "详情"}</span>
          </button>
          {item.expanded ? (
            <div className="chat-tool-detail">
              <div className="chat-tool-detail-label">参数</div>
              <pre>{stringify(item.args)}</pre>
              {item.done ? (
                <>
                  <div className="chat-tool-detail-label">结果</div>
                  <pre>{stringify(item.result)}</pre>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    case "meta":
      return (
        <div className={`chat-item chat-meta ${item.tone ?? ""}`} data-testid="event-item" data-type={item.metaType}>
          {item.text}
          {item.at ? (
            <>
              {" · "}
              <span className="chat-time">{formatTime(item.at)}</span>
            </>
          ) : null}
        </div>
      );
    case "error":
      return (
        <div className="chat-item chat-error" data-testid="event-item" data-type="error">
          {item.code}：{item.message}
        </div>
      );
    default:
      return null;
  }
}

/**
 * Engine event vocabulary (mirrors src/host/engine/events.mjs).
 * @typedef {Record<string, any>} EngineEvent
 */

/**
 * @typedef {{ kind: "user", text: string }
 *   | { kind: "text", text: string }
 *   | { kind: "thinking", text: string }
 *   | { kind: "tool", toolCallId: string, toolName: string, args: unknown, done: boolean, isError: boolean, result: unknown, expanded: boolean }
 *   | { kind: "meta", text: string, tone?: string, metaType: string, at?: number }
 *   | { kind: "error", code: string, message: string }
 * } TimelineItem
 */

/** @param {number} at @returns {string} */
function formatTime(at) {
  try {
    return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Keep the live timeline bounded: a long run streams thousands of deltas, and
 * the drawer re-renders the whole list on each one.
 *
 * @param {TimelineItem[]} items
 * @returns {TimelineItem[]}
 */
function capTimeline(items) {
  if (items.length <= 400) return items;
  return items.slice(items.length - 400);
}

/**
 * Fold one normalized engine event into the timeline: consecutive deltas of
 * the same kind grow the last block; tool start/end merge by call id.
 *
 * @param {TimelineItem[]} items
 * @param {EngineEvent} event
 * @returns {TimelineItem[]}
 */
function appendEvent(items, event, at = Date.now()) {
  const next = items.slice();
  switch (event.type) {
    case "session_start":
      next.push({ kind: "meta", text: `会话 #${event.sessionId ?? "?"} 开始`, metaType: "session_start", at });
      break;
    case "text_delta":
      appendDelta(next, "text", event.text);
      break;
    case "thinking_delta":
      appendDelta(next, "thinking", event.text);
      break;
    case "tool_execution_start":
      next.push({
        kind: "tool",
        toolCallId: callIdOf(event),
        toolName: String(event.toolName ?? "unknown"),
        args: event.args,
        done: false,
        isError: false,
        result: undefined,
        expanded: false,
      });
      break;
    case "tool_execution_end": {
      const patch = { done: true, isError: event.isError === true, result: event.result };
      const index = next.findIndex((item) => item.kind === "tool" && item.toolCallId === callIdOf(event));
      if (index >= 0) {
        next[index] = { .../** @type {Extract<TimelineItem, { kind: "tool" }>} */ (next[index]), ...patch };
      } else {
        next.push({
          kind: "tool",
          toolCallId: callIdOf(event),
          toolName: String(event.toolName ?? "unknown"),
          args: undefined,
          ...patch,
          expanded: false,
        });
      }
      break;
    }
    case "turn_start":
      break; // the turn boundary that matters is its end
    case "turn_end": {
      const usage = event.usage;
      const tokenText = usage ? ` · tokens ${usage.input}→${usage.output}` : "";
      next.push({
        kind: "meta",
        text: `${event.status === "failed" ? "回合失败" : "回合结束"}${tokenText}`,
        metaType: "turn_end",
        at,
        tone: event.status === "failed" ? "bad" : "",
      });
      break;
    }
    case "agent_end": {
      // Mirrors the host's bookkeeping: an engine that settles without
      // reporting is recorded (and read) as a failure, never a clean end.
      const label =
        event.status === "ok"
          ? "干完了"
          : event.status === "failed"
            ? "这轮结束了（中止或失败）"
            : "这轮结束了（引擎没有报告结果）";
      next.push({ kind: "meta", text: label, metaType: "agent_end", tone: event.status === "ok" ? "ok" : "bad", at });
      break;
    }
    case "error":
      next.push({ kind: "error", code: String(event.code ?? "error"), message: String(event.message ?? "") });
      break;
    case "policy_blocked":
      // 票 07: 被拒不静默 — the refusal is a first-class timeline line too.
      next.push({
        kind: "meta",
        text: `被策略拦下：${String(event.toolName ?? "?")} — ${String(event.reason ?? "")}`,
        metaType: "policy_blocked",
        at,
        tone: "warn",
      });
      break;
    default:
      next.push({ kind: "meta", text: `未知事件：${String(event.type)}`, metaType: "unknown" });
      break;
  }
  return next;
}

/**
 * Grow the trailing text/thinking block, or start a new one.
 *
 * @param {TimelineItem[]} items
 * @param {"text" | "thinking"} kind
 * @param {unknown} text
 */
function appendDelta(items, kind, text) {
  const chunk = typeof text === "string" ? text : "";
  const last = items[items.length - 1];
  if (last && last.kind === kind) {
    items[items.length - 1] = { kind, text: last.text + chunk };
  } else {
    items.push({ kind, text: chunk });
  }
}

/** @param {EngineEvent} event @returns {string} */
function callIdOf(event) {
  return String(event.toolCallId ?? "unknown");
}

/** @param {unknown} value @returns {string} */
function stringify(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
