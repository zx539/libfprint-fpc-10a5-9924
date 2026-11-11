import { Check, Fingerprint, X } from "lucide-react";

export function FingerprintAnimation({ active, success, error, retry, percent, sample = 0 }: {
  active: boolean; success?: boolean; error?: boolean; retry?: boolean; percent?: number | null; sample?: number;
}) {
  const circumference = 2 * Math.PI * 76;
  return <div className={`fingerprint-animation ${active ? "fingerprint-active" : ""} ${success ? "fingerprint-success" : ""} ${error ? "fingerprint-error" : ""} ${retry ? "fingerprint-retry" : ""}`} aria-hidden="true">
    <span className="sensor-halo" />
    <svg className="progress-ring" viewBox="0 0 176 176"><circle className="progress-ring-track" cx="88" cy="88" r="76" /><circle className="progress-ring-value" cx="88" cy="88" r="76" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (success ? 100 : percent ?? 0) / 100)} /></svg>
    <div className="fingerprint-glyph" key={`${success}-${error}-${retry}-${sample}`}><Fingerprint size={100} strokeWidth={1.2} /></div>
    <span className="scan-line" />
    {(success || error) && <span className="result-badge">{success ? <Check size={22} strokeWidth={3} /> : <X size={22} strokeWidth={3} />}</span>}
    {active && sample > 0 && <span className="sample-ripple" key={sample} />}
  </div>;
}
