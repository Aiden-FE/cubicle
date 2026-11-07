/**
 * SceneRenderer adapter — the AGENTS.md rendering seam.
 *
 * Interface: given a desk row from the store, where does it sit on the scene?
 * The room is a 640×440 virtual stage; desk coordinates in the database are
 * stage units (seeded by DESK_SLOTS in src/host/store.mjs).
 *
 * Current implementation: DOM/CSS positioning. Ticket 07 added the工位
 * animation layer (scene/{toolActivity,deskActivity,idleMotion,deskReadout}
 * .js — pure state modules) behind the same seam, still painted with DOM/SVG
 * art; swapping to a pre-rendered 3D-layer + 2D-character scene later only
 * replaces OfficeFloor's painting step — the state modules and this
 * positioning contract survive it, and OfficeFloor never learns which
 * renderer is active.
 */

export const ROOM = { width: 640, height: 440 };

/** Workstation-card half-size, so the card centers on its coordinate. */
const ANCHOR = { x: 85, y: 76 };

/**
 * @param {{ x: number, y: number }} desk
 * @returns {{ left: string, top: string, zIndex: number }}
 */
export function deskStyle(desk) {
  return {
    left: `calc(${(desk.x / ROOM.width) * 100}% - ${ANCHOR.x}px)`,
    top: `calc(${(desk.y / ROOM.height) * 100}% - ${ANCHOR.y}px)`,
    // Dollhouse painter's order: things nearer the viewer sit on top.
    zIndex: desk.y,
  };
}
