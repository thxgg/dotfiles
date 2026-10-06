# Locking and idle policy

## Status and safety

This setup is staged for manual testing. The idle service will not start until
`~/.local/state/hypr-lock/idle-enabled` exists. Only the explicit `enable-idle`
action creates that marker. Neither deployment nor the build creates it.
There is no manual lock keybinding. Do not enable idle handling during active
work until the live lock/unlock and recovery checks below are complete.

- Lock after 900 seconds without input.
- Turn displays off after 1800 seconds without input; input turns them on again.
- Never suspend automatically.
- Respect Wayland, D-Bus, and systemd idle inhibitors, including video players.
- WoW's exact initial window title inhibits idle **always**, including on other
  workspaces. Battle.net and other Wine apps do not match. Leaving WoW open can
  therefore prevent automatic locking indefinitely.
- Manual lock and suspend actions do not honor idle inhibitors.
- Password authentication is immediate: no grace period or fingerprint unlock.
- HyprPanel's dashboard Lock action occupies its former default Spotify shortcut.
  The existing app, screenshot, recording, and settings shortcuts are unchanged.
- Both HyprPanel Sleep paths call `session-control.py suspend`. This waits up to
  20 seconds for Hyprland's actual session-lock state before requesting suspend.
  Failure cancels suspend rather than treating a process PID as proof of a lock.
- Once idle handling is enabled, `inhibit_sleep = 3` waits for session-lock
  notification on other logind suspend paths too. Logind delay inhibitors have a
  finite deadline; they are not an unconditional guarantee against failed lockers.

## Video locker

The experimental build is upstream PR https://github.com/hyprwm/hyprlock/pull/1032,
pinned to `5010673f28ddb154fd83ddae7d17fb4c1032ab8c` in
https://github.com/dhia-gharsallaoui/hyprlock (branch `feat/video-background`).
It is unmerged and is not a supported feature of stock Hyprlock 0.9.6.

Build from a local checkout containing that commit:

```sh
bash ~/.config/hypr/scripts/build-hyprlock-video.sh /path/to/hyprlock
```

The script uses Git, tar, Python 3, CMake, Ninja, a C++23 compiler, libmpv,
and Hyprlock's development dependencies. Package choices belong in
`linux/packages/desktop-hyprland.txt`; this script does not install packages.
It builds with two jobs and installs only private binaries under
`~/.local/share/hyprlock-video/<commit>/`. It does not replace `/usr/bin/hyprlock`,
modify PAM, connect to Wayland, or start any service. The source cache stays clean.

`check-config` is a separate parser-only executable built from the same source.
Its replacement main only parses config. It cannot start authentication, connect
to Wayland, or execute label commands. Parse errors return failure. The actual
video locker uses the unchanged upstream main and parser.

`hyprlock-video.conf` uses a local 60 fps playback copy:

```text
~/Pictures/Wallpapers/Golden_Dark_60fps.mov
```

This is a 4480 × 3088, 10-bit HEVC encode made with libx265 (fast preset,
CRF 18, `fps=60`). It preserves the two-minute duration and motion speed.
The HEVC stream and container retain Display P3 primaries, sRGB transfer, and
BT.709 matrix metadata. The untouched 240 fps original remains at
`~/Pictures/Wallpapers/Golden_Dark_original.mov`.
A VAAPI-encoded candidate decoded poorly on this GPU; the selected libx265 copy
uses wavefront parallel processing and passed the short dual-decoder benchmark.

Playback is muted, looping, and explicitly uses software decoding
(`video_hwdec = no`). On this machine, `auto-safe` selected `vulkan-copy` and
playback became choppy. A diagnostic comparison that requested VAAPI actually
fell back to software decoding (`hwdec-current=no`) and looked smooth on both
displays. The explicit setting avoids depending on that fallback. Rendering is
uncapped (`video_fps_cap = 0`), subject to each output's refresh rate and GPU/decode
capacity. The selected source supplies 60 frames per second, without a separate
render cap. Both displays use the video. UI widgets appear only on
`DP-3`, the main monitor; other outputs show only the background. If `DP-3` is
disconnected, reconnect it for visible password feedback (the session remains
locked). The Mac-like layout has a large clock/date, local avatar, username,
and rounded password field, with
Catppuccin Mocha/Lavender colors. This is not an exact macOS animation transition.
An opaque background replaces transparency and fade-in to avoid showing the
unlocked desktop during lock startup/resume. Video failure falls back to color.

`hyprlock.conf` is the stock static recovery configuration, using
`Golden_Dark_MOV_still.png`. The shared layout is `hyprlock-layout.conf`.
The cursor is visible. Click the language indicator or use the existing
Ctrl+Alt+Space shortcut to cycle English/Bulgarian while locked. Both routes use
`switch-keyboard-layout.sh`, including its XWayland synchronization. Clear any
partially typed password with Ctrl+U before typing in the new layout.
Personal media files remain outside Git. Missing media can render a solid
background. The wrapper selects stock Hyprlock if the private binary or movie is
absent. A failed private startup retries stock only if Hyprland is still unlocked.
A crashed **already locked** session needs explicit recovery, not a blind retry.

## Separate diagnostic build

To investigate playback problems, build instrumentation without replacing the
normal video locker:

```sh
bash ~/.config/hypr/scripts/build-hyprlock-video.sh /path/to/hyprlock --diagnostic
python3 ~/.config/hypr/scripts/diagnose-hyprlock.py check
```

The diagnostic binary lives in the sibling `<commit>-diagnostic/` directory.
The normal session helper and HyprPanel still select the original build. The
patcher touches only video/rendering files in a disposable export, not PAM,
authentication, keyboard handling, lock protocol logic, or frame pacing.

When interruption is explicitly authorized, run:

```sh
python3 ~/.config/hypr/scripts/diagnose-hyprlock.py lock
```

This **locks the session**. It uses the same duplicate-request guard and zero
grace as normal locking. It writes an owner-only `hyprlock-perf-*.log` in
`$XDG_RUNTIME_DIR`. No idle timers or suspend actions start. It does not use
`--verbose`; the retained output includes only rendering metrics, video status,
and lock/unlock lifecycle markers, not keyboard/password/PAM messages.

Once-per-second metrics include:
- Actual `hwdec-current`, codec, video-output and decoder drop counters per video
  viewport. Unavailable properties stay `unknown` or `-1`, not a false zero.
- `mpv-render` call time and total `video-update` time.
- Total widget-render time and EGL swap call time per monitor.
- Frame-callback intervals per monitor, including mean and maximum gaps.
- The OpenGL renderer string at initialization.

Properties arrive asynchronously from mpv. Timers measure CPU wall-clock call
duration, not GPU execution or physical display presentation. Instrumentation
adds some overhead, so compare results with the normal build and phone recording.
No forced GPU synchronization or synchronous property reads are added. For a
repeat comparison, keep the screen locked for at least 70 seconds, then unlock
normally. The sustained slowdown began after about seven seconds in an earlier
run, but only after about 50 seconds in the instrumented comparison. Short tests
can miss it. No automatic unlock is provided.

### Measured comparison on this machine

Removing the rendering cap (`video_fps_cap = 0`) and reducing the playback
source from 240 fps to 60 fps did not fix the stutter by themselves. The original
movie remains unchanged; the 60 fps derivative remains the selected source.

The earlier dual-decoder VAAPI benchmark showed ample decode throughput, but
it did not exercise the actual locker's `vulkan-copy` path or its two-output
rendering loop. Decode-only throughput was therefore not proof of smooth lock
screen playback. The requested `auto-safe` option was also not evidence of the
selected decoder; that required reading mpv's `hwdec-current` property.

Both diagnostic runs completed and unlocked normally:

- `auto-safe` selected `vulkan-copy` on both outputs. Callbacks eventually fell
  to about 25–26 per second, with gaps up to 81 ms. Final video-output drop
  counters were 1,821 on DP-3 and 2,044 on HDMI-A-1. Decoder drops stayed at zero.
  The user confirmed choppy playback.
- A temporary `video_hwdec = vaapi` config instead reported `hwdec-current=no`:
  VAAPI did not activate. Software decoding sustained about 234 callbacks per
  second on DP-3 and 60 on HDMI-A-1 through the 70-second observation. Final
  video-output drop counters were 5 and 2, with zero decoder drops. The user
  confirmed that playback looked good.

Callback rates are not unique video-frame rates; the source remains 60 fps.
This comparison supports avoiding `vulkan-copy` here, but does not establish
its exact failure mechanism. Frame-copy overhead, driver synchronization, and
interaction with the experimental renderer remain hypotheses, not proven causes.
Zero reported decoder drops does not rule out decoder stalls. CPU use and power
consumption during software playback were not measured. The normal config now
explicitly selects software decoding rather than depending on VAAPI fallback.

### Live validation status

The following checks completed with the normal, non-instrumented build and
explicit `video_hwdec = no`:

- Normal lock: both displays locked and password unlock exited normally. An
  initial attempt ended early; the repeat remained locked for 70 seconds before
  the display-off test.
- Display off/on: both outputs reported DPMS off, then on. The compositor stayed
  locked throughout. The user confirmed smooth playback after the displays
  returned, then unlocked normally.
- Manual suspend/resume: the guarded session helper completed successfully.
  The system journal confirmed suspend and resume. Both displays returned, and
  the user confirmed a lock screen and required password before desktop access.

These tests invoked the same helper commands configured in HyprPanel; they did
not exercise the panel buttons themselves. The MacBook-to-Linux SSH recovery
connection worked, but deliberate locker-crash recovery was not tested.

The user requested that the remaining checks be skipped: deliberate crash
recovery, application inhibitors (including WoW), and the actual 15/30-minute
idle timers. WoW was not running during the checks. These are unverified, not
passed. Monitor disconnect/reconnect and live startup-failure handling also
remain unverified. Idle handling remains disabled; no activation marker exists.

Run offline instrumentation and launcher checks with
`python3 tests/linux-lock-diagnostics.test.py`.

## Safe preparation checks

These commands do not lock or start timers:

```sh
python3 ~/.config/hypr/scripts/session-control.py check
systemctl --user is-active hypr-session-idle.service
hyprctl -j locked
```

If links are missing, deploy only the relevant scopes with `safe-stow.sh` from
the dotfiles repository. Deployment and `systemctl --user daemon-reload` do not
start the service. Existing Hyprland config directories may already be linked.

## Live test, only when work can be interrupted

1. Keep a separate SSH connection or accessible TTY ready for recovery. Know your
   local account password. PAM's failed-password lockout still applies.
2. Run the read-only `check` action above.
3. Test stock first:
   `python3 ~/.config/hypr/scripts/session-control.py lock-static`.
   Verify both monitors and password authentication. Unlock before continuing.
4. Test video:
   `python3 ~/.config/hypr/scripts/session-control.py lock`.
   Check motion, clock, colors, cropping, keyboard layout, password, and GPU use.
5. If a locker crashes while the compositor stays locked, use the separate TTY
   or SSH session with the original session's `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY`,
   and `HYPRLAND_INSTANCE_SIGNATURE`. Inspect/stop only the failed locker and
   launch `/usr/bin/hyprlock --config ~/.config/hypr/hyprlock.conf --no-fade-in --grace 0`
   directly. The normal wrapper deliberately does not replace an existing lock.
   Test this recovery behavior before relying on the experimental build. Do not
   add a password-free unlock shortcut or disable compositor session-lock safety.
6. Restart only HyprPanel when convenient, using its configured restart action.
   Test the dashboard padlock action. No panel restart is needed for direct tests.
7. Only after lock/unlock works, enable idle handling:
   `python3 ~/.config/hypr/scripts/session-control.py enable-idle`.
   The helper rejects an already running separate hypridle. It starts the custom
   service and records opt-in for future sessions. Hyprland starts the gated
   service on later logins. Do not also enable the upstream `hypridle.service`.
8. Test HyprPanel Sleep, resume, and password entry. Test both monitors after
   DPMS off/on and monitor disconnect/reconnect. Test failed video startup.
9. Verify the 15/30-minute idle timers, video playback inhibition in each browser
   or player, and WoW on both active and inactive workspaces. A paused player
   should release its inhibitor. No WoW match or video inhibitor was tested live
   during preparation.

To stop automatic idle actions, **unlock first**, then run:

```sh
python3 ~/.config/hypr/scripts/session-control.py disable-idle
```

This removes the opt-in marker and stops the custom service. The helper refuses
while locked because stopping the service can also stop its locker child. Manual
panel lock and guarded suspend remain available. A system-library update can
break the private binary ABI; rerun the check and rebuild after relevant updates.

## Offline regression checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-locking.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-panel-launcher.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/common-config.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-bootstrap.test.py
```

The new tests mock subprocesses and use temporary paths. They never run a real
locker, compositor action, systemd service action, or suspend. Parser checks and
mocked checks do not establish lock security, rendering, or suspend reliability.
