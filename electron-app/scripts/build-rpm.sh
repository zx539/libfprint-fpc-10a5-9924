#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="${project_dir}/release"
app_dir="${release_dir}/linux-unpacked"
rpm_top="${release_dir}/rpmbuild"
stage_root="${release_dir}/rpm-stage"
version="$(node -p "require('${project_dir}/package.json').version")"
package_name="fedora-fingerprint-manager"
stage_dir="${stage_root}/${package_name}-${version}"

cd "${project_dir}"

if [[ "$(uname -m)" != "x86_64" ]]; then
	echo "error: this RPM script currently targets x86_64 (found $(uname -m))" >&2
	exit 1
fi
if ! command -v rpmbuild >/dev/null 2>&1; then
	echo "error: install rpm-build first: sudo dnf install -y rpm-build" >&2
	exit 1
fi
if [[ ! -x node_modules/.bin/electron-builder ]]; then
	echo "error: electron-builder is missing; run npm install first" >&2
	exit 1
fi

npm run build
./node_modules/.bin/electron-builder --linux dir --x64

if [[ ! -x "${app_dir}/fedora-fingerprint-manager" ]]; then
	echo "error: Electron directory build did not produce ${app_dir}/fedora-fingerprint-manager" >&2
	exit 1
fi

rm -rf "${rpm_top}" "${stage_root}"
mkdir -p "${rpm_top}/BUILD" "${rpm_top}/BUILDROOT" "${rpm_top}/RPMS" "${rpm_top}/SOURCES" "${rpm_top}/SPECS" "${rpm_top}/SRPMS" "${rpm_top}/tmp"
mkdir -p "${stage_dir}"

cp -a "${app_dir}/." "${stage_dir}/"
tar -C "${stage_root}" -czf "${rpm_top}/SOURCES/${package_name}-${version}.tar.gz" "${package_name}-${version}"

cat > "${rpm_top}/SOURCES/${package_name}.desktop" <<EOF
[Desktop Entry]
Name=Fedora Fingerprint Manager
Name[zh_CN]=Fedora 指纹管理器
Comment=Manage fprintd fingerprints on Fedora
Comment[zh_CN]=管理 Fedora 指纹
Exec=/usr/bin/fedora-fingerprint-manager
Icon=preferences-system-privacy
Terminal=false
Type=Application
Categories=System;Settings;Security;
StartupWMClass=fedora-fingerprint-manager
EOF

cat > "${rpm_top}/SPECS/${package_name}.spec" <<EOF
%global debug_package %{nil}

Name:           ${package_name}
Version:        ${version}
Release:        1%{?dist}
Summary:        GNOME-style Fedora fingerprint manager
License:        GPL-3.0-or-later
URL:            https://github.com/Terrydaktal/libfprint-fpc-10a5-9924
Source0:        %{name}-%{version}.tar.gz
Source1:        %{name}.desktop
BuildArch:      x86_64
Requires:       fprintd
Requires:       polkit
Requires:       usbutils

%description
Electron and React based fingerprint manager for Fedora using fprintd and libfprint.

%prep
%setup -q

%build

%install
install -d %{buildroot}/opt/${package_name}
cp -a . %{buildroot}/opt/${package_name}/
install -d %{buildroot}/usr/bin
ln -s /opt/${package_name}/fedora-fingerprint-manager %{buildroot}/usr/bin/fedora-fingerprint-manager
install -d %{buildroot}/usr/share/applications
install -m 0644 %{SOURCE1} %{buildroot}/usr/share/applications/${package_name}.desktop

%files
%defattr(-,root,root,-)
/opt/${package_name}/
/usr/bin/fedora-fingerprint-manager
/usr/share/applications/${package_name}.desktop

%post
update-desktop-database -q %{_datadir}/applications >/dev/null 2>&1 || :

%postun
update-desktop-database -q %{_datadir}/applications >/dev/null 2>&1 || :

%changelog
* $(date '+%a %b %d %Y') Fedora Fingerprint Manager contributors <maintainers@invalid.example> - ${version}-1
- Initial Fedora RPM package
EOF

rpmbuild --define "_topdir ${rpm_top}" --define "_tmppath ${rpm_top}/tmp" --define "_builddir ${rpm_top}/BUILD" --define "_rpmdir ${rpm_top}/RPMS" --define "_srcrpmdir ${rpm_top}/SRPMS" -bb "${rpm_top}/SPECS/${package_name}.spec"

artifact="$(find "${rpm_top}/RPMS" -type f -name '*.rpm' -print -quit)"
if [[ -z "${artifact}" ]]; then
	echo "error: rpmbuild did not produce an RPM" >&2
	exit 1
fi
cp -f "${artifact}" "${release_dir}/"
echo "RPM created: ${release_dir}/$(basename "${artifact}")"
