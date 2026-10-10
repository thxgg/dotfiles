# Exclusive WoW workspace

`hyprland.lua` loads `exclusive-workspace.lua`. It matches only the exact initial
window title `World of Warcraft`, not the shared Wine class. Battle.net and other
Wine apps keep their normal controls.

## Behavior

- On launch, WoW moves to the main monitor's active regular workspace and focus
  follows it, even when launched from the secondary monitor or scratchpad.
  `mainMonitor` in `hyprland.lua` selects the main output (`DP-3`). If that output
  is disconnected, the launch monitor (or focused monitor) is used instead.
  Ordinary destination occupants move to the next numbered workspace on that
  monitor, skipping other games. This also applies if WoW opens on the target.
- When WoW moves from A to B, B's other windows move silently to A. WoW becomes
  tiled and fullscreen on B. Repeated moves use the immediately previous source,
  not the original launch workspace. Cross-monitor moves return occupants to the
  actual source, even if that source is on the other monitor.
- A new ordinary window, or one moved onto WoW's workspace, moves silently to the
  next numbered workspace. That workspace can already contain windows. `5` wraps
  to `1`; `15` wraps to `11`. A workspace containing another WoW window is skipped.
- Super+left/right mouse drag and Super+F do nothing for WoW. Mouse guards use the
  pointer monitor's active workspace and window geometry, not keyboard focus.
  A normal drag's release is still forwarded if the pointer ends over WoW.
- Super+Shift+number continues to move WoW. Super+Shift+S does not move WoW into
  the special scratchpad. Super+S can still show the scratchpad above the game.
- Closing or moving WoW releases the previous workspace. Evicted windows are not
  automatically moved back when the game closes.

## Boundaries

If another WoW window owns the main monitor's active workspace, a new game uses
the next empty slot in that monitor's five-workspace range, wrapping within
`1–5` or `11–15`. If none is empty, it stays at its initial location and warns.
If no slot is available for ordinary occupant routing because every other slot
contains a game, launch also stays in place and warns. These are exceptions to
exclusivity. An unsupported workspace outside these ranges is left unchanged.

Multiple WoW windows cannot share a workspace. An incoming game returns to its
source if the destination already contains a game. If every candidate workspace
contains a game, ordinary window routing warns and leaves the window in place.

On config reload, existing games stay on their current workspaces. Any ordinary
co-occupants go to the next workspace because no prior move source is available.

This guards normal controls. It is not a compositor security boundary and does
not continuously undo external `hyprctl` changes or application requests. Routing
runs on a one-shot timer after open/move callbacks, not inside an unfinished
compositor move. An incoming window can appear briefly before relocation.
Layer-shell panels, menus, notifications, and special workspace overlays are not
ordinary workspace windows and are not evicted. A normal pinned window is still
subject to its compositor pin behavior; the policy does not change pin settings.

The legacy `hyprland.conf` keeps matching tile/fullscreen/idle rules. It cannot
load Lua callbacks or conditional Lua bindings, so this policy requires the Lua
configuration. There is no polling service or external runtime dependency.

## Validation

```sh
lua tests/linux-exclusive-workspace.test.lua
Hyprland --verify-config -c "$PWD/linux/home/.config/hypr/hyprland.lua"
hyprctl configerrors
```

The offline tests use a mock compositor, including synchronous move events and
deferred timer execution. They do not exercise real input devices or Wine.
The parser validates the real installed Lua API's config loading, not callback
execution. An isolated headless runtime test was attempted on this machine, but
Aquamarine could not create its backend (`CBackend::create() failed!`).

Manual desktop checks:

1. Launch WoW with focus on the secondary monitor. Confirm that it appears
   fullscreen on the main monitor's active regular workspace. Its ordinary
   occupants must move to the next numbered main-monitor workspace. Repeat from
   the main monitor and scratchpad.
2. Try Super+left drag, Super+right drag, Super+F, and Super+Shift+S. WoW must stay
   fullscreen in place. Test normal drag/resize/floating on a non-game window too.
3. Move WoW onto a workspace containing ordinary windows. Confirm that those
   windows go to WoW's source workspace, then repeat the move in the other direction.
4. Open an app while on WoW's workspace. Confirm next-number routing, including
   `5 → 1` and `15 → 11`. Also move an existing app onto the game workspace.
5. Check the other monitor and the special scratchpad. Ordinary windows must
   retain their mouse controls even when WoW exists at the same screen coordinates
   on an inactive workspace.
6. Check `hyprctl configerrors` and the compositor log for Lua callback errors.

The live config is a repository symlink on this machine. Hyprland can reload it
when the file changes; no Stow deployment is needed for this existing link.
