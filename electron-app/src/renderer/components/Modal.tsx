import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal-panel ${wide ? "max-w-2xl" : "max-w-md"}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-4 dark:border-white/10"><h2 className="text-lg font-bold">{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      <div className="p-6">{children}</div>
    </section>
  </div>;
}
