import versionInfo from "../../version.json";

declare const __BUILD_DATE__: string;
declare const __BUILD_HASH__: string;

export const APP_VERSION = `v${versionInfo.version}`;

export const BUILD_DATE =
  typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : new Date().toISOString();

export const BUILD_HASH =
  typeof __BUILD_HASH__ !== "undefined" ? __BUILD_HASH__ : "dev";

/** Transações criadas antes dessa data são isentas de obrigatoriedade de comprovante */
export const RECEIPT_CUTOFF_DATE = "2026-04-01T00:00:00Z";
