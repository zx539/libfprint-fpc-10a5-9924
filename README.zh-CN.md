# libfprint-fpc-10a5-9924

[English](README.md) | 简体中文

这是一个针对 FPC 指纹传感器 `10a5:9924` 的实验性 `libfprint` 补丁项目，主要面向荣耀 MagicBook 14 Pro（2025）等使用相同传感器的 Fedora Linux 笔记本。

项目通过修改上游 `libfprint` 的 `fpcmoc` 驱动，让 `fprintd` 支持该设备的录入、列表、验证和删除操作。同时提供 GTK4 和 Electron 两个图形界面，方便管理指纹。

## 功能

- 为 `fpcmoc` 添加 USB ID `10a5:9924`。
- 添加该型号所需的会话初始化流程：`0x08`、`0x01`、`0x12`、`0x14`、`0x90`。
- 支持 16 字节二进制 identity，用于录入、识别、列表和删除。
- 保留其他 `fpcmoc` 设备的原有行为。
- 提供命令行、GTK4 和 Electron 管理工具。
- Electron 管理器提供设备状态、指纹列表、录入、验证、诊断、设置和动画反馈。

## Fedora 安装补丁驱动

以下步骤会从源码构建并安装修改后的 `libfprint`。需要 Fedora 管理员权限安装依赖和写入 `/usr`。

### 1. 安装依赖

```bash
sudo dnf install -y \
  git meson ninja-build pkgconf-pkg-config \
  gcc gcc-c++ make \
  glib2-devel libgusb-devel systemd-devel nss-devel \
  cairo-devel pam-devel dbus-devel gtk-doc pixman-devel \
  cmake openssl-devel gobject-introspection-devel \
  fprintd fprintd-pam python3-gobject gtk4
```

### 2. 下载项目和上游源码

```bash
git clone git@github.com:zx539/libfprint-fpc-10a5-9924.git
cd libfprint-fpc-10a5-9924

git clone --depth 1 \
  https://gitlab.freedesktop.org/libfprint/libfprint.git \
  ./libfprint-9924
```

### 3. 应用补丁并安装

```bash
./scripts/apply-patch.sh ./libfprint-9924
./scripts/build-install.sh ./libfprint-9924
```

脚本在 Fedora 上默认使用 `--prefix=/usr` 和 `--libdir=lib64`。如需覆盖安装路径，可设置：

```bash
MESON_PREFIX=/usr MESON_LIBDIR=lib64 ./scripts/build-install.sh ./libfprint-9924
```

安装后可以重启服务并检查设备：

```bash
sudo systemctl restart fprintd
lsusb | grep -i 10a5:9924
systemctl --no-pager status fprintd
```

如果 `apply-patch.sh` 提示补丁已经应用或上下文不匹配，请重新克隆干净的上游源码。该补丁基于特定的上游版本，未来版本可能需要手工调整。

## 命令行录入和验证

```bash
# 录入右手食指
fprintd-enroll -f right-index-finger "$USER"

# 查看当前用户的指纹
fprintd-list "$USER"

# 验证指纹
fprintd-verify -f right-index-finger "$USER"

# 删除单个指纹
fprintd-delete "$USER" -f right-index-finger

# 删除当前用户的全部指纹
fprintd-delete "$USER"
```

录入、验证或删除时请以当前登录用户执行，不要使用 `sudo`。如果服务未运行，可以先执行 `sudo systemctl restart fprintd`。

### 第二个指纹被判定为重复

早期补丁会在身份标识不匹配、系统只登记了一根手指时，把芯片返回的其他匹配也当成这根手指，导致第二次录入报 `enroll-duplicate`。更新后的补丁只接受身份标识一致的匹配；重新登记芯片内已有的手指时，会保存传感器实际返回的身份，而不是创建新的别名。

从早期版本升级后，请重新录入原来登记的手指，以更新旧的身份映射，然后再录入其他手指。此修复位于 libfprint 驱动，需要重新构建并安装驱动；仅更新 GUI 的 RPM 不会更新驱动。

驱动构建完成后，可以运行不需要传感器的回归测试：

```bash
python3 scripts/test-fpc-identity.py ./libfprint-9924
```

## GTK4 指纹管理器

仓库根目录的 `fingerprint-manager.py` 是一个轻量 GTK4 管理工具。安装当前用户的启动器：

```bash
./scripts/install-fingerprint-manager.sh
~/.local/bin/fingerprint-manager
```

它支持刷新列表、选择手指、录入、验证和删除，并带有指纹扫描动画。需要已安装 `python3-gobject` 和 GTK4。

## Fedora Fingerprint Manager（Electron）

`electron-app/` 是 React 18 + TypeScript + Vite + Tailwind CSS + Electron 应用。主进程通过 D-Bus 和 `fprintd-*` 命令访问系统，渲染进程只使用 preload 暴露的类型化 IPC API。

### 开发运行

```bash
cd electron-app
npm install
npm run dev
```

也可以从仓库根目录执行：

```bash
./electron-app/run-dev.sh
```

应用应以当前登录用户运行，不要使用 `sudo npm run dev`。

### 构建和运行

```bash
cd electron-app
npm run build
npm start
```

### 构建 Fedora RPM

RPM 构建使用本地 Electron 目录和 Fedora 原生 `rpmbuild`，不需要下载 FPM：

```bash
sudo dnf install -y rpm-build
cd electron-app
npm install
./scripts/build-rpm.sh
```

生成的包位于 `electron-app/release/`，安装命令为：

```bash
sudo dnf install -y ./release/fedora-fingerprint-manager-*.rpm
fedora-fingerprint-manager
```

RPM 会安装桌面启动器和 Electron 应用，并声明 `fprintd`、`polkit`、`usbutils` 运行时依赖。RPM 只包含管理器，不会替代上面的 `libfprint` 补丁安装流程。

## 安全和 TLS 说明

Windows 厂商驱动还包含围绕 `0x64`、`0x65`、`0x6C`、`0x6D` 的安全认证/TLS 流程。本项目实现的是 Linux 上可工作的 `libfprint`/`fprintd` 录入、列表、验证和删除路径，不宣称与 Windows 安全认证完全兼容。

补丁包含目标设备所需的会话认证初始化（`0x12`、`0x14`、`0x90`）。如果需要完整的厂商安全认证兼容性，仍需继续逆向 Windows 驱动的密钥和握手流程。

## GUI 0.2.0 的采集反馈

录入窗口会显示设备反馈的百分比、已接受的采样次数和环形进度，同时提供扫描线、采样脉冲、成功勾选和错误反馈动画。手指未居中或需要抬起时会即时显示调整建议；重复指纹、空间不足、设备占用等错误会显示中文原因及可展开的原始详情。可以直接重试或取消，界面也支持系统的减少动态效果设置。

百分比按设备报告的采样总数计算，未知总数时显示等待状态；确认录入成功前不会显示 100%。取消时会等待原进程退出，录入和验证期间暂停列表轮询，减少争抢设备。

多指纹问题的原因、驱动修复和验证过程见 [修复复盘](Learn/bug-fixed/FPC9924-多指纹录入失败复盘.md)。在 `electron-app` 目录执行 `npm test` 可运行操作流测试，执行 `npm run test:ui` 可用模拟指纹验收完整 Electron 界面，不改动真实指纹。

## 故障排查

- **找不到设备**：确认 `lsusb` 能看到 `10a5:9924`，并重新插拔或重启电脑。
- **fprintd 未运行**：执行 `sudo systemctl restart fprintd`，再查看 `systemctl status fprintd`。
- **录入中断**：重新运行录入命令；部分设备在采集失败后需要再次清理并录入。
- **挂起恢复后识别失败**：重启电脑以重新初始化传感器电源路径。
- **驱动补丁失败**：重新克隆干净的上游 `libfprint`，不要在已经应用过补丁的目录上重复执行。

## 项目结构

```text
libfprint-fpc-10a5-9924/
├── patches/                         # libfprint 补丁
├── scripts/                         # 应用、构建、安装脚本
├── fingerprint-manager.py           # GTK4 管理器
├── electron-app/                    # React/Electron 管理器
├── README.md
└── README.zh-CN.md
```

## 免责声明

这是基于设备通信分析和实际硬件验证的实验性驱动适配。不同固件、内核、Fedora 版本或相似型号可能表现不同。请保留原始系统库和配置的备份，并在升级 `libfprint` 后重新验证指纹录入与验证功能。
