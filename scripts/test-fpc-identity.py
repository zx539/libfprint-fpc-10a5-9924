#!/usr/bin/env python3
"""Compile real patched FPC callbacks against an existing libfprint build."""
import pathlib
import shlex
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
source = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "libfprint-9924").resolve()
build = source / "build-fpc9924"
subprocess.run(["ninja", "-C", str(build)], check=True)
packages = ["gio-unix-2.0", "gusb", "json-glib-1.0"]
flags = shlex.split(subprocess.check_output(["pkg-config", "--cflags", "--libs", *packages], text=True))
wrappers = ["fpi_device_get_current_action", "fpi_device_get_identify_data",
            "fpi_device_get_verify_data", "fpi_device_get_enroll_data",
            "fpi_device_identify_report", "fpi_device_verify_report",
            "fpi_ssm_mark_completed", "fpi_ssm_mark_failed", "fpi_ssm_next_state",
            "fpi_ssm_jump_to_state"]
with tempfile.TemporaryDirectory(prefix="fpc-identity-test-") as temporary:
    executable = pathlib.Path(temporary) / "fpc-identity"
    command = ["cc", "-g", "-D_GNU_SOURCE",
               f'-DFPC_DRIVER_SOURCE="{source / "libfprint/drivers/fpcmoc/fpc.c"}"']
    for directory in [source, build, source / "libfprint", build / "libfprint",
                      source / "libfprint/nbis/include", source / "libfprint/nbis/libfprint-include"]:
        command.extend(["-I", str(directory)])
    command.extend([str(root / "tests/fpc-identity.c"), "-o", str(executable)])
    command.extend(f"-Wl,--wrap={name}" for name in wrappers)
    command.extend([str(build / "libfprint/libfprint-private.a"),
                    str(build / "libfprint/libnbis.a"),
                    str(build / "libfprint/libfprint-2.so"),
                    f"-Wl,-rpath,{build / 'libfprint'}", *flags, "-lm"])
    subprocess.run(command, check=True)
    subprocess.run([str(executable), *sys.argv[2:]], check=True)
