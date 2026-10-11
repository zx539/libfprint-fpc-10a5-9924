export type FingerName =
  | "left-thumb" | "left-index-finger" | "left-middle-finger" | "left-ring-finger" | "left-little-finger"
  | "right-thumb" | "right-index-finger" | "right-middle-finger" | "right-ring-finger" | "right-little-finger";

export type ServiceState = "running" | "stopped" | "unknown";
export type DeviceState = "ready" | "missing" | "busy" | "driver-missing" | "unknown";

export interface FingerprintDevice {
  vendor: string;
  model: string;
  serial: string | null;
  usbId: string | null;
  maxPrints: number;
  state: DeviceState;
}

export interface FingerprintEntry {
  id: string;
  finger: FingerName;
  label: string;
  enrolledAt: string | null;
}

export interface SystemStatus {
  device: FingerprintDevice | null;
  service: ServiceState;
  enrolledCount: number;
  maxPrints: number;
  username: string;
  version: string | null;
  error?: string;
}

export interface OperationResult {
  ok: boolean;
  message: string;
  output?: string;
}

export interface DiagnosticItem {
  id: string;
  label: string;
  status: "ok" | "warning" | "error" | "unknown";
  value: string;
  detail?: string;
}

export interface DiagnosticsReport {
  generatedAt: string;
  items: DiagnosticItem[];
  rawLog: string;
}

export interface FingerprintApi {
  getStatus(): Promise<SystemStatus>;
  listFingerprints(): Promise<FingerprintEntry[]>;
  enroll(finger: FingerName, label?: string): Promise<OperationResult>;
  verify(finger?: FingerName): Promise<OperationResult>;
  cancel(): Promise<OperationResult>;
  deleteFingerprint(id: string): Promise<OperationResult>;
  renameFingerprint(id: string, label: string): Promise<OperationResult>;
  deleteAll(): Promise<OperationResult>;
  restartService(): Promise<OperationResult>;
  diagnostics(): Promise<DiagnosticsReport>;
  setAutostart(enabled: boolean): Promise<OperationResult>;
  setPamEnabled(enabled: boolean): Promise<OperationResult>;
}
