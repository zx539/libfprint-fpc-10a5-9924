import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { OperationProgress, OperationResult } from "../shared/types";

const feedback: Record<string, string> = {
  "enroll-stage-passed": "本次采样已接受，请抬起手指，再稍微调整位置按下",
  "enroll-retry-scan": "本次图像不够清晰，请擦拭传感器后重新按下",
  "enroll-swipe-too-short": "接触时间太短，请让指腹充分贴合传感器",
  "enroll-finger-not-centered": "手指没有居中，请把指腹放在传感器中央",
  "enroll-remove-and-retry": "请完全抬起手指，再调整角度按下",
  "enroll-duplicate": "这个指纹已经录入，请换一根手指或先管理已有指纹",
  "enroll-data-full": "传感器存储空间已满，请删除不需要的指纹后重试",
  "enroll-failed": "录入未完成，请清洁传感器并重新采集",
  "enroll-disconnected": "传感器连接已断开，请检查设备后重试",
  "enroll-unknown-error": "传感器未能完成录入，请查看错误详情",
  "verify-no-match": "指纹不匹配，请确认使用了所选手指后重试",
  "verify-retry-scan": "未能识别，请抬起手指后重新按下",
  "verify-swipe-too-short": "接触时间太短，请让指腹充分贴合传感器",
  "verify-finger-not-centered": "手指没有居中，请将指腹移到传感器中央",
  "verify-remove-and-retry": "请抬起手指，再重新按下",
  "verify-disconnected": "传感器连接已断开，请检查设备后重试",
  "verify-unknown-error": "验证未能完成，请查看错误详情",
};

function errorMessage(output: string): string {
  if (/already claimed|AlreadyInUse|device.*busy/i.test(output)) return "传感器正在被其他操作占用，请结束其他录入或验证后重试";
  if (/PermissionDenied|NotAuthorized|permission denied|authorization.*denied/i.test(output)) return "没有指纹操作权限，请完成系统授权后重试";
  if (/NoSuchDevice|No devices|no device available/i.test(output)) return "没有找到指纹传感器，请检查连接和 fprintd 服务";
  return output.trim().split(/\r?\n/).filter(Boolean).at(-1) || "操作未完成，请重试或查看错误详情";
}

interface Request {
  command: string;
  args: string[];
  mode?: OperationProgress["mode"];
  operationId?: string;
  totalStages?: number | null;
  onProgress?: (progress: OperationProgress) => void;
  timeout?: number;
}

/** Owns a native operation until the process exits, including cancellation. */
export class FingerprintOperations {
  private active: { child: ChildProcess; id: string; cancel: () => void; finished: Promise<OperationResult> } | null = null;

  get busy(): boolean { return this.active !== null; }

  async cancel(operationId?: string): Promise<OperationResult> {
    const active = this.active;
    if (!active) return { ok: true, message: "没有正在进行的操作" };
    if (operationId && operationId !== active.id) return { ok: false, message: "当前操作已变化，请重新打开窗口", code: "operation-mismatch" };
    active.cancel();
    await active.finished;
    return { ok: true, message: "操作已取消", code: "cancelled" };
  }

  run(request: Request): Promise<OperationResult> {
    if (this.active) return Promise.resolve({ ok: false, message: "已有操作正在进行，请等待完成后重试", code: "busy" });
    const id = request.operationId || randomUUID();
    const total = request.totalStages && request.totalStages > 0 ? request.totalStages : null;
    let stages = 0;
    let terminal: string | undefined;
    let cancelled = false;
    let timedOut = false;
    let output = "";
    const emit = (phase: OperationProgress["phase"], message: string, code?: string) => {
      if (!request.mode) return;
      request.onProgress?.({ operationId: id, mode: request.mode, phase, message, code,
        completedStages: stages, totalStages: total,
        percent: phase === "success" ? 100 : total ? Math.min(99, Math.floor(stages / total * 100)) : null });
    };
    const handleLine = (line: string) => {
      const status = line.match(/(?:Enroll|Verify) result:\s*([a-z-]+)/i)?.[1].toLowerCase();
      if (!status || cancelled || timedOut) return;
      if (status === "enroll-stage-passed") {
        stages++;
        emit("sample", feedback[status], status);
      } else if (status === "enroll-completed" || status === "verify-match") {
        terminal = status;
        // The process still needs to exit successfully before showing 100%.
        emit("saving", request.mode === "enroll" ? "采集完成，正在确认指纹保存结果…" : "已匹配，正在确认验证结果…", status);
      } else if (/retry|too-short|not-centered/.test(status)) {
        emit("retry", feedback[status] || "请抬起手指并重新按下", status);
      } else {
        terminal = status;
        emit("error", feedback[status] || "操作失败，请查看错误详情", status);
      }
    };

    let finish!: (result: OperationResult) => void;
    const finished = new Promise<OperationResult>((resolve) => { finish = resolve; });
    const child = spawn(request.command, request.args, { env: { ...process.env, LC_ALL: "C", LANG: "C" } });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill("SIGINT");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, request.timeout ?? 180_000);
    this.active = { child, id, finished, cancel: () => { cancelled = true; stop(); } };
    emit("waiting", request.mode === "enroll" ? "请将所选手指放在传感器中央" : "请将所选手指放到传感器上");

    const tails = { stdout: "", stderr: "" };
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream]?.setEncoding("utf8");
      child[stream]?.on("data", (chunk: string) => {
        output = (output + chunk).slice(-1024 * 1024);
        const lines = (tails[stream] + chunk).split(/\r\n|\n|\r/);
        tails[stream] = lines.pop()!.slice(-16_384);
        for (const line of lines) handleLine(line);
      });
    }
    let spawnError: Error | undefined;
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      handleLine(tails.stdout);
      handleLine(tails.stderr);
      const expected = request.mode === "enroll" ? "enroll-completed" : "verify-match";
      const ok = !cancelled && !timedOut && !spawnError && exitCode === 0 && (!request.mode || terminal === expected);
      const code = cancelled ? "cancelled" : timedOut ? "timeout" : spawnError ? "spawn-error" : terminal;
      const message = cancelled ? "操作已取消" : timedOut ? "等待传感器超时，请重试" :
        spawnError ? `无法启动指纹工具：${spawnError.message}` : ok ? (request.mode === "enroll" ? "指纹录入成功" : request.mode === "verify" ? "指纹验证成功" : "操作成功") :
        feedback[terminal || ""] || errorMessage(output);
      emit(ok ? "success" : cancelled ? "cancelled" : "error", message, code);
      if (this.active?.child === child) this.active = null;
      finish({ ok, message, output, code });
    });
    return finished;
  }
}
