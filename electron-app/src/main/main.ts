import { app, BrowserWindow, ipcMain, session } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DiagnosticItem, DiagnosticsReport, FingerName, FingerprintEntry,
  OperationResult, SystemStatus,
} from "../shared/types";

const exec = promisify(execFile);
let activeOperation: ChildProcess | null = null;
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
  return new Promise((resolve) => {
    const child = spawn(name, args, { env: { ...process.env, LC_ALL: "C", LANG: "C" } });
    activeOperation = child;
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("error", (error) => { clearTimeout(timer); activeOperation = null; resolve({ ok: false, message: error.message, output: stderr || stdout }); });
    child.on("close", (code) => { clearTimeout(timer); activeOperation = null; resolve(code === 0 ? { ok: true, message: "操作成功", output: stdout || stderr } : { ok: false, message: stderr.trim() || stdout.trim() || "操作失败", output: stdout || stderr }); });
  });
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

async function dbusDeviceProbe(): Promise<boolean> {
  // The service is queried through D-Bus first. CLI probing remains the fallback
  // because older fprintd versions expose different optional properties.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbus = require("dbus-next") as { systemBus: () => { getProxyObject: (service: string, objectPath: string) => Promise<{ getInterface: (name: string) => { GetDevices: () => Promise<unknown[]> } }>; disconnect: () => void } };
    const bus = dbus.systemBus();
    const object = await bus.getProxyObject("net.reactivated.Fprint", "/net/reactivated/Fprint/Manager");
    const manager = object.getInterface("net.reactivated.Fprint.Manager") as { GetDevices: () => Promise<unknown[]> };
    const devices = await manager.GetDevices();
    bus.disconnect();
    return devices.length > 0;
  } catch { return false; }
}

async function listFingerprints(): Promise<FingerprintEntry[]> {
  const metadata = await readMetadata();
  try {
    const output = await command("fprintd-list", [USER], 20_000);
    return SUPPORTED_FINGERS.filter((finger) => new RegExp(`\\b${finger}\\b`, "i").test(output)).map((finger) => ({
      id: finger,
      finger,
      label: metadata.labels[finger] || FINGER_LABELS[finger],
      enrolledAt: metadata.enrolledAt[finger] || null,
    }));
  } catch { return []; }
}

async function getStatus(): Promise<SystemStatus> {
  const [device, service, fingerprints] = await Promise.all([usbDevice(), serviceState(), listFingerprints()]);
  const dbusReady = await dbusDeviceProbe();
  const actualDevice = device || (dbusReady ? { vendor: "fprintd", model: "D-Bus 指纹设备", serial: null, usbId: null, maxPrints: 10, state: "ready" as const } : null);
  let version: string | null = null;
  try { version = (await command("rpm", ["-q", "libfprint"], 10_000)).trim(); } catch { /* optional */ }
  return { device: actualDevice, service, enrolledCount: fingerprints.length, maxPrints: actualDevice?.maxPrints || 10, username: USER, version };
}

function registerHandlers(): void {
  ipcMain.handle("fingerprint:status", getStatus);
  ipcMain.handle("fingerprint:list", listFingerprints);
  ipcMain.handle("fingerprint:enroll", async (_event, payload: { finger: FingerName; label?: string }) => {
    const result = await commandResult("fprintd-enroll", ["-f", payload.finger, USER]);
    if (result.ok) {
      const metadata = await readMetadata();
      metadata.labels[payload.finger] = payload.label?.trim() || FINGER_LABELS[payload.finger];
      metadata.enrolledAt[payload.finger] = new Date().toISOString();
      await writeMetadata(metadata);
    }
    return result;
  });
  ipcMain.handle("fingerprint:verify", async (_event, payload: { finger?: FingerName }) => commandResult("fprintd-verify", payload.finger ? ["-f", payload.finger, USER] : [USER]));
  ipcMain.handle("fingerprint:cancel", async () => { if (activeOperation) { activeOperation.kill("SIGINT"); return { ok: true, message: "操作已取消" }; } return { ok: true, message: "没有正在进行的操作" }; });
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
