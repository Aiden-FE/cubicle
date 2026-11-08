import React from "react";

/** @type {Record<string, string>} */
const STATE_LABEL = {
  starting: "正在准备…",
  online: "运行正常",
  offline: "后台异常，正在自动恢复…",
  stopped: "已停止",
  idle: "未启动",
};

/**
 * Presence indicator: a dot that only speaks when something is wrong.
 * Internal diagnostics (pid, uptime, data dir) hide behind a click.
 *
 * @param {{ status: import("./App.jsx").HostStatusData }} props
 */
export function StatusChip({ status }) {
  const [open, setOpen] = React.useState(false);
  const zoneRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const [, tick] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (/** @type {MouseEvent} */ event) => {
      if (zoneRef.current && !zoneRef.current.contains(/** @type {Node} */ (event.target))) setOpen(false);
    };
    const onKey = (/** @type {KeyboardEvent} */ event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const online = status.state === "online";
  const problem = status.state === "offline" || status.state === "starting" || status.state === "stopped";
  const uptime = status.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(status.startedAt).getTime()) / 1000))
    : null;

  return (
    <div className="status-zone" ref={zoneRef}>
      <button
        type="button"
        className="status-dot-button"
        data-testid="host-status"
        data-online={online ? "true" : "false"}
        data-state={status.state}
        title={STATE_LABEL[status.state] ?? status.state}
        aria-label={`应用状态：${STATE_LABEL[status.state] ?? status.state}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`status-dot ${status.state}`} />
        {problem ? <span className="status-note">{STATE_LABEL[status.state] ?? status.state}</span> : null}
      </button>

      {open ? (
        <div className="status-popover">
          <div className="status-popover-title">应用状态</div>
          <div className="status-popover-row">
            <span>后台服务</span>
            <b>{STATE_LABEL[status.state] ?? status.state}</b>
          </div>
          {online ? (
            <>
              <div className="status-popover-row">
                <span>进程号</span>
                <span>{status.pid ?? "—"}</span>
              </div>
              <div className="status-popover-row">
                <span>已运行</span>
                <span>{uptime !== null ? formatDuration(uptime) : "—"}</span>
              </div>
              <div className="status-popover-row" data-testid="data-dir">
                <span>数据目录</span>
                <code>{status.dataDir ?? "—"}</code>
              </div>
              {status.dbPath ? (
                <div className="status-popover-row">
                  <span>数据库</span>
                  <code>{status.dbPath}</code>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** @param {number} seconds */
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}
