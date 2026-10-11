import { Fingerprint } from "lucide-react";

export function FingerprintAnimation({ active, success, error }: { active: boolean; success?: boolean; error?: boolean }) {
  return <div className={`fingerprint-animation ${active ? "fingerprint-active" : ""} ${success ? "fingerprint-success" : ""} ${error ? "fingerprint-error" : ""}`}><Fingerprint size={112} strokeWidth={1.25} /><span className="scan-line" /></div>;
}
