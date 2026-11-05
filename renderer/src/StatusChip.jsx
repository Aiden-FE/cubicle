import React from "react";

/** @type {Record<string, string>} */
const STATE_LABEL = {
  starting: "启动中",
  online: "在线",
  offline: "离线",
  stopped: "已停止",
  idle: "未启动",
};

/**
 * AgentHost presence chip: the host's state must always be visible.
 *
 * @param {{ status: import("./App.jsx").HostStatusData }} props
 */
export function StatusChip({ status }) {
  const [, tick] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const online = status.state === "online";
  const uptime = status.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(status.startedAt).getTime()) / 1000))
    : null;

  return (
    <div className="status-chip" data-testid="host-status" data-online={online ? "true" : "false"} data-state={status.state}>
      <span className={`status-dot ${status.state}`} />
      <div className="status-body">
        <div className="status-line">
          AgentHost <b>{STATE_LABEL[status.state] ?? status.state}</b>
          {status.pid ? <span className="status-pid">pid {status.pid}</span> : null}
          {uptime !== null ? <span className="status-uptime">已运行 {formatDuration(uptime)}</span> : null}
        </div>
        {status.dataDir ? <div className="status-dir" data-testid="data-dir">{status.dataDir}</div> : null}
      </div>
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
