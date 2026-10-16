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

    def new_client(self):
        client = Gio.DBusConnection.new_for_address_sync(
            os.environ["DBUS_SESSION_BUS_ADDRESS"],
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT
            | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            None, None,
        )
        self.addCleanup(lambda: None if client.is_closed() else client.close_sync(None))
        return client

    def client_call(self, client, method, args):
        return client.call_sync(
            "org.freedesktop.DBus", "/org/freedesktop/DBus",
            "org.freedesktop.DBus", method, args, None,
            Gio.DBusCallFlags.NONE, 2000, None,
        ).unpack()

    def request_name(self, client, name, flags=0):
        result = self.client_call(client, "RequestName", GLib.Variant("(su)", (name, flags)))
        self.assertEqual(result, (1,))  # DBUS_REQUEST_NAME_REPLY_PRIMARY_OWNER

    def register(self, client, service):
        # The watcher runs in this thread, so its call must be asynchronous.
        results = []

        def done(connection, response):
            try:
                results.append(connection.call_finish(response))
            except GLib.Error as error:
                results.append(error)

        client.call(
            "org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher",
            "org.kde.StatusNotifierWatcher", "RegisterStatusNotifierItem",
            GLib.Variant("(s)", (service,)), None,
            Gio.DBusCallFlags.NONE, 2000, None, done,
        )
        self.wait_for(lambda: bool(results))
        if isinstance(results[0], Exception):
            raise results[0]

    def items(self):
        return self.call(
            "org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher",
            "org.freedesktop.DBus.Properties", "Get",
            GLib.Variant("(ss)", ("org.kde.StatusNotifierWatcher",
                                  "RegisteredStatusNotifierItems")),
        ).unpack()[0]

    def removed_signals(self):
        removed = []
        subscription = self.bus.signal_subscribe(
            None, "org.kde.StatusNotifierWatcher", "StatusNotifierItemUnregistered",
            "/StatusNotifierWatcher", None, Gio.DBusSignalFlags.NONE,
            lambda *args: removed.append(args[5].unpack()[0]),
        )
        self.addCleanup(self.bus.signal_unsubscribe, subscription)
        return removed

    def assert_removed(self, expected, removed):
        self.wait_for(lambda: expected not in self.items() and expected in removed)
        self.assertEqual(removed.count(expected), 1)

    def test_quit_removes_all_registration_forms(self):
        removed = self.removed_signals()
        for index, form in enumerate(("bare", "pair", "path", "unique-pair")):
            with self.subTest(form=form):
                client = self.new_client()
                name = f"org.example.Quit{index}"
                self.request_name(client, name)
                service, expected = {
                    "bare": (name, name + "/StatusNotifierItem"),
                    "pair": (name + "/StatusNotifierItem/1", name + "/StatusNotifierItem/1"),
                    "path": ("/CustomItem", client.get_unique_name() + "/CustomItem"),
                    "unique-pair": (client.get_unique_name() + "/CustomItem",
                                    client.get_unique_name() + "/CustomItem"),
                }[form]
                self.register(client, service)
                self.assertIn(expected, self.items())
                client.close_sync(None)
                self.assert_removed(expected, removed)

    def test_release_name_keeps_other_items(self):
        removed = self.removed_signals()
        client = self.new_client()
        names = ("org.example.Release", "org.example.Keep")
        for name in names:
            self.request_name(client, name)
            self.register(client, name)
        expected = names[0] + "/StatusNotifierItem"
        # Re-registering must not cause duplicate removal signals.
        self.register(client, names[0])
        self.client_call(client, "ReleaseName", GLib.Variant("(s)", (names[0],)))
        self.assert_removed(expected, removed)
        self.assertFalse(client.is_closed())
        self.assertIn(names[1] + "/StatusNotifierItem", self.items())
        # A later owner can register the same name and be cleaned up again.
        self.request_name(client, names[0])
        removed.clear()
        self.register(client, names[0])
        self.assertIn(expected, self.items())
        client.close_sync(None)
        self.assert_removed(expected, removed)
        self.assert_removed(names[1] + "/StatusNotifierItem", removed)

    def test_owner_replacement_removes_old_registration(self):
        removed = self.removed_signals()
        old_client, new_client = self.new_client(), self.new_client()
        name = "org.example.Replace"
        self.request_name(old_client, name, 1)  # ALLOW_REPLACEMENT
        self.register(old_client, name)
        expected = name + "/StatusNotifierItem"
        self.request_name(new_client, name, 2)  # REPLACE_EXISTING
        self.assert_removed(expected, removed)
        self.register(new_client, name)
        self.assertIn(expected, self.items())
        old_client.close_sync(None)
        # A round trip through the watcher also drains the old owner's signals.
        self.assertIn(expected, self.items())
        removed.clear()
        new_client.close_sync(None)
        self.assert_removed(expected, removed)

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
