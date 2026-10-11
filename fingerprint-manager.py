#!/usr/bin/env python3
"""Small GTK4 frontend for the fprintd command line tools."""

import getpass
import math
import os
import re
import subprocess
import threading
from dataclasses import dataclass

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, GLib, Gtk


@dataclass(frozen=True)
class Finger:
    label: str
    fprintd_name: str


FINGERS = (
    Finger("左手拇指", "left-thumb"),
    Finger("左手食指", "left-index-finger"),
    Finger("左手中指", "left-middle-finger"),
    Finger("左手无名指", "left-ring-finger"),
    Finger("左手小指", "left-little-finger"),
    Finger("右手拇指", "right-thumb"),
    Finger("右手食指", "right-index-finger"),
    Finger("右手中指", "right-middle-finger"),
    Finger("右手无名指", "right-ring-finger"),
    Finger("右手小指", "right-little-finger"),
)


class FingerprintAnimation(Gtk.DrawingArea):
    """A small animated fingerprint scanner drawn without external assets."""

    def __init__(self):
        super().__init__()
        self.set_content_width(190)
        self.set_content_height(170)
        self.set_hexpand(True)
        self.set_draw_func(self._draw)
        self.phase = 0.0
        self.active = False
        self.mode = "idle"
        self.timer_id = None

    def start(self, mode):
        self.mode = mode
        self.active = True
        if self.timer_id is None:
            self.timer_id = GLib.timeout_add(40, self._tick)
        self.queue_draw()

    def stop(self):
        self.active = False
        self.mode = "idle"
        self.queue_draw()

    def _tick(self):
        if not self.active:
            self.timer_id = None
            return GLib.SOURCE_REMOVE
        self.phase = (self.phase + 0.12) % (math.pi * 2)
        self.queue_draw()
        return GLib.SOURCE_CONTINUE

    def _draw(self, _area, cr, width, height):
        center_x = width / 2
        center_y = height / 2 + 8
        accent = (0.30, 0.78, 0.95) if self.mode == "verify" else (0.42, 0.86, 0.56)

        cr.set_line_cap(1)
        cr.set_line_join(1)
        for index in range(6):
            radius = 17 + index * 12
            glow = 0.30 + 0.32 * ((math.sin(self.phase - index * 0.42) + 1) / 2) if self.active else 0.75
            cr.set_source_rgba(accent[0], accent[1], accent[2], glow)
            cr.set_line_width(3.0 if index < 2 else 2.2)
            cr.save()
            cr.translate(center_x, center_y)
            cr.scale(1.0, 0.86)
            cr.arc(0, 0, radius, math.radians(205), math.radians(335))
            cr.stroke()
            cr.restore()

        # Two curved sides make the drawing read as a fingerprint rather than rings.
        cr.set_source_rgba(accent[0], accent[1], accent[2], 0.72 if self.active else 0.58)
        cr.set_line_width(2.4)
        for side in (-1, 1):
            cr.move_to(center_x + side * 58, center_y + 38)
            cr.curve_to(
                center_x + side * 76,
                center_y - 12,
                center_x + side * 45,
                center_y - 60,
                center_x,
                center_y - 72,
            )
            cr.stroke()

        if self.active:
            scan_y = center_y - 57 + ((math.sin(self.phase * 0.7) + 1) / 2) * 92
            cr.set_source_rgba(0.92, 0.98, 1.0, 0.85)
            cr.set_line_width(2.0)
            cr.move_to(center_x - 64, scan_y)
            cr.line_to(center_x + 64, scan_y)
            cr.stroke()


class FingerprintManager(Gtk.Application):
    def __init__(self):
        super().__init__(
            application_id="com.terrydaktal.FingerprintManager",
            flags=0,
        )
        self.window = None
        self.busy = False
        self.rows = {}
        self.user = getpass.getuser()

    def do_activate(self):
        if self.window is None:
            self._build_window()
        self.window.present()
        self._start_operation("refresh", [])

    def _build_window(self):
        self._install_css()
        self.window = Gtk.ApplicationWindow(application=self)
        self.window.set_title("指纹管理")
        self.window.set_default_size(720, 760)

        header = Gtk.HeaderBar()
        header.set_show_title_buttons(True)
        header_title = Gtk.Label(label="指纹管理")
        header_title.add_css_class("title-3")
        header.set_title_widget(header_title)
        self.window.set_titlebar(header)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        outer.set_margin_top(18)
        outer.set_margin_bottom(18)
        outer.set_margin_start(18)
        outer.set_margin_end(18)
        self.window.set_child(outer)

        hero = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=18)
        hero.add_css_class("hero-card")
        hero.set_margin_bottom(2)
        outer.append(hero)

        self.animation = FingerprintAnimation()
        hero.append(self.animation)

        hero_text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=7)
        hero_text.set_valign(Gtk.Align.CENTER)
        hero.append(hero_text)
        self.activity_title = Gtk.Label(label="指纹已就绪")
        self.activity_title.set_halign(Gtk.Align.START)
        self.activity_title.add_css_class("title-2")
        hero_text.append(self.activity_title)
        self.activity_detail = Gtk.Label(label=f"当前用户：{self.user}\n选择手指后即可开始管理")
        self.activity_detail.set_halign(Gtk.Align.START)
        self.activity_detail.set_wrap(True)
        self.activity_detail.add_css_class("dim-label")
        hero_text.append(self.activity_detail)

        self.status = Gtk.Label(label="正在读取指纹列表…")
        self.status.set_halign(Gtk.Align.START)
        self.status.set_wrap(True)
        outer.append(self.status)

        list_frame = Gtk.Frame(label="已录入的手指")
        list_frame.add_css_class("content-card")
        list_frame.set_vexpand(True)
        outer.append(list_frame)

        self.finger_list = Gtk.ListBox()
        self.finger_list.set_selection_mode(Gtk.SelectionMode.NONE)
        list_frame.set_child(self.finger_list)
        self._build_finger_rows()

        controls = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        controls.add_css_class("content-card")
        outer.append(controls)

        self.finger_model = Gtk.StringList.new([finger.label for finger in FINGERS])
        self.finger_dropdown = Gtk.DropDown.new(self.finger_model, None)
        self.finger_dropdown.set_hexpand(True)
        controls.append(self.finger_dropdown)

        self.refresh_button = Gtk.Button(label="刷新")
        self.refresh_button.connect("clicked", lambda _button: self._start_operation("refresh", []))
        controls.append(self.refresh_button)

        self.enroll_button = Gtk.Button(label="录入")
        self.enroll_button.add_css_class("suggested-action")
        self.enroll_button.connect("clicked", self._on_enroll)
        controls.append(self.enroll_button)

        self.verify_button = Gtk.Button(label="验证")
        self.verify_button.connect("clicked", self._on_verify)
        controls.append(self.verify_button)

        self.delete_button = Gtk.Button(label="删除")
        self.delete_button.add_css_class("destructive-action")
        self.delete_button.connect("clicked", self._on_delete)
        controls.append(self.delete_button)

        output_frame = Gtk.Frame(label="操作信息")
        output_frame.add_css_class("content-card")
        output_frame.set_size_request(-1, 150)
        outer.append(output_frame)
        self.output = Gtk.TextView()
        self.output.set_editable(False)
        self.output.set_monospace(True)
        self.output.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        output_frame.set_child(self.output)

    def _install_css(self):
        provider = Gtk.CssProvider()
        provider.load_from_data(
            b"""
            .hero-card {
                border-radius: 18px;
                padding: 12px 18px;
                background: alpha(@accent_bg_color, 0.16);
            }
            .content-card {
                border-radius: 12px;
                padding: 8px;
            }
            .title-2 { font-weight: 700; }
            .title-3 { font-weight: 700; }
            .success { color: @success_color; font-weight: 700; }
            button { min-height: 34px; }
            """
        )
        display = Gdk.Display.get_default()
        if display is not None:
            Gtk.StyleContext.add_provider_for_display(
                display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            )

    def _build_finger_rows(self):
        for finger in FINGERS:
            row = Gtk.ListBoxRow()
            box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            box.set_margin_top(8)
            box.set_margin_bottom(8)
            box.set_margin_start(10)
            box.set_margin_end(10)
            label = Gtk.Label(label=finger.label)
            label.set_halign(Gtk.Align.START)
            label.set_hexpand(True)
            box.append(label)
            state = Gtk.Label(label="未录入")
            state.set_halign(Gtk.Align.END)
            state.add_css_class("dim-label")
            box.append(state)
            row.set_child(box)
            self.finger_list.append(row)
            self.rows[finger.fprintd_name] = state

    def _selected_finger(self):
        index = self.finger_dropdown.get_selected()
        return FINGERS[index]

    def _on_enroll(self, _button):
        finger = self._selected_finger()
        self._start_operation("enroll", ["-f", finger.fprintd_name, self.user])

    def _on_verify(self, _button):
        finger = self._selected_finger()
        self._start_operation("verify", ["-f", finger.fprintd_name, self.user])

    def _on_delete(self, _button):
        finger = self._selected_finger()
        self._confirm_delete(finger)

    def _confirm_delete(self, finger):
        dialog = Gtk.Window(title="确认删除", transient_for=self.window, modal=True)
        dialog.set_default_size(360, 140)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        box.set_margin_top(18)
        box.set_margin_bottom(18)
        box.set_margin_start(18)
        box.set_margin_end(18)
        dialog.set_child(box)
        message = Gtk.Label(label=f"确定删除“{finger.label}”的指纹吗？")
        message.set_wrap(True)
        box.append(message)
        buttons = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        buttons.set_halign(Gtk.Align.END)
        box.append(buttons)
        cancel = Gtk.Button(label="取消")
        cancel.connect("clicked", lambda _button: dialog.close())
        buttons.append(cancel)
        confirm = Gtk.Button(label="删除")
        confirm.add_css_class("destructive-action")
        confirm.connect(
            "clicked",
            lambda _button: (dialog.close(), self._start_operation("delete", [self.user, "-f", finger.fprintd_name])),
        )
        buttons.append(confirm)
        dialog.present()

    def _set_controls_enabled(self, enabled):
        for button in (self.refresh_button, self.enroll_button, self.verify_button, self.delete_button):
            button.set_sensitive(enabled)
        self.finger_dropdown.set_sensitive(enabled)

    def _start_operation(self, operation, args):
        if self.busy:
            return
        self.busy = True
        self._set_controls_enabled(False)
        labels = {"refresh": "正在刷新…", "enroll": "请按提示触摸指纹传感器…", "verify": "请触摸指纹传感器…", "delete": "正在删除…"}
        self.status.set_label(labels[operation])
        if operation == "enroll":
            self.activity_title.set_label("正在录入指纹")
            self.activity_detail.set_label(f"请反复抬起并按下：{self._selected_finger().label}")
            self.animation.start("enroll")
        elif operation == "verify":
            self.activity_title.set_label("正在验证指纹")
            self.activity_detail.set_label(f"请触摸：{self._selected_finger().label}")
            self.animation.start("verify")
        elif operation == "delete":
            self.activity_title.set_label("正在删除指纹")
            self.activity_detail.set_label("请稍候，正在更新设备模板")
            self.animation.stop()
        else:
            self.activity_title.set_label("指纹已就绪")
            self.activity_detail.set_label(f"当前用户：{self.user}\n选择手指后即可开始管理")
            self.animation.stop()
        if operation != "refresh":
            self._set_output("")

        if operation == "refresh":
            command = "fprintd-list"
            args = [self.user]
        else:
            command = f"fprintd-{operation}"
        thread = threading.Thread(target=self._run_operation, args=(operation, command, args), daemon=True)
        thread.start()

    def _run_operation(self, operation, command, args):
        environment = os.environ.copy()
        environment["LC_ALL"] = "C"
        environment["LANG"] = "C"
        try:
            result = subprocess.run(
                [command, *args],
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=180,
                check=False,
            )
            output = result.stdout.strip()
            code = result.returncode
        except FileNotFoundError:
            output = f"找不到 {command}，请安装 fprintd。"
            code = 127
        except subprocess.TimeoutExpired:
            output = "操作超时。请检查传感器状态后重试。"
            code = 124
        except OSError as error:
            output = str(error)
            code = 1
        GLib.idle_add(self._finish_operation, operation, code, output)

    def _finish_operation(self, operation, code, output):
        self.busy = False
        self._set_controls_enabled(True)
        self._set_output(output or ("操作成功。" if code == 0 else "操作失败。"))
        self.animation.stop()
        if operation == "refresh" and code == 0:
            self._finish_refresh(output)
        if code == 0:
            self.status.set_label("操作完成")
            self.activity_title.set_label("操作完成")
            self.activity_detail.set_label("指纹库已更新，可以继续选择其他操作")
            if operation != "refresh":
                self._start_operation("refresh", [])
        else:
            self.status.set_label(f"操作失败（退出码 {code}）")
        return GLib.SOURCE_REMOVE

    def _finish_refresh(self, output):
        for finger in FINGERS:
            enrolled = re.search(rf"(?<![\w-]){re.escape(finger.fprintd_name)}(?![\w-])", output, re.IGNORECASE)
            state = self.rows[finger.fprintd_name]
            state.set_label("已录入" if enrolled else "未录入")
            state.remove_css_class("success")
            state.remove_css_class("dim-label")
            state.add_css_class("success" if enrolled else "dim-label")

    def _set_output(self, text):
        buffer = self.output.get_buffer()
        buffer.set_text(text)


def main():
    app = FingerprintManager()
    return app.run(None)


if __name__ == "__main__":
    raise SystemExit(main())
