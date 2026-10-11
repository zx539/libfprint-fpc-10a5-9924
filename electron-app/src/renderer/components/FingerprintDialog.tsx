import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import type { FingerName, OperationResult } from "../../shared/types";
import { Modal } from "./Modal";
import { FingerprintAnimation } from "./FingerprintAnimation";
import { useFingerprintApi } from "../hooks/useFingerprintApi";

const names: Record<FingerName, string> = { "left-thumb": "左手拇指", "left-index-finger": "左手食指", "left-middle-finger": "左手中指", "left-ring-finger": "左手无名指", "left-little-finger": "左手小指", "right-thumb": "右手拇指", "right-index-finger": "右手食指", "right-middle-finger": "右手中指", "right-ring-finger": "右手无名指", "right-little-finger": "右手小指" };

export function FingerprintDialog({ mode, finger, onClose, onDone }: { mode: "enroll" | "verify"; finger: FingerName; onClose: () => void; onDone: (result: OperationResult) => void }) {
  const [label, setLabel] = useState(names[finger]);
  const api = useFingerprintApi();
  const cancelled = useRef(false);
  const [state, setState] = useState<"ready" | "working" | "success" | "error">(mode === "enroll" ? "ready" : "working");
  const [message, setMessage] = useState(mode === "enroll" ? "选择手指名称后，点击开始采集" : `请将${names[finger]}放到传感器上`);
  useEffect(() => {
    if (state !== "working") return;
    let disposed = false;
    (async () => {
      const result = mode === "enroll" ? await api.enroll(finger, label) : await api.verify(finger);
      if (cancelled.current || disposed) return;
      setState(result.ok ? "success" : "error");
      setMessage(result.ok ? (mode === "enroll" ? "录入成功，指纹模板已保存" : "匹配成功") : result.message || "操作失败，请重试");
      onDone(result);
    })();
    return () => { disposed = true; };
  }, [api, mode, finger, state]); // One native operation per dialog; closing cancels the UI, fprintd times out safely.
  const close = async () => { if (state === "working") { cancelled.current = true; await api.cancel(); } onClose(); };
  return <Modal title={mode === "enroll" ? "录入指纹" : "验证指纹"} onClose={() => void close()}>
    <div className="flex flex-col items-center text-center">
      <FingerprintAnimation active={state === "working"} success={state === "success"} error={state === "error"} />
      <h3 className="mt-3 text-xl font-bold">{state === "ready" ? "准备录入" : state === "working" ? (mode === "enroll" ? "正在采集指纹" : "正在验证") : state === "success" ? "完成" : "未完成"}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted">{message}</p>
      {mode === "enroll" && state === "ready" && <label className="mt-5 w-full text-left text-sm font-semibold">指纹名称<input className="text-field mt-1" value={label} onChange={(event) => setLabel(event.target.value)} /></label>}
      {mode === "enroll" && state === "ready" && <button className="primary-button mt-6" onClick={() => { setMessage(`请反复抬起并按下：${names[finger]}`); setState("working"); }} disabled={!label.trim()}>开始采集</button>}
      {state === "working" && <div className="mt-5 flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" />传感器正在等待操作…</div>}
      {state === "error" && <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-left text-sm text-red-700 dark:text-red-300"><CircleAlert size={17} className="mt-0.5 shrink-0" />检查手指位置、传感器清洁度和 fprintd 服务后重试。</div>}
      {state === "working" && <button className="secondary-button mt-6" onClick={() => void close()}>取消操作</button>}
      {state !== "working" && <button className="primary-button mt-6" onClick={onClose}>关闭</button>}
    </div>
  </Modal>;
}
