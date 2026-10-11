import { Cpu, Fingerprint, RefreshCw, RotateCcw, Server, Usb } from "lucide-react";
import type { ReactNode } from "react";
import type { FingerName, SystemStatus } from "../../shared/types";

export function HomePage({ status, onRefresh, onRestart, onVerify }: { status: SystemStatus | null; onRefresh: () => void; onRestart: () => void; onVerify: (finger: FingerName) => void }) {
  const device = status?.device;
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">设备状态</p><h1>你好，{status?.username || "用户"}</h1><p className="text-muted">查看指纹设备状态并快速开始操作。</p></div><button className="secondary-button" onClick={onRefresh}><RefreshCw size={17} />刷新设备</button></div>
    <div className="grid gap-4 md:grid-cols-3"><Metric icon={<Fingerprint />} value={`${status?.enrolledCount ?? 0}/${status?.maxPrints ?? 10}`} label="已录入指纹" /><Metric icon={<Server />} value={status?.service === "running" ? "运行中" : "未运行"} label="fprintd 服务" tone={status?.service === "running" ? "green" : "amber"} /><Metric icon={<Usb />} value={device ? "已连接" : "未识别"} label="传感器" tone={device ? "green" : "amber"} /></div>
    <section className="panel"><div className="flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Cpu /></div><div className="min-w-0 flex-1"><h2 className="text-lg font-bold">{device?.model || "未发现指纹设备"}</h2><p className="mt-1 text-sm text-muted">{device ? `${device.vendor} · USB ${device.usbId || "D-Bus"}` : "请确认设备已连接，并检查 libfprint 驱动是否已安装。"}</p>{!device && <div className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">提示：运行诊断工具可以查看 USB、服务和 PAM 配置状态。</div>}</div></div></section>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="section-title">快捷操作</h2></div><div className="grid gap-3 md:grid-cols-3"><button className="action-card" onClick={() => onVerify("right-index-finger")}><Fingerprint className="text-accent" /><span><b>验证指纹</b><small>快速测试传感器</small></span></button><button className="action-card" onClick={onRestart}><RotateCcw className="text-accent" /><span><b>重启服务</b><small>修复服务未响应</small></span></button><button className="action-card" onClick={onRefresh}><RefreshCw className="text-accent" /><span><b>刷新设备</b><small>重新检测设备</small></span></button></div></section>
  </div>;
}

function Metric({ icon, value, label, tone = "blue" }: { icon: ReactNode; value: string; label: string; tone?: string }) { return <div className="metric-card"><div className={`metric-icon metric-${tone}`}>{icon}</div><div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-muted">{label}</p></div></div>; }
