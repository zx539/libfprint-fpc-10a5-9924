import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import type { SystemStatus } from "../../shared/types";

export function StatusBar({ status, onRefresh }: { status: SystemStatus | null; onRefresh: () => void }) {
  const connected = status?.device?.state === "ready";
  return <footer className="flex h-10 shrink-0 items-center justify-between border-t border-black/10 bg-surface/80 px-5 text-xs text-muted dark:border-white/10">
    <div className="flex items-center gap-4">
      <span className="inline-flex items-center gap-1.5">{connected ? <CheckCircle2 size={15} className="text-emerald-600" /> : <CircleAlert size={15} className="text-amber-600" />}设备：{connected ? "已连接" : "未识别"}</span>
      <span>fprintd：{status?.service === "running" ? "运行中" : "未运行"}</span>
    </div>
    <button className="icon-button" onClick={onRefresh} aria-label="刷新状态" title="刷新"><RefreshCw size={15} /></button>
  </footer>;
}
