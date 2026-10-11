import { contextBridge, ipcRenderer } from "electron";
import type { FingerName, FingerprintApi } from "./shared/types";

const api: FingerprintApi = {
  getStatus: () => ipcRenderer.invoke("fingerprint:status"),
  listFingerprints: () => ipcRenderer.invoke("fingerprint:list"),
  enroll: (finger: FingerName, label?: string) => ipcRenderer.invoke("fingerprint:enroll", { finger, label }),
  verify: (finger?: FingerName) => ipcRenderer.invoke("fingerprint:verify", { finger }),
  cancel: () => ipcRenderer.invoke("fingerprint:cancel"),
  deleteFingerprint: (id: string) => ipcRenderer.invoke("fingerprint:delete", id),
  renameFingerprint: (id: string, label: string) => ipcRenderer.invoke("fingerprint:rename", { id, label }),
  deleteAll: () => ipcRenderer.invoke("fingerprint:delete-all"),
  restartService: () => ipcRenderer.invoke("service:restart"),
  diagnostics: () => ipcRenderer.invoke("diagnostics:run"),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke("settings:autostart", enabled),
  setPamEnabled: (enabled: boolean) => ipcRenderer.invoke("settings:pam", enabled),
};

contextBridge.exposeInMainWorld("fingerprintApi", api);
