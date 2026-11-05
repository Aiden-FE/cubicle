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

export interface CubicleBridge {
  invoke(method: string, payload?: unknown): Promise<unknown>;
  subscribe(topic: string, handler: (event: EventEnvelope) => void): () => void;
}

/** Topic names mirrored from src/shared/envelope.mjs TOPICS (realm boundary). */
export const TOPICS = {
  hostStatus: "host.status",
  domainChanged: "domain.changed",
};

declare global {
  interface Window {
    cubicle: CubicleBridge;
  }
}
