#!/usr/bin/env python3
"""Build a private Hyprcursor/Xcursor theme. Does not install or select it."""
import argparse
import ctypes as C
import hashlib
import io
import json
import math
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess

from PIL import Image

# Mousecape MCDefs.m names; keep all other shapes under their Apple identifiers.
ALIASES = {
    "com.apple.coregraphics.Arrow": ["left_ptr", "default", "arrow", "top_left_arrow"],
    "com.apple.coregraphics.Empty": ["none"],
    "com.apple.coregraphics.IBeam": ["text", "xterm", "ibeam"],
    "com.apple.coregraphics.Wait": ["wait", "watch"],
    "com.apple.cursor.2": ["alias", "link", "dnd-link"],
    "com.apple.cursor.3": ["not-allowed", "forbidden", "no-drop", "crossed_circle", "dnd-none"],
    "com.apple.cursor.4": ["progress", "left_ptr_watch", "half-busy"],
    "com.apple.cursor.5": ["copy", "dnd-copy"],
    "com.apple.cursor.7": ["crosshair", "cross", "tcross"],
    "com.apple.cursor.11": ["grabbing", "closedhand", "dnd-move"],
    "com.apple.cursor.12": ["grab", "openhand", "hand1"],
    "com.apple.cursor.13": ["pointer", "hand2", "pointing_hand"],
    "com.apple.cursor.17": ["w-resize", "left_side"],
    "com.apple.cursor.18": ["e-resize", "right_side"],
    "com.apple.cursor.19": ["col-resize", "split_h"],
    "com.apple.cursor.21": ["n-resize", "top_side"],
    "com.apple.cursor.22": ["s-resize", "bottom_side"],
    "com.apple.cursor.23": ["row-resize", "split_v"],
    "com.apple.cursor.24": ["context-menu"],
    "com.apple.cursor.26": ["vertical-text"],
    "com.apple.cursor.28": ["ew-resize", "sb_h_double_arrow", "h_double_arrow", "size_hor"],
    "com.apple.cursor.29": ["ne-resize", "top_right_corner"],
    "com.apple.cursor.30": ["nesw-resize", "fd_double_arrow", "size_bdiag"],
    "com.apple.cursor.32": ["ns-resize", "sb_v_double_arrow", "v_double_arrow", "size_ver"],
    "com.apple.cursor.33": ["nw-resize", "top_left_corner"],
    "com.apple.cursor.34": ["nwse-resize", "bd_double_arrow", "size_fdiag"],
    "com.apple.cursor.35": ["se-resize", "bottom_right_corner"],
    "com.apple.cursor.37": ["sw-resize", "bottom_left_corner"],
    "com.apple.cursor.39": ["move", "all-scroll", "fleur", "size_all"],
    "com.apple.cursor.40": ["help", "question_arrow", "whats_this"],
    "com.apple.cursor.41": ["cell", "plus"],
    "com.apple.cursor.42": ["zoom-in"],
    "com.apple.cursor.43": ["zoom-out"],
}
SIZES = (24, 32, 36, 48, 64)


class XImage(C.Structure):
    _fields_ = [(name, C.c_uint32) for name in
                ("version", "size", "width", "height", "xhot", "yhot", "delay")] + [
                    ("pixels", C.POINTER(C.c_uint32))]


class XImages(C.Structure):
    _fields_ = [("nimage", C.c_int), ("images", C.POINTER(C.POINTER(XImage))),
                ("name", C.c_char_p)]


def xcursor_library():
    lib = C.CDLL("libXcursor.so.1")
    for name, args, result in [
        ("XcursorImageCreate", [C.c_int, C.c_int], C.POINTER(XImage)),
        ("XcursorImagesCreate", [C.c_int], C.POINTER(XImages)),
        ("XcursorImagesDestroy", [C.POINTER(XImages)], None),
        ("XcursorFilenameSaveImages", [C.c_char_p, C.POINTER(XImages)], C.c_int),
        ("XcursorFilenameLoadAllImages", [C.c_char_p], C.POINTER(XImages)),
    ]:
        fn = getattr(lib, name)
        fn.argtypes, fn.restype = args, result
    return lib


def rounded(value):
    return math.floor(value + 0.5)


def float32(value):
    """Match libhyprcursor's single-precision geometry calculations."""
    return struct.unpack("f", struct.pack("f", value))[0]


def argb(pixel):
    r, g, b, a = pixel
    # Xcursor requires premultiplied ARGB, unlike PNG's straight RGBA.
    return (a << 24) | (((r * a + 127) // 255) << 16) | (((g * a + 127) // 255) << 8) | ((b * a + 127) // 255)


def save_xcursor(lib, path, frames):
    images = lib.XcursorImagesCreate(len(frames))
    if not images:
        raise MemoryError("XcursorImagesCreate")
    try:
        for size, im, x, y, delay in frames:
            p = lib.XcursorImageCreate(im.width, im.height)
            if not p:
                raise MemoryError("XcursorImageCreate")
            images.contents.images[images.contents.nimage] = p
            images.contents.nimage += 1
            p.contents.size, p.contents.xhot, p.contents.yhot, p.contents.delay = size, x, y, delay
            pixels = [argb(pixel) for pixel in im.get_flattened_data()]
            buf = (C.c_uint32 * len(pixels))(*pixels)
            C.memmove(p.contents.pixels, buf, C.sizeof(buf))
        if not lib.XcursorFilenameSaveImages(bytes(path), images):
            raise RuntimeError(f"Cannot write {path}")
    finally:
        lib.XcursorImagesDestroy(images)
    # Check the serialized file through the system reader, without a display.
    loaded = lib.XcursorFilenameLoadAllImages(bytes(path))
    if not loaded:
        raise RuntimeError(f"Cannot read {path}")
    try:
        assert loaded.contents.nimage == len(frames)
        for i, (size, im, x, y, delay) in enumerate(frames):
            p = loaded.contents.images[i].contents
            assert (p.size, p.width, p.height, p.xhot, p.yhot, p.delay) == (size, im.width, im.height, x, y, delay)
            assert p.pixels[0] == argb(im.getpixel((0, 0)))
    finally:
        lib.XcursorImagesDestroy(loaded)


def decode_shape(shape):
    count = int(shape["FrameCount"])
    w, h = float(shape["PointsWide"]), float(shape["PointsHigh"])
    x, y = float(shape["HotSpotX"]), float(shape["HotSpotY"])
    if not (1 <= count <= 256 and 0 < w <= 512 and 0 < h <= 512 and 0 <= x < w and 0 <= y < h):
        raise ValueError("Invalid cursor geometry")
    candidates, warnings = [], []
    for i, blob in enumerate(shape["Representations"]):
        decoded = subprocess.run(["magick", "-", "png:-"], input=blob, capture_output=True, timeout=60)
        if decoded.returncode:
            warnings.append(f"representation {i}: {decoded.stderr.decode(errors='replace').strip()}")
            continue
        im = Image.open(io.BytesIO(decoded.stdout)).convert("RGBA")
        if im.height % count or abs(im.width / w - im.height / count / h) > 0.05:
            warnings.append(f"representation {i}: unexpected dimensions {im.size}")
            continue
        candidates.append(im)
    if not candidates:
        raise ValueError("No decodable representations: " + str(warnings))
    im = max(candidates, key=lambda image: image.width)
    frame_height = im.height // count
    frames = [im.crop((0, i * frame_height, im.width, (i + 1) * frame_height)) for i in range(count)]
    return frames, warnings


def render_frame(frame, shape, size):
    # At nominal size 24, preserve Apple's point dimensions and relative sizes.
    scale = size / 24
    # Hyprcursor clamps nominal_size at 2; pad tiny shapes without enlarging them.
    base_side = max(12, shape["PointsWide"], shape["PointsHigh"])
    nominal = float32(float(f"{24 / base_side:.10f}"))
    side = rounded(float32(size / nominal))
    dims = (rounded(shape["PointsWide"] * scale), rounded(shape["PointsHigh"] * scale))
    im = frame.resize(dims, Image.Resampling.LANCZOS)
    square = Image.new("RGBA", (side, side))
    # A float-rounded canvas can differ by one pixel from the ideal dimensions.
    if im.width > side or im.height > side:
        im = im.resize((min(im.width, side), min(im.height, side)), Image.Resampling.LANCZOS)
    square.paste(im, (0, 0))
    def hotspot(key):
        fraction = float32(float(f"{shape[key] / base_side:.10f}"))
        return rounded(float32(fraction * side))
    return square, hotspot("HotSpotX"), hotspot("HotSpotY")


def build(source, output):
    data = source.read_bytes()
    cape = plistlib.loads(data)
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    lib = xcursor_library()
    output.mkdir(parents=True)
    working = output / "working"
    working.mkdir()
    manifest = "name = macOS-27\ndescription = Private conversion of Gino Xiscatti's macOS 27 dump\nversion = 1\ncursors_directory = hyprcursors\n"
    (working / "manifest.hl").write_text(manifest)
    xdir = output / "xcursors"
    xdir.mkdir()
    report = {"source_sha256": hashlib.sha256(data).hexdigest(), "sizes": SIZES, "shapes": {}}
    for key, shape in cape["Cursors"].items():
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", key):
            raise ValueError(f"Unsafe cursor name: {key}")
        aliases = ALIASES.get(key, [])
        # hyprcursor-util uses path.stem(), so directory names cannot contain dots.
        name = aliases[0] if aliases else key.replace(".", "-")
        folder = working / "hyprcursors" / name
        folder.mkdir(parents=True)
        frames, warnings = decode_shape(shape)
        side = max(12, shape["PointsWide"], shape["PointsHigh"])
        delay = max(1, rounded(shape["FrameDuration"] * 1000)) if len(frames) > 1 else 0
        meta = ["resize_algorithm = bilinear", f"nominal_size = {24 / side:.10f}",
                f"hotspot_x = {shape['HotSpotX'] / side:.10f}", f"hotspot_y = {shape['HotSpotY'] / side:.10f}"]
        meta += [f"define_override = {alias}" for alias in [key, *aliases[1:]] if alias != name]
        xframes = []
        for size in SIZES:
            for i, frame in enumerate(frames):
                im, x, y = render_frame(frame, shape, size)
                filename = f"{size}-{i}.png"
                im.save(folder / filename)
                meta.append(f"define_size = {im.width}, {filename}, {max(1, delay)}")
                xframes.append((size, im, x, y, delay))
        (folder / "meta.hl").write_text("\n".join(meta) + "\n")
        save_xcursor(lib, xdir / name, xframes)
        for alias in [key, *aliases[1:]]:
            if alias != name:
                (xdir / alias).symlink_to(name)
        report["shapes"][key] = {"name": name, "aliases": aliases, "frames": len(frames), "delay_ms": delay, "warnings": warnings}
    subprocess.run(["hyprcursor-util", "--create", str(working), "--output", str(output)], check=True)
    theme = output / "theme_macOS-27"
    shutil.move(xdir, theme / "cursors")
    (theme / "index.theme").write_text("[Icon Theme]\nName=macOS-27\nComment=Private macOS 27 cursor conversion\nInherits=Adwaita\n")
    (output / "conversion.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Built and verified {len(report['shapes'])} shapes: {theme}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path, help="New build directory; must not exist")
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve())
