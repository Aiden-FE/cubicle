import React from "react";
import { EMPLOYEE_LOOKS } from "./scene/employeeLook.js";

/**
 * Pick the employee's face (ticket 18). The office has no name labels in the
 * scene any more, so the person themselves has to be recognisable — this is
 * where that choice is made. Used by the hire wizard and the edit modal.
 *
 * @param {{
 *   value: string,
 *   onChange: (id: string) => void,
 *   disabled?: boolean,
 *   testId?: string,
 * }} props
 */
export function LookPicker({ value, onChange, disabled = false, testId = "look-picker" }) {
  return (
    <div className="look-picker" data-testid={testId} role="radiogroup" aria-label="员工形象">
      {EMPLOYEE_LOOKS.map((look) => (
        <button
          key={look.id}
          type="button"
          className={`look-option ${value === look.id ? "selected" : ""}`}
          data-testid={`look-option-${look.id}`}
          data-look={look.id}
          role="radio"
          aria-checked={value === look.id}
          aria-label={`形象 ${look.label}`}
          disabled={disabled}
          onClick={() => onChange(look.id)}
        >
          <LookGlyph look={look} />
        </button>
      ))}
    </div>
  );
}

/**
 * A small portrait for the picker: same palette and hair silhouette as the 3D
 * rig, so what you choose is what walks around the office.
 *
 * @param {{ look: import("./scene/employeeLook.js").EmployeeLook }} props
 */
export function LookGlyph({ look }) {
  const { skin, hair, top, hairStyle, decor } = look;
  return (
    <svg className="look-glyph" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="0" y="0" width="48" height="48" rx="11" fill="rgba(43,38,32,0.05)" />
      {/* shoulders */}
      <path d="M9 45 Q9 32 24 32 Q39 32 39 45 Z" fill={top} />
      <path d="M20 33 L24 38 L28 33 Z" fill="rgba(255,255,255,0.22)" />
      {/* neck + head */}
      <rect x="21" y="26" width="6" height="6" rx="2.4" fill={skin} />
      <ellipse cx="24" cy="19" rx="9" ry="9.6" fill={skin} />
      {/* ears */}
      <ellipse cx="14.7" cy="19.4" rx="1.7" ry="2.3" fill={skin} />
      <ellipse cx="33.3" cy="19.4" rx="1.7" ry="2.3" fill={skin} />
      {/* hair by style */}
      {hairStyle === "buzz" ? (
        <path d="M15 17 Q15.5 10 24 10 Q32.5 10 33 17 Q30 13 24 13 Q18 13 15 17 Z" fill={hair} />
      ) : hairStyle === "bun" ? (
        <g>
          <path d="M14.6 18 Q14.5 9.4 24 9.4 Q33.5 9.4 33.4 18 Q30 12.4 24 12.4 Q18 12.4 14.6 18 Z" fill={hair} />
          <circle cx="24" cy="8.4" r="3.4" fill={hair} />
        </g>
      ) : hairStyle === "ponytail" ? (
        <g>
          <path d="M14.6 18 Q14.5 9.4 24 9.4 Q33.5 9.4 33.4 18 Q30 12.4 24 12.4 Q18 12.4 14.6 18 Z" fill={hair} />
          <path d="M32.6 16 Q38 19 36.4 27 Q35.6 31 32.6 31 Q34.6 24 31.8 18 Z" fill={hair} />
        </g>
      ) : hairStyle === "long" ? (
        <g>
          <path d="M14.2 19 Q13.6 8.8 24 8.8 Q34.4 8.8 33.8 19 L33.6 31 Q30.8 27 30.6 20 Q27.4 14.6 24 14.6 Q20.6 14.6 17.4 20 Q17.2 27 14.4 31 Z" fill={hair} />
        </g>
      ) : hairStyle === "curly" ? (
        <g fill={hair}>
          <circle cx="17.4" cy="13.6" r="4" />
          <circle cx="23" cy="11.2" r="4.2" />
          <circle cx="28.8" cy="12.4" r="4" />
          <circle cx="31" cy="17.4" r="3.4" />
          <circle cx="15.4" cy="18.2" r="3.2" />
        </g>
      ) : (
        <path d="M14.6 18 Q14.5 9.4 24 9.4 Q33.5 9.4 33.4 18 Q30 12.4 24 12.4 Q18 12.4 14.6 18 Z" fill={hair} />
      )}
      {/* face hint: eyes only, the office camera sees backs but the picker is a face */}
      <circle cx="20.4" cy="19.6" r="1.1" fill="rgba(38,32,28,0.72)" />
      <circle cx="27.6" cy="19.6" r="1.1" fill="rgba(38,32,28,0.72)" />
      {decor === "glasses" ? (
        <g stroke="rgba(35,31,28,0.8)" strokeWidth="1.1" fill="none">
          <circle cx="20.4" cy="19.6" r="3.1" />
          <circle cx="27.6" cy="19.6" r="3.1" />
          <line x1="23.5" y1="19.6" x2="24.5" y2="19.6" />
        </g>
      ) : null}
      {decor === "headset" ? (
        <g>
          <path d="M14.2 17.6 Q14.6 8.6 24 8.6 Q33.4 8.6 33.8 17.6" stroke="#2f3531" strokeWidth="1.8" fill="none" />
          <rect x="12.6" y="16.4" width="3.4" height="6.6" rx="1.7" fill="#2f3531" />
          <rect x="32" y="16.4" width="3.4" height="6.6" rx="1.7" fill="#2f3531" />
        </g>
      ) : null}
      {decor === "cap" ? (
        <g>
          <path d="M14.6 17.4 Q15.2 9 24 9 Q32.8 9 33.4 17.4 Z" fill="#2f3531" />
          <rect x="12.4" y="16.4" width="23" height="2.4" rx="1.2" fill="#2f3531" />
        </g>
      ) : null}
      {decor === "tie" ? <path d="M22.4 33 L24 35.6 L25.6 33 L24.6 40 L23.4 40 Z" fill="#c99a4c" /> : null}
    </svg>
  );
}
