/**
 * SceneRenderer adapter — the AGENTS.md rendering seam.
 *
 * Interface: given a desk row from the store, where does it sit on the scene?
 * The room is a 640×440 virtual stage; desk coordinates in the database are
 * stage units (seeded by DESK_SLOTS in src/host/store.mjs).
 *
 * Current implementation: DOM/CSS positioning. Ticket 07 swaps this module
 * for the pre-rendered 3D-layer + 2D-character scene behind the same shape;
 * OfficeFloor never learns which one is active.
 */

export const ROOM = { width: 640, height: 440 };

/** Desk-card half-size, so the card centers on its coordinate. */
const ANCHOR = { x: 85, y: 80 };

/**
 * @param {{ x: number, y: number }} desk
 * @returns {{ left: string, top: string }}
 */
export function deskStyle(desk) {
  return {
    left: `calc(${(desk.x / ROOM.width) * 100}% - ${ANCHOR.x}px)`,
    top: `calc(${(desk.y / ROOM.height) * 100}% - ${ANCHOR.y}px)`,
  };
}
