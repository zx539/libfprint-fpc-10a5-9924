import { Fingerprint, Gauge, ListChecks, PlusCircle, Settings, ShieldCheck, Stethoscope } from "lucide-react";

export type Page = "home" | "fingerprints" | "enroll" | "verify" | "diagnostics" | "settings";

const items: Array<{ id: Page; label: string; icon: typeof Gauge }> = [
  { id: "home", label: "首页", icon: Gauge },
  { id: "fingerprints", label: "指纹管理", icon: ListChecks },
  { id: "enroll", label: "录入指纹", icon: PlusCircle },
  { id: "verify", label: "验证测试", icon: ShieldCheck },
  { id: "diagnostics", label: "诊断工具", icon: Stethoscope },
  { id: "settings", label: "设置", icon: Settings },
];

export function Sidebar({ active, onChange }: { active: Page; onChange: (page: Page) => void }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-black/10 bg-surface/80 p-3 dark:border-white/10">
      <div className="flex items-center gap-3 px-3 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white shadow-sm"><Fingerprint size={23} /></div>
        <div><p className="font-bold leading-5">Fedora</p><p className="text-sm text-muted">指纹管理器</p></div>
      </div>
      <nav className="mt-5 space-y-1" aria-label="主导航">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onChange(id)} className={`nav-item ${active === id ? "nav-item-active" : ""}`} aria-current={active === id ? "page" : undefined}>
            <Icon size={19} strokeWidth={active === id ? 2.4 : 2} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-auto rounded-xl bg-canvas/70 p-3 text-xs text-muted"><p className="font-semibold text-ink">安全提示</p><p className="mt-1">指纹模板由设备安全区域处理，应用不会读取原始指纹图像。</p></div>
    </aside>
  );
}
