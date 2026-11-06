/**
 * One appearance map for every preset role face — the wizard picker and the
 * seated office character read from here (palette + a single decor feature).
 * Full character art (spritesheets, animations) is ticket 07's SceneRenderer
 * work; this table is only the placeholder identity.
 *
 * @typedef {{ skin: string, hair: string, top: string, decor: "glasses" | "tie" | "headset" }} RoleAppearance
 */

/** @type {Record<string, RoleAppearance>} */
export const ROLE_APPEARANCE = {
  programmer: { skin: "#e8b28c", hair: "#31404f", top: "#3c4d5c", decor: "glasses" },
  tester: { skin: "#d9a06b", hair: "#4f3140", top: "#4f6b52", decor: "headset" },
  pm: { skin: "#eec39a", hair: "#2b2620", top: "#a5642f", decor: "tie" },
};

/** @param {string} roleKey @returns {RoleAppearance} */
export function appearanceFor(roleKey) {
  return ROLE_APPEARANCE[roleKey] ?? ROLE_APPEARANCE.programmer;
}
