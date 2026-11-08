import React, { useEffect, useState } from "react";
import { useDialog } from "./useDialog.js";

/**
 * 关于浮层（票 13 验收 5）：产品名 + 版本号。版本号来自 app.getVersion()
 * （打包形态 = 安装包写进 exe 的 metadata），主进程对表过 package.json，
 * 漂移时这里诚实挂警示。入口在左轨（主画布永远是办公室，一切皆浮层）。
 *
 * @param {{ onClose: () => void }} props
 */
export function AboutPanel({ onClose }) {
  const [info, setInfo] = useState(/** @type {import("./bridge").AppInfo | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    let alive = true;
    window.cubicle
      .appInfo()
      .then((data) => {
        if (alive) setInfo(/** @type {import("./bridge").AppInfo} */ (data));
      })
      .catch((err) => {
        if (alive) setError(err?.message ?? String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const dialogRef = useDialog(onClose);

  return (
    <aside className="rail-drawer about-panel" data-testid="about-panel" ref={dialogRef} role="dialog" aria-modal="true" aria-label="关于 Cubicle" tabIndex={-1}>
      <header className="task-header">
        <div className="task-title">关于 Cubicle</div>
        <button type="button" className="task-close" data-testid="about-close" onClick={onClose} aria-label="收起关于页">
          ✕
        </button>
      </header>
      <div className="about-body">
        {error ? <div className="about-error" data-testid="about-error">读不到版本信息：{error}</div> : null}
        {info ? (
          <>
            <div className="about-product" data-testid="about-product">{info.productName}</div>
            <div className="about-version-line">
              版本 <span data-testid="about-version">{info.version}</span>
              {info.mismatch ? (
                <span className="about-warn" data-testid="about-version-mismatch">
                  ⚠ 安装包 metadata（{info.version}）与 package.json（{info.packageVersion}）不一致
                </span>
              ) : null}
            </div>
            <div className="about-meta">Electron {info.electron ?? "?"} · {info.packaged ? "安装包形态" : "开发形态"}</div>
            <div className="about-meta about-datadir" data-testid="about-datadir">数据目录 {info.dataDir}</div>
            <p className="about-tagline">一间看得见的办公室：AI 数字员工在工位上干活，你招聘、派活、验收。</p>
          </>
        ) : (
          !error && <div className="task-empty">读取版本信息…</div>
        )}
      </div>
    </aside>
  );
}
