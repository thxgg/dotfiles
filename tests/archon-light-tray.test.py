"""Offline tray asset tests. Do not launch Archon or use the desktop bus."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import gi

gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf, GLib

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "archon_tray", ROOT / "linux/home/.config/hypr/scripts/archon-light-tray.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ArchonTrayTests(unittest.TestCase):
    def make_icon(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        icon = GdkPixbuf.Pixbuf.new_from_bytes(
            GLib.Bytes.new(bytes([0, 0, 0, 0, 20, 20, 20, 128, 0, 0, 0, 255])),
            GdkPixbuf.Colorspace.RGB, True, 8, 3, 1, 12)
        icon.savev(str(path), "png", [], [])

    def test_recolor_preserves_alpha_and_dimensions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "icon.png"
            self.make_icon(path)
            MODULE.whiten_icon(path)
            icon = GdkPixbuf.Pixbuf.new_from_file(str(path))
            self.assertEqual((icon.get_width(), icon.get_height()), (3, 1))
            self.assertEqual(bytes(icon.get_pixels()), bytes([
                255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255]))

    def test_cache_updates_without_modifying_appimage(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            source = base / "Archon.AppImage"
            source.write_bytes(b"version-one")

            def extract(args, cwd, **kwargs):
                self.assertEqual(args, [str(source), "--appimage-extract"])
                root = Path(cwd) / "squashfs-root"
                root.mkdir()
                (root / "AppRun").write_text("test executable")
                for name in MODULE.ASSETS:
                    self.make_icon(root / "resources/build" / name)

            with patch.object(MODULE.subprocess, "run", side_effect=extract) as run:
                first = MODULE.prepare(source, base / "cache")
                self.assertEqual(MODULE.prepare(source, base / "cache"), first)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(source.read_bytes(), b"version-one")
                source.write_bytes(b"version-two")
                second = MODULE.prepare(source, base / "cache")
                self.assertNotEqual(first, second)
                self.assertTrue(first.is_dir())
                self.assertEqual(run.call_count, 2)

    def test_launch_selects_keyring_and_forwards_arguments(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = home / "cached-app"
            env = {"HOME": tmp, "XDG_CACHE_HOME": str(home / "cache"),
                   "XDG_CURRENT_DESKTOP": "Hyprland", "APPIMAGE": "old-image",
                   "APPDIR": "old-dir", "ARGV0": "old-argv"}
            for args in ([], ["--run-on-startup", "archon://example/path"]):
                with self.subTest(args=args), \
                        patch.dict(MODULE.os.environ, env, clear=True), \
                        patch.object(MODULE.sys, "argv", ["launcher", *args]), \
                        patch.object(MODULE, "prepare", return_value=root) as prepare, \
                        patch.object(MODULE.os, "execve") as execute:
                    MODULE.main()
                    prepare.assert_called_once_with(
                        home / "Applications/Archon.AppImage",
                        home / "cache/archon-light-tray")
                    execute.assert_called_once_with(
                        str(root / "AppRun"),
                        [str(root / "AppRun"), "--password-store=gnome-libsecret", *args],
                        {**{key: value for key, value in env.items()
                            if key not in ("APPIMAGE", "APPDIR", "ARGV0")},
                         "APPDIR": str(root)})

    def test_apprun_directory_lookup_with_keyring_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = home / "cached app"
            root.mkdir()
            # Reproduce the upstream AppRun lookup. Without APPDIR, a flag as
            # the first argument walks past the app root and selects /archon.
            (root / "AppRun").write_text('''#!/bin/bash
set -eu
if [ -z "${APPDIR:-}" ]; then
    path="$(dirname "$(readlink -f "$0")")"
    while [[ "$path" != "" && ! -e "$path/$1" ]]; do
        path=${path%/*}
    done
    APPDIR="$path"
fi
exec "$APPDIR/archon" "$@"
''')
            (root / "archon").write_text('''#!/usr/bin/python3
import json, os, sys
print(json.dumps({"args": sys.argv[1:], "appdir": os.environ["APPDIR"]}))
''')
            for name in ("AppRun", "archon"):
                (root / name).chmod(0o700)
            env = {"HOME": tmp, "PATH": "/usr/bin:/bin"}
            run = subprocess.run

            def execute(path, args, child_env):
                result = run(args, executable=path, env=child_env,
                             check=True, capture_output=True, text=True)
                self.assertEqual(json.loads(result.stdout), {
                    "args": ["--password-store=gnome-libsecret", "archon://example/path"],
                    "appdir": str(root)})

            with patch.dict(os.environ, env, clear=True), \
                    patch.object(MODULE.sys, "argv", ["launcher", "archon://example/path"]), \
                    patch.object(MODULE, "prepare", return_value=root), \
                    patch.object(MODULE.os, "execve", side_effect=execute) as launch:
                MODULE.main()
                launch.assert_called_once()

    def test_prepare_only_does_not_launch(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(MODULE.os.environ, {"HOME": tmp}, clear=True), \
                patch.object(MODULE.sys, "argv", ["launcher", "--prepare-only"]), \
                patch.object(MODULE, "prepare", return_value=Path(tmp)), \
                patch.object(MODULE.os, "execve") as execute, \
                patch("builtins.print") as output:
            self.assertEqual(MODULE.main(), 0)
            execute.assert_not_called()
            output.assert_called_once_with(Path(tmp))

    def test_missing_assets_do_not_publish_partial_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            source = base / "Archon.AppImage"
            source.write_bytes(b"source")
            cache = base / "cache"
            with patch.object(MODULE.subprocess, "run"):
                with self.assertRaises(ValueError):
                    MODULE.prepare(source, cache)
            self.assertEqual([p.name for p in cache.iterdir()], [".lock"])


if __name__ == "__main__":
    unittest.main()
