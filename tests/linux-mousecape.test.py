#!/usr/bin/env python3
"""Offline converter checks. Does not access the desktop or install a theme."""
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("converter", ROOT / "linux/home/.config/hypr/scripts/convert-mousecape.py")
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class ConverterTests(unittest.TestCase):
    def test_render_preserves_geometry_and_transparency(self):
        shape = dict(PointsWide=28, PointsHigh=40, HotSpotX=4.5, HotSpotY=4)
        im, x, y = converter.render_frame(Image.new("RGBA", (56, 80), (255, 0, 0, 128)), shape, 24)
        self.assertEqual((im.size, x, y), ((40, 40), 5, 4))
        self.assertEqual(im.getpixel((0, 0)), (255, 0, 0, 128))
        self.assertEqual(im.getpixel((39, 39)), (0, 0, 0, 0))

    def test_size_36_matches_hyprcursor_float_rounding(self):
        shape = dict(PointsWide=16, PointsHigh=21, HotSpotX=11, HotSpotY=3)
        im, x, y = converter.render_frame(Image.new("RGBA", (32, 42), "white"), shape, 36)
        self.assertEqual((im.size, x, y), ((31, 31), 16, 4))
        self.assertIn(36, converter.SIZES)

    def test_tiny_cursors_are_padded_not_enlarged(self):
        shape = dict(PointsWide=4, PointsHigh=4, HotSpotX=1, HotSpotY=1)
        im, x, y = converter.render_frame(Image.new("RGBA", (4, 4), "white"), shape, 24)
        self.assertEqual((im.size, im.getbbox(), x, y), ((12, 12), (0, 0, 4, 4), 1, 1))

    def test_stacked_animation_order(self):
        strip = Image.new("RGBA", (2, 4), "red")
        strip.paste(Image.new("RGBA", (2, 2), "blue"), (0, 2))
        data = io.BytesIO()
        strip.save(data, format="PNG")
        shape = dict(FrameCount=2, PointsWide=2, PointsHigh=2, HotSpotX=0, HotSpotY=0,
                     Representations=[b"input"])
        with patch.object(converter.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=data.getvalue())):
            frames, warnings = converter.decode_shape(shape)
        self.assertEqual(warnings, [])
        self.assertEqual([im.getpixel((0, 0)) for im in frames], [(255, 0, 0, 255), (0, 0, 255, 255)])

    def test_premultiplied_argb(self):
        self.assertEqual(converter.argb((255, 128, 0, 128)), 0x80804000)
        self.assertEqual(converter.argb((255, 255, 255, 0)), 0)

    def test_real_xcursor_round_trip(self):
        lib = converter.xcursor_library()
        with tempfile.TemporaryDirectory() as tmp:
            frames = [(24, Image.new("RGBA", (24, 24), color), 3, 4, 21)
                      for color in [(255, 128, 0, 128), (0, 0, 255, 255)]]
            converter.save_xcursor(lib, Path(tmp) / "wait", frames)

    def test_aliases_are_unique(self):
        aliases = [alias for names in converter.ALIASES.values() for alias in names]
        self.assertEqual(len(aliases), len(set(aliases)))
        self.assertIn("pointer", converter.ALIASES["com.apple.cursor.13"])

    def test_existing_output_is_not_overwritten(self):
        import plistlib
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.cape"
            source.write_bytes(plistlib.dumps({}))
            with self.assertRaises(FileExistsError):
                converter.build(source, Path(tmp))


if __name__ == "__main__":
    unittest.main()
