/**
 * Event frame coalescer for the main → renderer leg.
 *
 * AgentHost events are queued and shipped to the view at most once per frame
 * (~16ms). Within a frame only the newest envelope per topic survives, which
 * keeps heartbeat spam cheap while domain events stay ordered by first sight.
 */

/**
 * @typedef {import("../shared/envelope.mjs").EventEnvelope} EventEnvelope
 */

/**
 * @param {object} options
 * @param {(batch: EventEnvelope[]) => void} options.send
 * @param {number} [options.frameMs]
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimeoutFn]
 */
export function createEventCoalescer({
  send,
  frameMs = 16,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
}) {
  /** @type {Map<string, EventEnvelope>} */
  let buffer = new Map();
  /** @type {unknown} */
  let timer = null;

  function flush() {
    timer = null;
    if (buffer.size === 0) return;
    const batch = [...buffer.values()];
    buffer = new Map();
    send(batch);
  }

  return {
    /** @param {EventEnvelope} event */
    push(event) {
      buffer.set(event.topic, event);
      if (timer === null) {
        timer = setTimeoutFn(flush, frameMs);
      }
    },
  };
}
