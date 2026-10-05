"""Offline tray asset tests. Do not launch Archon or use the desktop bus."""
import importlib.util
from pathlib import Path
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
