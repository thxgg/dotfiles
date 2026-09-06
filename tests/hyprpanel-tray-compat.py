#!/usr/bin/env python3
"""Run under dbus-run-session with the private GI_TYPELIB_PATH.

This test starts a watcher on the isolated bus, not on the desktop session bus.
"""
import os
import time
import unittest

import gi

gi.require_version("AstalTray", "0.1")
from gi.repository import AstalTray, Gio, GLib


class TrayRegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get("TRAY_TEST_ISOLATED") != "1":
            raise RuntimeError("Run with dbus-run-session -- env TRAY_TEST_ISOLATED=1")
        cls.tray = AstalTray.get_default()
        cls.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        cls.context = GLib.MainContext.default()
        cls.wait_for(lambda: cls.call(
            "org.freedesktop.DBus", "/org/freedesktop/DBus",
            "org.freedesktop.DBus", "NameHasOwner",
            GLib.Variant("(s)", ("org.kde.StatusNotifierWatcher",)),
        ).unpack()[0])

    @classmethod
    def wait_for(cls, predicate):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            while cls.context.pending():
                cls.context.iteration(False)
            if predicate():
                return
            time.sleep(0.01)
        raise AssertionError("D-Bus operation timed out")

    @classmethod
    def call(cls, name, path, interface, method, args):
        result = []

        def done(connection, response):
            try:
                result.append(connection.call_finish(response))
            except GLib.Error as error:
                result.append(error)

        cls.bus.call(name, path, interface, method, args, None,
                     Gio.DBusCallFlags.NONE, 2000, None, done)
        cls.wait_for(lambda: bool(result))
        if isinstance(result[0], Exception):
            raise result[0]
        return result[0]

    def test_registration_forms(self):
        for service, expected in (
            ("org.example.TrayLegacy", "org.example.TrayLegacy/StatusNotifierItem"),
            ("/org/example/Tray", self.bus.get_unique_name() + "/org/example/Tray"),
            ("org.example.TrayElectron/StatusNotifierItem/1",
             "org.example.TrayElectron/StatusNotifierItem/1"),
        ):
            with self.subTest(service=service):
                self.call("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher",
                          "org.kde.StatusNotifierWatcher", "RegisterStatusNotifierItem",
                          GLib.Variant("(s)", (service,)))
                items = self.call(
                    "org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher",
                    "org.freedesktop.DBus.Properties", "Get",
                    GLib.Variant("(ss)", ("org.kde.StatusNotifierWatcher",
                                           "RegisteredStatusNotifierItems")),
                ).unpack()[0]
                self.assertIn(expected, items)
                if "/" in service and not service.startswith("/"):
                    self.assertNotIn(expected + "/StatusNotifierItem", items)


if __name__ == "__main__":
    unittest.main()
