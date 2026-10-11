# libfprint-fpc-10a5-9924

[简体中文](README.zh-CN.md) | English

Patched `libfprint` workflow for Fingerprint Cards sensor `10a5:9924`, specifically for the Honor MagicBook 14 Pro (2025), in the same delivery style as packaged/patched driver repos.

This repo contains:
- a patch against upstream `libfprint` (`fpcmoc`) for experimental `10a5:9924` support
- scripts to apply, build, and install the patched library

## Project Structure

```text
libfprint-fpc-10a5-9924/
├── patches/
│   └── 0001-fpcmoc-add-10a5-9924-experimental-support.patch
├── scripts/
│   ├── apply-patch.sh
│   ├── build-install.sh
│   └── smoke-test.sh
└── README.md
```

## What The Patch Changes

- Adds USB ID `10a5:9924` to `fpcmoc`.
- Adds 9924-specific session-init steps in open/init path:
  - `0x08` indicate S0
  - `0x01` init (event-driven)
  - `0x12` session prepare
  - `0x14` session/auth blob read
  - `0x90` session arm
  - then normal DB load flow
- Enables type-2 identity handling (`16-byte binary identity`) for list/enroll/identify/delete on 9924.
- Keeps legacy behavior for existing `fpcmoc` devices.

## Install

```bash
# 1. Install build deps
sudo apt-get update
sudo apt-get install -y \
  git meson ninja-build cmake pkg-config build-essential \
  libglib2.0-dev libgusb-dev libudev-dev libnss3-dev \
  libcairo2-dev libpam0g-dev libdbus-1-dev libsystemd-dev \
  libssl-dev libgirepository1.0-dev gobject-introspection \
  gtk-doc-tools

# 2. Clone this patch repo
git clone https://github.com/Terrydaktal/libfprint-fpc-10a5-9924.git
cd libfprint-fpc-10a5-9924

# 3. Clone upstream libfprint source
git clone --depth 1 https://gitlab.freedesktop.org/libfprint/libfprint.git ./libfprint-9924

# 4. Apply this repo's patch to upstream libfprint
./scripts/apply-patch.sh ./libfprint-9924

# 5. Build and install patched libfprint
./scripts/build-install.sh ./libfprint-9924

# 6. Restart fprintd
sudo systemctl restart fprintd

# 7. Enroll and verify
fprintd-enroll -f right-index-finger "$USER"
fprintd-list "$USER"
fprintd-verify -f right-index-finger "$USER"
```

Fedora 44 dependencies:

```bash
sudo dnf install -y \
  git meson ninja-build pkgconf-pkg-config \
  gcc gcc-c++ make \
  glib2-devel libgusb-devel systemd-devel nss-devel \
  cairo-devel pam-devel dbus-devel gtk-doc pixman-devel \
  cmake openssl-devel gobject-introspection-devel \
  fprintd fprintd-pam python3-gobject gtk4
```

Fedora build/install behavior:

- `scripts/build-install.sh` now sets explicit Meson `--prefix` and `--libdir`.
- On Fedora, defaults are `--prefix=/usr` and `--libdir=lib64`.
- You can override them with `MESON_PREFIX` and `MESON_LIBDIR`.

Delete behavior in `fprintd`:

```bash
# delete all enrolled fingerprints for the user
fprintd-delete "$USER"

# delete a single enrolled finger
fprintd-delete "$USER" -f right-index-finger
```

## Security / TLS Status

- Windows uses additional secure-auth/TLS-related plumbing (notably around `0x64/0x65/0x6C/0x6D`) in the vendor stack.
- This patch targets a working Linux `libfprint`/`fprintd` flow (enroll/list/verify/delete) for `10a5:9924` and does not claim full Windows secure-auth parity.
- The implemented path includes the required session/auth initialization (`0x12` + `0x14` + `0x90`) and is validated functionally on target hardware.
- If full vendor-secure parity is required, deeper reverse engineering of the Windows secure-auth key/handshake flow is still needed.

## Notes

- This is an experimental patch path based on reverse-engineered traffic and live prototype behavior.
- If identify returns transport errors after suspend/resume, power-cycle the sensor path (`reboot`) and retry.
- If enrollment fails mid-way, rerun enrollment immediately; this device may require cleanup rounds after interrupted captures.

## Fingerprint manager app

This repository also includes a small GTK4 app for managing the current user's fingerprints:

```bash
./scripts/install-fingerprint-manager.sh
~/.local/bin/fingerprint-manager
```

The app provides list, enroll, verify, and delete actions. Run it as the logged-in user rather than with `sudo`.

The repository also contains the source for the Electron-based Fedora Fingerprint Manager under `electron-app/`. It provides a GNOME-style UI with device status, fingerprint management, animated enrollment/verification dialogs, diagnostics, and settings. See [README.zh-CN.md](README.zh-CN.md) for the complete Chinese setup guide.

## Fedora Fingerprint Manager (Electron UI)

The `electron-app/` directory contains the React 18 + TypeScript + Vite + Tailwind + Electron frontend. It keeps Node/system access in the Electron main process, exposes a typed API from `preload.ts`, and uses `dbus-next` to probe `net.reactivated.Fprint` before falling back to the `fprintd-*` commands.

```text
electron-app/
├── src/main/main.ts                 # BrowserWindow, D-Bus probe, fprintd IPC handlers
├── src/preload.ts                   # contextBridge; no Node APIs in React
├── src/shared/types.ts              # IPC and domain types
└── src/renderer/
    ├── App.tsx                      # navigation, polling, dialogs and toasts
    ├── components/                  # GNOME-style shell, modal, animation, errors
    ├── pages/                       # home, fingerprints, enroll, verify, diagnostics, settings
    └── styles.css                   # Tailwind layers and Adwaita-inspired tokens
```

Install frontend dependencies and start the development app:

```bash
cd electron-app
npm install
npm run dev
```

也可以直接执行 `./electron-app/run-dev.sh` 启动开发版。

Build and run the packaged renderer/main output:

```bash
npm run build
npm start
```

Build an x86_64 RPM for Fedora:

```bash
sudo dnf install -y rpm-build
cd electron-app
npm install
./scripts/build-rpm.sh
sudo dnf install -y ./release/fedora-fingerprint-manager-*.rpm
```

The RPM installs the Electron application and declares runtime dependencies on `fprintd`, `polkit`, and `usbutils`. The patched `libfprint` driver itself remains installed by the separate libfprint workflow above.

录入和验证都会打开带动态指纹扫描线的模态窗口；删除单个模板和清空模板会打开 GNOME 风格二次确认窗口。应用应以当前登录用户运行，不要使用 `sudo npm run dev`。
