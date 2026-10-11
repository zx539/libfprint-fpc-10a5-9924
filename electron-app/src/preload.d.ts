import type { FingerprintApi } from "./shared/types";

declare global {
  interface Window { fingerprintApi: FingerprintApi; }
}

export {};
