// Deprecated shim: the validation lives in lib/offering-validation.ts now
// (P0-9). Kept so the legacy service routes keep importing from here until
// they are removed in P0-14.
export { parseServiceBody, type ParsedServiceFields } from "./offering-validation";
