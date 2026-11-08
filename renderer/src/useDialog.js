import { useEffect, useRef } from "react";

/**
 * Dialog behaviour for the app's drawers/modals: move focus in on mount, close
 * on Escape, cycle Tab inside, and return focus to the opener on unmount.
 * The drawers used to leave focus on a rail button hidden under the overlay.
 *
 * @param {() => void} onClose
 * @returns {any}
 */
export function useDialog(onClose) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    const previous = /** @type {HTMLElement | null} */ (document.activeElement);
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    /** @returns {HTMLElement[]} */
    const focusables = () =>
      root
        ? /** @type {HTMLElement[]} */ (
            Array.from(root.querySelectorAll(selector)).filter(
              (node) => node instanceof HTMLElement && node.offsetParent !== null,
            )
          )
        : [];
    const first = focusables()[0];
    (first ?? root)?.focus();

    const onKey = (/** @type {KeyboardEvent} */ event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const head = nodes[0];
      const tail = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return ref;
}
