#!/usr/bin/env python3
"""Publish the Chrome Teams PWA as a StatusNotifierItem, without browser access."""
import fcntl
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys

from gi.repository import Gio, GLib

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("teams_unread", ROOT / "teams-unread.py")
badge_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(badge_module)

ITEM = "org.kde.StatusNotifierItem"
WATCHER = "org.kde.StatusNotifierWatcher"
PATH = "/StatusNotifierItem"
XML = '''<node><interface name="org.kde.StatusNotifierItem">
<property name="Category" type="s" access="read"/>
<property name="Id" type="s" access="read"/>
<property name="Title" type="s" access="read"/>
<property name="Status" type="s" access="read"/>
<property name="IconName" type="s" access="read"/>
<property name="IconThemePath" type="s" access="read"/>
<property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
<property name="ItemIsMenu" type="b" access="read"/>
<property name="Menu" type="o" access="read"/>
<method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
<signal name="NewIcon"/><signal name="NewToolTip"/>
</interface></node>'''
MENU_XML = '''<node><interface name="com.canonical.dbusmenu">
<property name="Version" type="u" access="read"/>
<property name="TextDirection" type="s" access="read"/>
<property name="Status" type="s" access="read"/>
<method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/><arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/></method>
<method name="GetGroupProperties"><arg type="ai" direction="in"/><arg type="as" direction="in"/><arg type="a(ia{sv})" direction="out"/></method>
<method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/></method>
</interface></node>'''


class TeamsTray:
    def __init__(self):
        self.connection = None
        self.badge = "0"
        self.address = None
        self.theme = "dark"
        self.watcher_available = False
        self.control = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.watch = Gio.bus_watch_name_on_connection(
            self.control, WATCHER, Gio.BusNameWatcherFlags.NONE,
            self.watcher_appeared, self.watcher_vanished,
        )

    def watcher_appeared(self, *_):
        self.watcher_available = True
        self.register()

    def watcher_vanished(self, *_):
        self.watcher_available = False

    def register(self):
        if self.connection is not None and self.watcher_available:
            self.connection.call(
                WATCHER, "/StatusNotifierWatcher", WATCHER,
                "RegisterStatusNotifierItem", GLib.Variant("(s)", (PATH,)),
                None, Gio.DBusCallFlags.NONE, 2000, None, self.registered,
            )

    @staticmethod
    def registered(connection, result):
        try:
            connection.call_finish(result)
        except GLib.Error as error:
            print(f"Teams tray registration: {error.message}", file=sys.stderr)

    def properties(self):
        unread = self.badge.isdecimal() and int(self.badge) > 0
        suffix = "-light" if self.theme == "light" else ""
        icon = ROOT / "teams-tray-icons" / (("unread" if unread else "normal") + suffix + ".svg")
        detail = ("Unread status unavailable" if self.badge == "?" else
                  f"{self.badge} unread — Teams title badge")
        return {
            "Category": GLib.Variant("s", "Communications"),
            "Id": GLib.Variant("s", "teams-pwa"),
            "Title": GLib.Variant("s", "Microsoft Teams"),
            "Status": GLib.Variant("s", "Active"),
            "IconName": GLib.Variant("s", str(icon)),
            "IconThemePath": GLib.Variant("s", ""),
            "ToolTip": GLib.Variant("(sa(iiay)ss)", ("", [], "Microsoft Teams", detail)),
            "ItemIsMenu": GLib.Variant("b", False),
            "Menu": GLib.Variant("o", "/MenuBar"),
        }

    def activate(self):
        if self.address and re.fullmatch(r"0x[0-9a-fA-F]+", self.address):
            # The address comes only from the Teams-filtered Hyprland client list.
            subprocess.Popen(
                ["hyprctl", "dispatch", f'hl.dsp.focus({{ window = "address:{self.address}" }})'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )

    def method(self, connection, sender, path, interface, method, parameters, invocation):
        if method in ("Activate", "SecondaryActivate", "ContextMenu"):
            self.activate()
        invocation.return_value(None)

    @staticmethod
    def menu_properties():
        return {"label": GLib.Variant("s", "Open Microsoft Teams"),
                "enabled": GLib.Variant("b", True), "visible": GLib.Variant("b", True)}

    def menu_method(self, connection, sender, path, interface, method, parameters, invocation):
        if method == "GetLayout":
            child = GLib.Variant("(ia{sv}av)", (1, self.menu_properties(), []))
            invocation.return_value(GLib.Variant("(u(ia{sv}av))", (1, (0, {}, [child]))))
        elif method == "GetGroupProperties":
            invocation.return_value(GLib.Variant("(a(ia{sv}))", ([(1, self.menu_properties())],)))
        elif method == "AboutToShow":
            invocation.return_value(GLib.Variant("(b)", (False,)))
        else:
            if method == "Event" and parameters.unpack()[1] == "clicked":
                self.activate()
            invocation.return_value(None)

    def open(self):
        self.connection = Gio.DBusConnection.new_for_address_sync(
            Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION, None),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            None, None,
        )
        self.connection.register_object(
            PATH, Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], self.method,
            lambda c, s, p, i, name: self.properties()[name], None,
        )
        self.connection.register_object(
            "/MenuBar", Gio.DBusNodeInfo.new_for_xml(MENU_XML).interfaces[0], self.menu_method,
            lambda c, s, p, i, name: {
                "Version": GLib.Variant("u", 3), "TextDirection": GLib.Variant("s", "ltr"),
                "Status": GLib.Variant("s", "normal"),
            }[name], None,
        )
        self.register()

    def refresh(self):
        try:
            clients = badge_module.read_clients()
            badge = badge_module.teams_badge(clients)
        except (OSError, subprocess.SubprocessError, ValueError):
            # Preserve the previous icon on transient query errors.
            return GLib.SOURCE_CONTINUE
        if badge == "":
            if self.connection is not None:
                self.connection.close_sync(None)
                self.connection = None
            self.address = None
        else:
            self.address = next(c.get("address") for c in clients if badge_module.is_teams(c))
            changed = badge != self.badge
            self.badge = badge
            if self.connection is None:
                self.open()
            elif changed:
                for signal in ("NewIcon", "NewToolTip"):
                    self.connection.emit_signal(None, PATH, ITEM, signal, None)
        return GLib.SOURCE_CONTINUE


def main():
    runtime = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    with (runtime / "teams-pwa-tray.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        tray = TeamsTray()
        tray.refresh()
        GLib.timeout_add(2000, tray.refresh)
        GLib.MainLoop().run()


if __name__ == "__main__":
    main()
