/**
 * Re-export shim so `policy-hook.mjs` (which imports `./policy.mjs`) typechecks
 * in the trunk tree. At runtime the adapter copies the REAL
 * `src/host/engine/policy.mjs` next to the hook, so the hook always evaluates
 * the host's own decideToolAccess — this file is a compile-time pointer only.
 */
export { decideToolAccess } from "../policy.mjs";
