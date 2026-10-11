#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
user_home="$(getent passwd "$(id -un)" | cut -d: -f6)"
bin_dir="${user_home}/.local/bin"
desktop_dir="${user_home}/.local/share/applications"
launcher="${bin_dir}/fingerprint-manager"
desktop_file="${desktop_dir}/fingerprint-manager.desktop"

mkdir -p "${bin_dir}" "${desktop_dir}"

printf '%s\n' '#!/usr/bin/env bash' \
  "exec /usr/bin/python3 $(printf '%q' "${project_dir}/fingerprint-manager.py") \"\$@\"" \
  > "${launcher}"
chmod +x "${launcher}"

cat > "${desktop_file}" <<EOF
[Desktop Entry]
Name=指纹管理
Comment=管理 fprintd 指纹
Exec=${launcher}
Icon=preferences-system-privacy
Terminal=false
Type=Application
Categories=Settings;Security;
EOF

echo "已安装启动器：${launcher}"
echo "应用菜单中可搜索“指纹管理”，也可以直接运行：${launcher}"
