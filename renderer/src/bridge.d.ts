/**
 * Bridge types exposed by src/preload/index.cjs on window.cubicle.
 */
export interface CubicleBridge {
  invoke(method: string, payload?: unknown): Promise<unknown>;
  onEvents(handler: (events: EventBatch) => void): () => void;
}

export interface EventEnvelope {
  v: 1;
  kind: "event";
  id: string;
  topic: string;
  payload: unknown;
  ts: number;
}

export type EventBatch = EventEnvelope[];

declare global {
  interface Window {
    cubicle: CubicleBridge;
  }
}
