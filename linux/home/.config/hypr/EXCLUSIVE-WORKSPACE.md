# Exclusive WoW workspace

`hyprland.lua` loads `exclusive-workspace.lua`. It matches only the exact initial
window title `World of Warcraft`, not the shared Wine class. Battle.net and other
Wine apps keep their normal controls.

## Behavior

- On launch, WoW moves to the next empty workspace and focus follows it. Search
  wraps within `1–5` or `11–15`. The launch workspace itself is not a candidate.
  A launch from the special scratchpad uses the monitor's active regular workspace
  as the search origin.
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

If all other slots in the monitor's five-workspace range are occupied, launching
WoW leaves it at its initial location and shows a warning. It does not displace
existing windows to manufacture an empty launch slot. Free a slot and move WoW
there with Super+Shift+number. This is a deliberate exception to exclusivity.

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

1. Launch WoW from an occupied workspace. Confirm that it appears fullscreen on
   the next empty slot on that monitor.
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
