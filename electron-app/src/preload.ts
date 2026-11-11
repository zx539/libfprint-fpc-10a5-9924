import { contextBridge, ipcRenderer } from "electron";
import type { FingerName, FingerprintApi, OperationProgress } from "./shared/types";

const api: FingerprintApi = {
  getStatus: () => ipcRenderer.invoke("fingerprint:status"),
  listFingerprints: () => ipcRenderer.invoke("fingerprint:list"),
  enroll: (finger: FingerName, label?: string, operationId?: string) => ipcRenderer.invoke("fingerprint:enroll", { finger, label, operationId }),
  verify: (finger?: FingerName, operationId?: string) => ipcRenderer.invoke("fingerprint:verify", { finger, operationId }),
  cancel: (operationId?: string) => ipcRenderer.invoke("fingerprint:cancel", operationId),
  onProgress: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, progress: OperationProgress) => listener(progress);
    ipcRenderer.on("fingerprint:progress", handle);
    return () => ipcRenderer.removeListener("fingerprint:progress", handle);
  },
  deleteFingerprint: (id: string) => ipcRenderer.invoke("fingerprint:delete", id),
  renameFingerprint: (id: string, label: string) => ipcRenderer.invoke("fingerprint:rename", { id, label }),
  deleteAll: () => ipcRenderer.invoke("fingerprint:delete-all"),
  restartService: () => ipcRenderer.invoke("service:restart"),
  diagnostics: () => ipcRenderer.invoke("diagnostics:run"),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke("settings:autostart", enabled),
  setPamEnabled: (enabled: boolean) => ipcRenderer.invoke("settings:pam", enabled),
};

contextBridge.exposeInMainWorld("fingerprintApi", api);
