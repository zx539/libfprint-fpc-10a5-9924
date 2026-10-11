import { useCallback, useEffect, useState } from "react";
import type { FingerName, FingerprintEntry, OperationResult, SystemStatus } from "../shared/types";
import { Sidebar, type Page } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toast } from "./components/Toast";
import { FingerprintDialog } from "./components/FingerprintDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { HomePage } from "./pages/HomePage";
import { FingerprintsPage } from "./pages/FingerprintsPage";
import { EnrollPage } from "./pages/EnrollPage";
import { VerifyPage } from "./pages/VerifyPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useFingerprintApi } from "./hooks/useFingerprintApi";

type Dialog = { mode: "enroll" | "verify"; finger: FingerName } | null;
type Confirm = { title: string; message: string; action: () => Promise<void> } | null;

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [entries, setEntries] = useState<FingerprintEntry[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" | "info" } | null>(null);
  const api = useFingerprintApi();
  const notify = useCallback((message: string, kind: "success" | "error" | "info" = "success") => setToast({ message, kind }), []);
  const refresh = useCallback(async () => { try { const [nextStatus, nextEntries] = await Promise.all([api.getStatus(), api.listFingerprints()]); setStatus(nextStatus); setEntries(nextEntries); } catch (error) { notify((error as Error).message, "error"); } }, [api, notify]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 10_000); return () => window.clearInterval(timer); }, [refresh]);
  const operationDone = (result: OperationResult) => { notify(result.message, result.ok ? "success" : "error"); if (result.ok) void refresh(); };
  const restart = async () => { const result = await api.restartService(); notify(result.message, result.ok ? "success" : "error"); void refresh(); };
  const deleteOne = async (id: string) => setConfirm({ title: "删除指纹", message: "删除后无法恢复这个指纹模板，确定继续吗？", action: async () => { const result = await api.deleteFingerprint(id); notify(result.message, result.ok ? "success" : "error"); void refresh(); } });
  const deleteAll = async () => setConfirm({ title: "清空全部指纹", message: "这会删除当前用户的全部指纹模板，确定继续吗？", action: async () => { const result = await api.deleteAll(); notify(result.message, result.ok ? "success" : "error"); void refresh(); } });
  const rename = async (id: string, label: string) => { const result = await api.renameFingerprint(id, label); notify(result.message, result.ok ? "success" : "error"); if (result.ok) void refresh(); };
  const openEnroll = () => setDialog({ mode: "enroll", finger: "right-index-finger" });
  const openVerify = (finger: FingerName = "right-index-finger") => setDialog({ mode: "verify", finger });
  return <div className="app-shell"><Sidebar active={page} onChange={setPage} /><main className="flex min-w-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-10">{page === "home" && <HomePage status={status} onRefresh={() => void refresh()} onRestart={restart} onVerify={openVerify} />}{page === "fingerprints" && <FingerprintsPage entries={entries} onEnroll={openEnroll} onVerify={openVerify} onDelete={deleteOne} onDeleteAll={deleteAll} onRename={rename} />}{page === "enroll" && <EnrollPage onStart={openEnroll} />}{page === "verify" && <VerifyPage onStart={() => openVerify()} />}{page === "diagnostics" && <DiagnosticsPage />}{page === "settings" && <SettingsPage notify={notify} />}</div><StatusBar status={status} onRefresh={() => void refresh()} /></main>{dialog && <FingerprintDialog mode={dialog.mode} finger={dialog.finger} onClose={() => setDialog(null)} onDone={operationDone} />}{confirm && <ConfirmDialog title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={async () => { const action = confirm.action; setConfirm(null); await action(); }} />}{toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}</div>;
}
