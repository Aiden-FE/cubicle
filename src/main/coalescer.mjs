/**
 * Event frame coalescer for the main → renderer leg.
 *
 * AgentHost events are queued and shipped to the view at most once per frame
 * (~16ms). Only idempotent topics (heartbeats — last write wins) collapse;
 * domain events are preserved one by one, in order.
 */

import { TOPICS } from "../shared/envelope.mjs";

/**
 * @typedef {import("../shared/envelope.mjs").EventEnvelope} EventEnvelope
 */

/**
 * @param {object} options
 * @param {(batch: EventEnvelope[]) => void} options.send
 * @param {number} [options.frameMs]
 * @param {Set<string>} [options.idempotentTopics] topics where only the newest survives a frame
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimeoutFn]
 */
export function createEventCoalescer({
  send,
  frameMs = 16,
  idempotentTopics = new Set([TOPICS.hostStatus]),
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
}) {
  /** @type {EventEnvelope[]} */
  let buffer = [];
  /** @type {unknown} */
  let timer = null;

  function flush() {
    timer = null;
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    send(batch);
  }

  return {
    /** @param {EventEnvelope} event */
    push(event) {
      if (idempotentTopics.has(event.topic)) {
        const existing = buffer.findIndex((queued) => queued.topic === event.topic);
        if (existing >= 0) {
          buffer[existing] = event;
        } else {
          buffer.push(event);
        }
      } else {
        buffer.push(event);
      }
      if (timer === null) {
        timer = setTimeoutFn(flush, frameMs);
      }
    },
  };
}
