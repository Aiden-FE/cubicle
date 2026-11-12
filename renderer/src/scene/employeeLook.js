/**
 * Employee looks — the one place the office decides what a person looks like.
 *
 * Ticket 18: the scene carries no text, so who is who has to read from the
 * person itself. A look is picked when hiring (or edited later) and stored on
 * the employee row; the 3D rig, the 2D fallback and the hire wizard's preview
 * all render the same palette.
 *
 * @typedef {"short" | "buzz" | "bun" | "ponytail" | "long" | "curly"} HairStyle
 * @typedef {"none" | "glasses" | "headset" | "tie" | "cap"} LookDecor
 * @typedef {"slim" | "regular" | "broad"} LookBuild
 *
 * @typedef {object} EmployeeLook
 * @property {string} id
 * @property {string} label
 * @property {string} skin
 * @property {string} hair
 * @property {HairStyle} hairStyle
 * @property {string} top
 * @property {string} bottom
 * @property {string} shoes
 * @property {LookDecor} decor
 * @property {LookBuild} build
 * @property {number} height 1.0 = the office's average adult
 */

/** @type {readonly EmployeeLook[]} */
export const EMPLOYEE_LOOKS = [
  {
    id: "lin",
    label: "林",
    skin: "#eec6a0",
    hair: "#2f3742",
    hairStyle: "short",
    top: "#4a6b8a",
    bottom: "#3a4048",
    shoes: "#2c3138",
    decor: "none",
    build: "regular",
    height: 1.0,
  },
  {
    id: "su",
    label: "苏",
    skin: "#e3aa82",
    hair: "#5b3a2e",
    hairStyle: "ponytail",
    top: "#6f8f5c",
    bottom: "#3d463c",
    shoes: "#33302b",
    decor: "glasses",
    build: "slim",
    height: 0.97,
  },
  {
    id: "chen",
    label: "陈",
    skin: "#c98d63",
    hair: "#1f2226",
    hairStyle: "buzz",
    top: "#bf7a3f",
    bottom: "#46413a",
    shoes: "#2a2724",
    decor: "none",
    build: "broad",
    height: 1.03,
  },
  {
    id: "zhou",
    label: "周",
    skin: "#f2d6b8",
    hair: "#7a4a32",
    hairStyle: "bun",
    top: "#8d6ea6",
    bottom: "#3f3a46",
    shoes: "#3a3540",
    decor: "none",
    build: "slim",
    height: 0.96,
  },
  {
    id: "wu",
    label: "吴",
    skin: "#d9a06b",
    hair: "#3b2b26",
    hairStyle: "short",
    top: "#4f6b52",
    bottom: "#39433b",
    shoes: "#2f332e",
    decor: "headset",
    build: "regular",
    height: 1.0,
  },
  {
    id: "zhao",
    label: "赵",
    skin: "#eabd96",
    hair: "#2b2620",
    hairStyle: "long",
    top: "#a9574f",
    bottom: "#43393c",
    shoes: "#332c2d",
    decor: "glasses",
    build: "regular",
    height: 0.99,
  },
  {
    id: "qin",
    label: "秦",
    skin: "#d8b08e",
    hair: "#8d8b86",
    hairStyle: "short",
    top: "#3f4a55",
    bottom: "#2f3740",
    shoes: "#262b31",
    decor: "tie",
    build: "broad",
    height: 1.04,
  },
  {
    id: "he",
    label: "何",
    skin: "#a9744f",
    hair: "#231d1a",
    hairStyle: "curly",
    top: "#cdbb98",
    bottom: "#4a4237",
    shoes: "#312b25",
    decor: "cap",
    build: "regular",
    height: 1.01,
  },
];

/** Which look a preset role defaults to, so existing hires keep a stable face. */
/** @type {Record<string, string>} */
const ROLE_DEFAULT_LOOK = {
  programmer: "lin",
  tester: "wu",
  pm: "qin",
};

/** @param {unknown} id @returns {EmployeeLook | null} */
export function lookById(id) {
  if (typeof id !== "string" || id.length === 0) return null;
  return EMPLOYEE_LOOKS.find((look) => look.id === id) ?? null;
}

/**
 * The look an employee renders with. Rows hired before ticket 18 have no
 * stored look: fall back to the role's default face, never to a blank one.
 *
 * @param {{ appearance?: string | null, roleSnapshot?: { key?: string } } | null} occupant
 * @returns {EmployeeLook}
 */
export function lookFor(occupant) {
  const stored = lookById(String(occupant?.appearance ?? ""));
  if (stored) return stored;
  const roleKey = String(occupant?.roleSnapshot?.key ?? "programmer");
  return lookById(ROLE_DEFAULT_LOOK[roleKey] ?? "lin") ?? EMPLOYEE_LOOKS[0];
}

/**
 * Resolve a hire/edit payload into a stored look id. Unknown ids are rejected
 * so a typo cannot silently become the default face.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeLookId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("appearance must be a look id");
  return lookById(value) ? value : null;
}
