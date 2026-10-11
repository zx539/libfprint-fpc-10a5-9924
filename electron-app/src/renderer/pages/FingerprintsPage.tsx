import { useState } from "react";
import { Check, Edit3, Fingerprint, Plus, Trash2, X } from "lucide-react";
import type { FingerName, FingerprintEntry } from "../../shared/types";

interface Props {
  entries: FingerprintEntry[];
  onEnroll: () => void;
  onVerify: (finger: FingerName) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onRename: (id: string, label: string) => void;
}

export function FingerprintsPage({ entries, onEnroll, onVerify, onDelete, onDeleteAll, onRename }: Props) {
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">模板管理</p><h1>我的指纹</h1><p className="text-muted">管理设备上已保存的指纹模板。</p></div><div className="flex gap-2"><button className="secondary-button" onClick={onDeleteAll} disabled={!entries.length}><Trash2 size={16} />清空全部</button><button className="primary-button" onClick={onEnroll}><Plus size={17} />录入指纹</button></div></div>
    {entries.length === 0 ? <div className="empty-state"><Fingerprint size={54} className="text-accent" /><h2>还没有录入指纹</h2><p>录入指纹后，可以用它解锁设备和验证身份。</p><button className="primary-button mt-4" onClick={onEnroll}><Plus size={17} />开始录入</button></div> : <div className="grid gap-3 md:grid-cols-2">{entries.map((entry) => <FingerprintCard key={entry.id} entry={entry} onVerify={onVerify} onDelete={onDelete} onRename={onRename} />)}</div>}
  </div>;
}

function FingerprintCard({ entry, onVerify, onDelete, onRename }: { entry: FingerprintEntry; onVerify: (finger: FingerName) => void; onDelete: (id: string) => void; onRename: (id: string, label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(entry.label);
  const save = () => { onRename(entry.id, label); setEditing(false); };
  return <article className="finger-card"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Fingerprint size={23} /></div><div className="min-w-0 flex-1">{editing ? <div className="flex gap-1"><input autoFocus className="text-field" value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => event.key === "Enter" && save()} /><button className="icon-button" title="保存" onClick={save}><Check size={17} /></button><button className="icon-button" title="取消" onClick={() => setEditing(false)}><X size={17} /></button></div> : <><h2 className="font-bold">{entry.label}</h2><p className="mt-1 text-sm text-muted">{entry.enrolledAt ? new Date(entry.enrolledAt).toLocaleString() : "设备模板"}</p></>}</div><button className="icon-button" onClick={() => onVerify(entry.finger)} title="验证"><Fingerprint size={17} /></button><button className="icon-button" onClick={() => onDelete(entry.id)} title="删除"><Trash2 size={17} /></button><button className="icon-button" title="重命名" onClick={() => setEditing(true)}><Edit3 size={17} /></button></article>;
}
