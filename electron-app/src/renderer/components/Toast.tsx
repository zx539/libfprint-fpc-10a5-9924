import { CheckCircle2, CircleAlert, X } from "lucide-react";

export function Toast({ message, kind = "success", onClose }: { message: string; kind?: "success" | "error" | "info"; onClose: () => void }) {
  const Icon = kind === "error" ? CircleAlert : CheckCircle2;
  return <div className={`toast ${kind === "error" ? "toast-error" : ""}`} role="status"><Icon size={18} /><span>{message}</span><button className="ml-auto opacity-70 hover:opacity-100" onClick={onClose} aria-label="关闭"><X size={16} /></button></div>;
}
