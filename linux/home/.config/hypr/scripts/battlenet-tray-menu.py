#!/usr/bin/env python3
"""Dismiss the Wine Battle.net tray popup on X11 focus loss, not the active app."""
import fcntl
import os
from pathlib import Path
import select
import sys
import time

from Xlib import X, XK, display, error, protocol
from gi.repository import Gio, GLib


def is_menu(pid, title, style, mapped, geometry, expected_pid, x, y):
    """Do not target the launcher, game, or another process's window."""
    gx, gy, width, height = geometry
    return (pid == expected_pid and title == 'Battle.net'
            and mapped == X.IsViewable and style & 0x80000000 != 0
            and style & 0x00C00000 == 0  # WS_POPUP, without WS_CAPTION
            and 80 <= width <= 600 and 80 <= height <= 1000
            and abs(gx - x) <= width and abs(gy - y) <= height)


def should_dismiss(event):
    return (event.type == X.FocusOut and event.mode == X.NotifyNormal
            and event.detail != X.NotifyInferior)


def escape(connection, window):
    # XSendEvent addresses only this window. Never use XTest/global key injection.
    for kind in (protocol.event.KeyPress, protocol.event.KeyRelease):
        window.send_event(kind(
            time=X.CurrentTime, root=connection.screen().root, window=window,
            child=X.NONE, root_x=0, root_y=0, event_x=0, event_y=0,
            state=0, detail=connection.keysym_to_keycode(XK.XK_Escape),
            same_screen=1), event_mask=0)
    connection.flush()


def watch(connection, pid, x, y):
    root = connection.screen().root
    pid_atom = connection.intern_atom('_NET_WM_PID')
    style_atom = connection.intern_atom('_WINE_HWND_STYLE')

    def candidate(window):
        try:
            owner = window.get_full_property(pid_atom, X.AnyPropertyType)
            style = window.get_full_property(style_atom, X.AnyPropertyType)
            if owner is None or style is None:
                return False
            geometry = window.get_geometry()
            return is_menu(owner.value[0], window.get_wm_name(), style.value[0],
                           window.get_attributes().map_state,
                           (geometry.x, geometry.y, geometry.width, geometry.height),
                           pid, x, y)
        except error.XError:
            return False

    # The D-Bus reply can precede mapping. Limit discovery to two seconds.
    deadline = time.monotonic() + 2
    window = None
    while time.monotonic() < deadline:
        matches = [w for w in root.query_tree().children if candidate(w)]
        if len(matches) == 1:
            window = matches[0]
            break
        time.sleep(0.025)
    if window is None:
        return
    window.change_attributes(event_mask=X.FocusChangeMask | X.StructureNotifyMask)
    # Give the menu keyboard focus once so a later outside click produces FocusOut.
    # Do not keep restoring focus, grab input, or activate the hidden launcher.
    window.set_input_focus(X.RevertToParent, X.CurrentTime)
    connection.flush()
    while True:
        if not connection.pending_events():
            select.select([connection.fileno()], [], [], 1)
            # Also exit if the popup was hidden before our event subscription.
            if not candidate(window):
                return
            continue
        event = connection.next_event()
        if getattr(event, 'window', None) != window:
            continue
        if event.type in (X.UnmapNotify, X.DestroyNotify):
            return
        if should_dismiss(event):
            if candidate(window):
                escape(connection, window)
            return


def main():
    service, x, y = sys.argv[1:]
    if not service.startswith(':'):
        raise ValueError('Expected a unique D-Bus service name')
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    pid = bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
                        'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
                        GLib.Variant('(s)', (service,)), GLib.VariantType('(u)'),
                        Gio.DBusCallFlags.NONE, 2000, None).unpack()[0]
    runtime = Path(os.environ['XDG_RUNTIME_DIR'])
    # One watcher per owner, including rapid repeated right clicks.
    with (runtime / f'battlenet-tray-menu-{pid}.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        connection = display.Display()
        try:
            watch(connection, pid, int(x), int(y))
        finally:
            connection.close()


if __name__ == '__main__':
    try:
        main()
    except (error.XError, GLib.Error, OSError, ValueError) as exc:
        print(f'Battle.net tray menu: {exc}', file=sys.stderr)
        sys.exit(1)
