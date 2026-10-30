# Private macOS 27 cursors

Hyprland and GTK select `macOS-27` at size 24. The generated theme lives at
`~/.local/share/icons/macOS-27`. It contains both Hyprcursor and Xcursor files.
The Apple artwork is machine-local, not vendored or licensed by this repository.
A fresh machine must build/install it separately; the configuration alone does
not provide these files. Xcursor uses Adwaita for unmapped names.

## Source and build

Source: <https://github.com/GinoXiscatti/MacOS-Cursors-Collection>, commit
`8d141a9111e71735c2b579c98a2ab529d36b1f10`, file
`Mis dumps nativos de MacOS/MacOS 27.cape`.
The upstream author labels this a native dump; its Apple provenance is not
independently verified.

Downloaded copy: `~/Downloads/macOS-27.cape`.
SHA-256: `d501174a05139c3d542a6646b9c62caf79d6ad09eaf8a2fd62bb1efb3b35b3c7`.

Build without installing or selecting anything:

```sh
python3 ~/.config/hypr/scripts/convert-mousecape.py \
  ~/Downloads/macOS-27.cape ~/.local/share/macos-27-cursor/new-build
```

The output directory must not exist. Dependencies: Python 3, Pillow (with
`get_flattened_data`), ImageMagick with HEIC decoding, libXcursor and
`hyprcursor-util` 0.1.2 or newer. No `xcursorgen` is needed: the converter uses
libXcursor to write and read back the Xcursor files without connecting to X11.
These dependencies are already present on the current machine; this command
does not install packages.

Copy the generated `theme_macOS-27` directory to a new
`~/.local/share/icons/macOS-27` only after checking the build. Preserve an
existing installation before replacing it. To select an installed build:

```sh
hyprctl setcursor macOS-27 24
gsettings set org.gnome.desktop.interface cursor-theme macOS-27
gsettings set org.gnome.desktop.interface cursor-size 24
```

The repository's Hyprland Lua/legacy config and GTK 3/4 settings persist the
selection. Edit repository files, not independent home copies. If those configs
are not already linked, use `safe-stow.sh --only-config hypr,gtk-3.0,gtk-4.0`
from the repository root after checking local differences.

## Conversion details and limits

- All 52 entries and 5 animations are retained. Standard Linux names map to
  their Mousecape equivalents. Other entries retain Apple-name aliases.
- Nominal sizes 24, 32, 48 and 64 preserve the relative macOS point dimensions.
  Size 24 is not a strict 24-pixel canvas: Apple's arrow has transparent padding.
- Square transparent padding satisfies Hyprcursor's format. Normalized hotspots
  and rounded pixel coordinates match across both formats.
- Frames keep their source order. Seconds become integer milliseconds (the wait
  cursor's 20.833 ms becomes 21 ms). PNG transparency is preserved; Xcursor pixels
  use premultiplied ARGB.
- The largest decodable image representation is used. Current ImageMagick/libheif
  rejects one representation each for Wait, Counting Up/Down, and Busy. Other
  representations provide all their frames. See `conversion.json` in the build
  directory. Do not disable decoder security limits to work around this.
- Images remain raster artwork, not vectors. Apps can supply custom cursors or
  cache a previous theme; restart affected apps if necessary.

## Validation and rollback

From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-mousecape.test.py
Hyprland --verify-config -c "$PWD/linux/home/.config/hypr/hyprland.lua"
```

The initial installed build is `~/.local/share/macos-27-cursor/build-v4`.
A separate libhyprcursor/libXcursor check compared 612 name/size combinations,
including frame counts, dimensions, hotspots and animation delays. It does not
verify every application's rendering or interaction.

Before activation, the previous configs and GNOME cursor settings were copied to
`~/.local/state/macos-27-cursor/20261030-132650/`. The previous GNOME selection was
`default`, size 24. For an immediate switch back:

```sh
hyprctl setcursor default 24
gsettings set org.gnome.desktop.interface cursor-theme default
gsettings set org.gnome.desktop.interface cursor-size 24
```

For persistent rollback, remove the two cursor-theme environment lines from both
Hyprland configs and the two `gtk-cursor-*` lines from both GTK settings files.
Keep the pre-existing size-24 environment lines. Do not restore whole backup
files over newer unrelated changes. The generated theme can remain installed.
