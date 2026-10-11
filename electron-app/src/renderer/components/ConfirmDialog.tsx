import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

export function ConfirmDialog({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return <Modal title={title} onClose={onCancel}><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-600"><AlertTriangle size={20} /></div><p className="text-sm leading-6 text-muted">{message}</p></div><div className="mt-6 flex justify-end gap-2"><button className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button bg-red-600 hover:bg-red-700" onClick={onConfirm}>确认删除</button></div></Modal>;
}
