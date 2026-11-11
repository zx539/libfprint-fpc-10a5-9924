import { app, BrowserWindow, ipcMain, session } from "electron";
import { execFile } from "node:child_process";
import { systemBus } from "dbus-next";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DiagnosticItem, DiagnosticsReport, FingerName, FingerprintEntry,
  OperationProgress, OperationResult, SystemStatus,
} from "../shared/types";
import { FingerprintOperations } from "./fingerprintOperation";

const exec = promisify(execFile);
const operations = new FingerprintOperations();
let cachedFingerprints: FingerprintEntry[] = [];
let enrollmentStages: number | null = null;
let fingerprintRead: Promise<FingerprintEntry[]> | null = null;
const USER = os.userInfo().username;
const FINGER_LABELS: Record<FingerName, string> = {
  "left-thumb": "左手拇指", "left-index-finger": "左手食指", "left-middle-finger": "左手中指",
  "left-ring-finger": "左手无名指", "left-little-finger": "左手小指", "right-thumb": "右手拇指",
  "right-index-finger": "右手食指", "right-middle-finger": "右手中指", "right-ring-finger": "右手无名指",
  "right-little-finger": "右手小指",
};
const SUPPORTED_FINGERS = Object.keys(FINGER_LABELS) as FingerName[];
const metadataFile = () => path.join(app.getPath("userData"), "fingerprints.json");

interface Metadata { labels: Record<string, string>; enrolledAt: Record<string, string>; }

async function readMetadata(): Promise<Metadata> {
  try { return JSON.parse(await fs.readFile(metadataFile(), "utf8")) as Metadata; }
  catch { return { labels: {}, enrolledAt: {} }; }
}

async function writeMetadata(metadata: Metadata): Promise<void> {
  await fs.mkdir(path.dirname(metadataFile()), { recursive: true });
  await fs.writeFile(metadataFile(), JSON.stringify(metadata, null, 2));
}

async function command(name: string, args: string[] = [], timeout = 180_000): Promise<string> {
  const result = await exec(name, args, { timeout, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } });
  return result.stdout || result.stderr || "";
}

async function commandResult(name: string, args: string[], timeout = 180_000): Promise<OperationResult> {
  return operations.run({ command: name, args, timeout });
}

async function serviceState(): Promise<SystemStatus["service"]> {
  try { await command("systemctl", ["is-active", "--quiet", "fprintd"], 10_000); return "running"; }
  catch (error) {
    const code = (error as { code?: number }).code;
    return code === 3 ? "stopped" : "unknown";
  }
}

async function usbDevice(): Promise<SystemStatus["device"]> {
  try {
    const usb = await command("lsusb");
    const match = usb.match(/ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s+(.+)/i);
    if (!match) return null;
    const [, vendorId, productId, description] = match;
    if (vendorId.toLowerCase() !== "10a5") return null;
    return { vendor: "Fingerprint Cards", model: description.trim(), serial: null, usbId: `${vendorId}:${productId}`, maxPrints: 10, state: "ready" };
  } catch { return null; }
}

async function dbusDeviceProbe(): Promise<{ ready: boolean; stages: number | null }> {
  const bus = systemBus();
  bus.on("error", () => { /* Report connection failures through the probe result. */ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const object = await bus.getProxyObject("net.reactivated.Fprint", "/net/reactivated/Fprint/Manager");
        const devices: string[] = await object.getInterface("net.reactivated.Fprint.Manager").GetDevices();
        if (!devices.length) return { ready: false, stages: null };
        try {
          const device = await bus.getProxyObject("net.reactivated.Fprint", devices[0]);
          const value = await device.getInterface("org.freedesktop.DBus.Properties").Get("net.reactivated.Fprint.Device", "num-enroll-stages");
          const stages = Number(value.value);
          return { ready: true, stages: Number.isInteger(stages) && stages > 0 ? stages : null };
        } catch { return { ready: true, stages: null }; }
      })(),
      new Promise<{ ready: boolean; stages: null }>((resolve) => {
        timer = setTimeout(() => resolve({ ready: false, stages: null }), 3_000);
      }),
    ]);
  } catch { return { ready: false, stages: null }; }
  finally {
    clearTimeout(timer);
    bus.disconnect();
  }
}

async function listFingerprints(): Promise<FingerprintEntry[]> {
  // fprintd-list can Claim the device. Polling must not compete with capture.
  if (operations.busy) return cachedFingerprints;
  if (fingerprintRead) return fingerprintRead;
  fingerprintRead = (async () => {
    const metadata = await readMetadata();
    if (operations.busy) return cachedFingerprints;
    try {
      const output = await command("fprintd-list", [USER], 20_000);
      cachedFingerprints = SUPPORTED_FINGERS.filter((finger) => new RegExp(`\\b${finger}\\b`, "i").test(output)).map((finger) => ({
        id: finger, finger,
        label: metadata.labels[finger] || FINGER_LABELS[finger],
        enrolledAt: metadata.enrolledAt[finger] || null,
      }));
    } catch { /* Retain the last known list on transient device contention. */ }
    return cachedFingerprints;
  })();
  try { return await fingerprintRead; }
  finally { fingerprintRead = null; }
}

async function getStatus(): Promise<SystemStatus> {
  const [device, service, fingerprints] = await Promise.all([usbDevice(), serviceState(), listFingerprints()]);
  const dbusProbe = await dbusDeviceProbe();
  enrollmentStages = dbusProbe.stages;
  const actualDevice = device || (dbusProbe.ready ? { vendor: "fprintd", model: "D-Bus 指纹设备", serial: null, usbId: null, maxPrints: 10, state: "ready" as const } : null);
  let version: string | null = null;
  try { version = (await command("rpm", ["-q", "libfprint"], 10_000)).trim(); } catch { /* optional */ }
  return { device: actualDevice, service, enrolledCount: fingerprints.length, maxPrints: actualDevice?.maxPrints || 10, username: USER, version };
}

function registerHandlers(): void {
  ipcMain.handle("fingerprint:status", getStatus);
  ipcMain.handle("fingerprint:list", listFingerprints);
  const publish = (event: Electron.IpcMainInvokeEvent) => (progress: OperationProgress) => {
    if (!event.sender.isDestroyed()) event.sender.send("fingerprint:progress", progress);
  };
  ipcMain.handle("fingerprint:enroll", async (event, payload: { finger: FingerName; label?: string; operationId?: string }) => {
    const result = await operations.run({ command: "fprintd-enroll", args: ["-f", payload.finger, USER],
      mode: "enroll", operationId: payload.operationId, totalStages: enrollmentStages, onProgress: publish(event) });
    if (result.ok) {
      const metadata = await readMetadata();
      metadata.labels[payload.finger] = payload.label?.trim() || FINGER_LABELS[payload.finger];
      metadata.enrolledAt[payload.finger] = new Date().toISOString();
      await writeMetadata(metadata);
    }
    return result;
  });
  ipcMain.handle("fingerprint:verify", (event, payload: { finger?: FingerName; operationId?: string }) => operations.run({
    command: "fprintd-verify", args: payload.finger ? ["-f", payload.finger, USER] : [USER],
    mode: "verify", operationId: payload.operationId, onProgress: publish(event),
  }));
  ipcMain.handle("fingerprint:cancel", (_event, operationId?: string) => operations.cancel(operationId));
  ipcMain.handle("fingerprint:delete", async (_event, id: string) => {
    const result = await commandResult("fprintd-delete", [USER, "-f", id]);
    if (result.ok) { const metadata = await readMetadata(); delete metadata.labels[id]; delete metadata.enrolledAt[id]; await writeMetadata(metadata); }
    return result;
  });
  ipcMain.handle("fingerprint:delete-all", async () => {
    const result = await commandResult("fprintd-delete", [USER]);
    if (result.ok) await writeMetadata({ labels: {}, enrolledAt: {} });
    return result;
  });
  ipcMain.handle("fingerprint:rename", async (_event, payload: { id: string; label: string }) => {
    const label = payload.label.trim();
    if (!label) return { ok: false, message: "指纹名称不能为空" } satisfies OperationResult;
    const metadata = await readMetadata();
    metadata.labels[payload.id] = label;
    await writeMetadata(metadata);
    return { ok: true, message: "指纹名称已更新" } satisfies OperationResult;
  });
  ipcMain.handle("service:restart", () => commandResult("pkexec", ["systemctl", "restart", "fprintd"], 60_000));
  ipcMain.handle("diagnostics:run", async (): Promise<DiagnosticsReport> => {
    const checks: DiagnosticItem[] = [];
    const add = async (id: string, label: string, run: () => Promise<string>) => {
      try { const value = (await run()).trim(); checks.push({ id, label, status: "ok", value: value || "正常" }); }
      catch (error) { checks.push({ id, label, status: "error", value: "检查失败", detail: (error as Error).message }); }
    };
    await add("libfprint", "libfprint 版本", () => command("rpm", ["-q", "libfprint"]));
    await add("fprintd", "fprintd 服务", () => command("systemctl", ["is-active", "fprintd"]));
    await add("usb", "USB 指纹设备", () => command("lsusb"));
    await add("pam", "PAM 指纹登录", () => command("grep", ["-R", "pam_fprintd", "/etc/pam.d"]));
    return { generatedAt: new Date().toISOString(), items: checks, rawLog: checks.map((item) => `${item.label}: ${item.value}`).join("\n") };
  });
  ipcMain.handle("settings:autostart", async (_event, enabled: boolean) => {
    const file = path.join(app.getPath("appData"), "autostart", "fedora-fingerprint-manager.desktop");
    if (enabled) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `[Desktop Entry]\nType=Application\nName=Fedora Fingerprint Manager\nExec=${process.execPath}\nX-GNOME-Autostart-enabled=true\n`); }
    else { try { await fs.unlink(file); } catch { /* already absent */ } }
    return { ok: true, message: enabled ? "已开启开机自启" : "已关闭开机自启" };
  });
  ipcMain.handle("settings:pam", async (_event, enabled: boolean) => {
    const args = enabled ? ["sh", "-c", "authselect enable-feature with-fingerprint || pam-auth-update --package"] : ["sh", "-c", "authselect disable-feature with-fingerprint || true"];
    return commandResult("pkexec", args, 60_000);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120, height: 760, minWidth: 480, minHeight: 600, title: "Fedora 指纹管理器",
    webPreferences: { preload: path.join(__dirname, "../preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (!app.isPackaged) window.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  else window.loadFile(path.join(app.getAppPath(), "dist/index.html"));
}

app.whenReady().then(() => { session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false)); registerHandlers(); createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
let waitingToQuit = false;
app.on("before-quit", (event) => {
  if (!operations.busy) return;
  event.preventDefault();
  if (waitingToQuit) return;
  waitingToQuit = true;
  void operations.cancel().finally(() => app.quit());
});
