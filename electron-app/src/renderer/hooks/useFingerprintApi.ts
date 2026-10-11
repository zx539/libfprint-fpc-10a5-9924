import { useMemo } from "react";
import type { FingerprintApi } from "../../shared/types";

/** Typed boundary for all renderer-to-main-process calls. */
export function useFingerprintApi(): FingerprintApi {
  return useMemo(() => window.fingerprintApi, []);
}
