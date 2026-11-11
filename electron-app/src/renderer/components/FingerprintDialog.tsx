import { useEffect, useRef, useState } from "react";
import { ArrowUp, CheckCircle2, CircleAlert, Loader2, RotateCcw } from "lucide-react";
import type { FingerName, OperationProgress, OperationResult } from "../../shared/types";
import { Modal } from "./Modal";
import { FingerprintAnimation } from "./FingerprintAnimation";
import { useFingerprintApi } from "../hooks/useFingerprintApi";

const names: Record<FingerName, string> = { "left-thumb": "左手拇指", "left-index-finger": "左手食指", "left-middle-finger": "左手中指", "left-ring-finger": "左手无名指", "left-little-finger": "左手小指", "right-thumb": "右手拇指", "right-index-finger": "右手食指", "right-middle-finger": "右手中指", "right-ring-finger": "右手无名指", "right-little-finger": "右手小指" };
type State = "ready" | "working" | "cancelling" | "success" | "error";

export function FingerprintDialog({ mode, finger, onClose, onDone }: { mode: "enroll" | "verify"; finger: FingerName; onClose: () => void; onDone: (result: OperationResult) => void }) {
  const api = useFingerprintApi();
  const [selectedFinger, setSelectedFinger] = useState(finger);
  const [label, setLabel] = useState(names[finger]);
  const [state, setState] = useState<State>("ready");
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [result, setResult] = useState<OperationResult | null>(null);
  const operationId = useRef<string | null>(null);
  const mounted = useRef(true);
  const closing = useRef(false);
  const working = state === "working" || state === "cancelling";

  const start = async () => {
    if (operationId.current || closing.current) return;
    const id = crypto.randomUUID();
    operationId.current = id;
    setProgress(null);
    setResult(null);
    setState("working");
    let next: OperationResult;
    try {
      next = mode === "enroll" ? await api.enroll(selectedFinger, label, id) : await api.verify(selectedFinger, id);
    } catch (error) {
      next = { ok: false, message: `操作未完成：${(error as Error).message}` };
    }
    if (operationId.current !== id) return;
    operationId.current = null;
    if (!mounted.current || closing.current) return;
    setResult(next);
    setState(next.ok ? "success" : "error");
    onDone(next);
  };

  useEffect(() => api.onProgress((next) => {
    if (next.operationId === operationId.current && !closing.current) setProgress(next);
  }), [api]);

  useEffect(() => {
    mounted.current = true;
    // Deferring the initial verify avoids starting it twice in StrictMode.
    const timer = mode === "verify" ? window.setTimeout(() => void start(), 0) : undefined;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      if (operationId.current) void api.cancel(operationId.current);
    };
  }, [api, mode]);

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    if (operationId.current) {
      setState("cancelling");
      try { await api.cancel(operationId.current); }
      catch (error) {
        closing.current = false;
        setResult({ ok: false, message: `取消失败：${(error as Error).message}` });
        setState("error");
        return;
      }
    }
    onClose();
  };

  const percent = state === "success" ? 100 : progress?.percent ?? null;
  const retry = working && progress?.phase === "retry";
  const message = state === "cancelling" ? "正在结束采集并释放传感器…" : result?.message || progress?.message ||
    (state === "ready" && mode === "enroll" ? "选择实际录入的手指，再开始采集" : `请将${names[selectedFinger]}放在传感器中央`);
  const title = state === "ready" ? (mode === "enroll" ? "准备录入" : "准备验证") : state === "success" ? (mode === "enroll" ? "指纹已保存" : "验证成功") :
    state === "error" ? (mode === "enroll" ? "录入未完成" : "验证未完成") : state === "cancelling" ? "正在取消" :
    progress?.phase === "saving" ? "正在确认结果" : retry ? "调整后再试一次" : mode === "enroll" ? "正在采集指纹" : "正在验证指纹";

  return <Modal title={mode === "enroll" ? "录入指纹" : "验证指纹"} onClose={() => void close()}>
    <div className="fingerprint-dialog flex flex-col items-center text-center">
      <div className="finger-label">{names[selectedFinger]}</div>
      <FingerprintAnimation active={working} success={state === "success"} error={state === "error"} retry={retry} percent={mode === "enroll" ? percent : null} sample={progress?.completedStages} />
      <h3 className="mt-2 text-xl font-bold">{title}</h3>
      <p className={`capture-message mt-2 text-sm ${retry ? "capture-hint" : "text-muted"}`} role={state === "error" ? "alert" : "status"} aria-live="polite">{message}</p>

      {mode === "enroll" && state !== "ready" && <div className="capture-progress w-full mt-5">
        <div className="mb-2 flex items-center justify-between text-sm"><span className="text-muted">{state === "success" ? "录入完成" : "采集进度"}</span><strong className="progress-number">{percent === null ? "等待设备反馈" : `${percent}%`}</strong></div>
        <div className={`capture-track ${percent === null && working ? "capture-indeterminate" : ""}`} role="progressbar" aria-label="指纹录入进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? "采样总数未知" : `${percent}%`}><span className={state === "error" ? "capture-fill-error" : state === "success" ? "capture-fill-success" : ""} style={{ width: `${percent ?? 0}%` }} /></div>
        <div className="mt-2 flex justify-between text-xs text-muted"><span>已接受 {progress?.completedStages ?? 0} 次采样</span><span>{progress?.totalStages ? `设备目标 ${progress.totalStages} 次` : "按设备反馈更新"}</span></div>
      </div>}

      {mode === "enroll" && state === "ready" && <div className="mt-5 w-full text-left space-y-3">
        <label className="block text-sm font-semibold">录入手指<select className="text-field mt-1" value={selectedFinger} onChange={(event) => { const next = event.target.value as FingerName; setSelectedFinger(next); setLabel(names[next]); }}>{Object.entries(names).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
        <label className="block text-sm font-semibold">显示名称<input className="text-field mt-1" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <p className="text-xs text-muted">用同一根手指反复采集，每次抬起后稍微改变角度。</p>
      </div>}

      {working && <div className={`capture-guidance mt-4 ${retry ? "capture-guidance-retry" : ""}`}>{retry ? <ArrowUp size={18} /> : <Loader2 size={17} className="animate-spin" />}<span>{state === "cancelling" ? "请稍候，正在释放设备" : retry ? "抬起 → 调整 → 再按下" : progress?.phase === "saving" ? "请稍候，确认成功后即可关闭" : "按下 → 抬起 → 调整角度"}</span></div>}
      {state === "success" && <div className="capture-guidance capture-guidance-success mt-4"><CheckCircle2 size={18} />{mode === "enroll" ? "可以继续录入其他手指" : "已确认匹配所选手指"}</div>}
      {state === "error" && <div className="capture-error mt-4 w-full"><div className="flex gap-2 text-left"><CircleAlert size={18} className="shrink-0" /><span>调整后可以重试；已保存的其他指纹会保留。</span></div>{result?.output && <details className="mt-3 text-left"><summary>查看错误详情{result.code ? ` · ${result.code}` : ""}</summary><pre>{result.output}</pre></details>}</div>}

      <div className="mt-6 flex w-full justify-center gap-3">
        {state === "ready" && <button className="primary-button" onClick={() => void start()} disabled={!label.trim()}>开始采集</button>}
        {state === "error" && <><button className="secondary-button" onClick={() => { if (mode === "verify") { void close(); return; } setProgress(null); setResult(null); setState("ready"); }}>{mode === "enroll" ? "重新选择" : "关闭"}</button><button className="primary-button" onClick={() => void start()}><RotateCcw size={16} />重试{mode === "enroll" ? "录入" : "验证"}</button></>}
        {state !== "error" && <button className={state === "success" ? "primary-button" : "secondary-button"} onClick={() => void close()} disabled={state === "cancelling"}>{working ? (state === "cancelling" ? "正在取消…" : "取消操作") : state === "success" ? "完成" : "关闭"}</button>}
      </div>
    </div>
  </Modal>;
}
