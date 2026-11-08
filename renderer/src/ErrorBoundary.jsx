import React from "react";

/**
 * The office must never become a blank window because one payload/row was bad.
 * This catches render errors, shows the message and offers a reload; the host
 * keeps running (reload only restarts the view).
 */
/**
 * @extends {React.Component<{ children?: React.ReactNode }, { error: unknown }>}
 */
export class AppErrorBoundary extends React.Component {
  /** @param {{ children?: React.ReactNode }} props */
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  /** @param {unknown} error */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /** @param {unknown} error @param {{ componentStack?: string }} info */
  componentDidCatch(error, info) {
    try {
      console.error("cubicle render error", error, info?.componentStack);
    } catch {
      // console may be gone
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const error = /** @type {unknown} */ (this.state.error);
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="app-fatal" data-testid="app-fatal">
        <div className="app-fatal-title">界面出错了</div>
        <div className="app-fatal-message">{message}</div>
        <p>后台的办公室还在运行；重载界面会重新拉取快照，不会中断员工任务。</p>
        <button type="button" className="task-dispatch" onClick={() => window.location.reload()}>
          重载界面
        </button>
      </div>
    );
  }
}
