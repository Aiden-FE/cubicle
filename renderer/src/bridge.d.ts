/**
 * Bridge types exposed by src/preload/index.cjs on window.cubicle.
 */
export interface EventEnvelope {
  v: 1;
  kind: "event";
  id: string;
  topic: string;
  payload: unknown;
  ts: number;
}

export interface BridgeError {
  code: string;
  message: string;
}

export interface CubicleBridge {
  /** Resolves with the reply payload; rejects with a plain {@link BridgeError} (Error subclasses do not survive contextBridge). */
  invoke(method: string, payload?: unknown): Promise<unknown>;
  subscribe(topic: string, handler: (event: EventEnvelope) => void): () => void;
  /** 票 13: 关于页 metadata（main 的业务，不走 AgentHost 信封总线）。 */
  appInfo(): Promise<AppInfo>;
  /** 打开员工工作区（main 从 employeeId 推路径，渲染进程不传路径）。 */
  openWorkspace(employeeId: number): Promise<string>;
  /** 打开引擎 BYOK 配置目录（main 从 dataDir + engine 推路径）。 */
  openEngineDir(engine: string): Promise<string>;
}

/** Main-process app metadata for the About overlay (ticket 13). */
export interface AppInfo {
  productName: string;
  version: string;
  versionSource: "app" | "package" | "fallback";
  mismatch: boolean;
  packageVersion: string | null;
  electron: string | null;
  packaged: boolean;
  dataDir: string;
}

/** Topic names mirrored from src/shared/envelope.mjs TOPICS (realm boundary). */
export const TOPICS = {
  hostStatus: "host.status",
  domainChanged: "domain.changed",
  runEvent: "run.event",
};

declare global {
  interface Window {
    cubicle: CubicleBridge;
  }
}
