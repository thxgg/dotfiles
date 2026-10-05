#!/usr/bin/env python3
"""Launch a cached Archon copy with white tray assets. Keep the AppImage intact."""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ASSETS = ("archonTrayTemplate.png", "archonTrayTemplate@2x.png")
PATCH_VERSION = "white-tray-v1"


def whiten_icon(path):
    import gi
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf, GLib

    source = GdkPixbuf.Pixbuf.new_from_file(str(path))
    if not source.get_has_alpha() or source.get_n_channels() != 4:
        raise ValueError(f"Expected an RGBA tray image: {path}")
    width, height = source.get_width(), source.get_height()
    pixels = source.get_pixels()
    stride = source.get_rowstride()
    output = bytearray()
    for y in range(height):
        for x in range(width):
            output.extend((255, 255, 255, pixels[y * stride + x * 4 + 3]))
    icon = GdkPixbuf.Pixbuf.new_from_bytes(
        GLib.Bytes.new(bytes(output)), GdkPixbuf.Colorspace.RGB,
        True, 8, width, height, width * 4)
    icon.savev(str(path), "png", [], [])


def prepare(appimage, cache):
    # Serialize extraction across simultaneous desktop/tray launches.
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (cache / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with appimage.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        target = cache / f"{PATCH_VERSION}-{digest}"
        if not target.exists():
            with tempfile.TemporaryDirectory(prefix=".prepare-", dir=cache) as tmp:
                subprocess.run([str(appimage), "--appimage-extract"],
                               cwd=tmp, check=True, stdout=subprocess.DEVNULL)
                root = Path(tmp) / "squashfs-root"
                if not (root / "AppRun").is_file():
                    raise ValueError("Archon AppImage has no AppRun executable")
                for name in ASSETS:
                    whiten_icon(root / "resources/build" / name)
                # Reject an update that replaced the source during extraction.
                with appimage.open("rb") as source:
                    if hashlib.file_digest(source, "sha256").hexdigest() != digest:
                        raise RuntimeError("Archon AppImage changed; launch again")
                root.rename(target)
        return target


def main():
    appimage = Path.home() / "Applications/Archon.AppImage"
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "archon-light-tray"
    try:
        root = prepare(appimage, cache)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Archon light tray: {error}", file=sys.stderr)
        return 1
    if sys.argv[1:] == ["--prepare-only"]:
        print(root)
        return 0
    # An extracted copy has no AppImage updater. Replace the original AppImage
    # to update; its new checksum creates a fresh patched copy on next launch.
    env = os.environ.copy()
    for name in ("APPIMAGE", "APPDIR", "ARGV0"):
        env.pop(name, None)
    os.execve(str(root / "AppRun"), [str(root / "AppRun"), *sys.argv[1:]], env)


if __name__ == "__main__":
    sys.exit(main())
