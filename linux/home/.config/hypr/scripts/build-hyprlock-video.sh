#!/usr/bin/env bash
# Build the pinned, unmerged Hyprlock video patch without replacing /usr/bin/hyprlock.
# Usage: build-hyprlock-video.sh /path/to/dhia-gharsallaoui/hyprlock [--diagnostic]
set -euo pipefail

source_repo="${1:?Usage: build-hyprlock-video.sh /path/to/hyprlock [--diagnostic]}"
variant="video"
suffix=""
if [[ $# -eq 2 && "$2" == --diagnostic ]]; then
    variant="video-diagnostic"
    suffix="-diagnostic"
elif [[ $# -ne 1 ]]; then
    printf 'Usage: build-hyprlock-video.sh /path/to/hyprlock [--diagnostic]\n' >&2
    exit 2
fi
revision="5010673f28ddb154fd83ddae7d17fb4c1032ab8c"
target="${XDG_DATA_HOME:-$HOME/.local/share}/hyprlock-video/$revision$suffix"
pkg-config --exists mpv || { echo 'libmpv development files are required' >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$source_repo" archive "$revision" | tar -x -C "$work"
if [[ "$variant" == video-diagnostic ]]; then
    python3 "$(dirname "$0")/patch-hyprlock-diagnostics.py" "$work"
fi
cmake -S "$work" -B "$work/build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DHYPRLOCK_COMMIT="${revision:0:7}-$variant" \
    -DHYPRLOCK_VERSION_COMMIT=private-video-build
# Do not allow an apparently successful build without the video feature.
grep -q -- '-DHYPRLOCK_WITH_MPV' "$work/build/compile_commands.json"
cmake --build "$work/build" --parallel 2
mkdir -p "$target"
install -m 755 "$work/build/hyprlock" "$target/hyprlock.new"
mv "$target/hyprlock.new" "$target/hyprlock"
"$target/hyprlock" --version

# Build a separate parser-only checker. Its main function cannot connect to
# Wayland, initialize authentication, or execute widget commands. Keep the
# actual locker above separate from this checker. Diagnostic builds change only
# rendering instrumentation; normal builds use the unchanged pinned source.
python3 - "$work" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
(root / 'src/main.cpp').write_text('''#include "config/ConfigManager.hpp"
#include "core/AnimationManager.hpp"
#include <iostream>
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    try {
        g_pAnimationManager = makeUnique<CHyprlockAnimationManager>();
        g_pConfigManager = makeUnique<CConfigManager>(argv[1]);
        g_pConfigManager->init();
        std::cout << "CONFIG_OK\\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\\n";
        return 1;
    }
}
''')
p = root / 'src/config/ConfigManager.cpp'
source = p.read_text()
old = 'Log::logger->log(Log::ERR, "Config has errors:\\n{}\\nProceeding ignoring faulty entries", result.getError());'
if source.count(old) != 1:
    raise SystemExit('Parser error target changed; review checker')
p.write_text(source.replace(old, 'throw std::runtime_error(result.getError());'))
PY
cmake --build "$work/build" --parallel 2
install -m 755 "$work/build/hyprlock" "$target/check-config"
printf 'Built private video locker and parser-only checker: %s\nNo locker or idle service was started.\n' "$target"
