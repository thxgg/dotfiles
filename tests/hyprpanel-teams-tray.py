#!/usr/bin/env python3
"""Tray lifecycle tests; no desktop or D-Bus state changes."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "teams_tray", ROOT / "linux/home/.config/hypr/scripts/teams-tray.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def client(title="Chat | Microsoft Teams"):
    return {"class": "MicrosoftTeams", "initialTitle": "teams.microsoft.com_/",
            "title": title, "address": "0x123abc"}


class TrayTests(unittest.TestCase):
    def setUp(self):
        self.tray = module.TeamsTray.__new__(module.TeamsTray)
        self.tray.connection = None
        self.tray.badge = "0"
        self.tray.address = None
        self.tray.theme = "dark"
        self.tray.watcher_available = True
        self.tray.open = Mock()

    def refresh(self, clients):
        with patch.object(module.badge_module, "read_clients", return_value=clients):
            self.tray.refresh()

    def test_open_with_zero_registers(self):
        self.refresh([client()])
        self.tray.open.assert_called_once()
        self.assertEqual(self.tray.badge, "0")

    def test_closed_removes_dbus_item(self):
        connection = Mock()
        self.tray.connection = connection
        self.refresh([])
        connection.close_sync.assert_called_once_with(None)
        self.assertIsNone(self.tray.connection)

    def test_closed_to_open_registers_again(self):
        self.refresh([])
        self.tray.open.assert_not_called()
        self.refresh([client("(1) Chat")])
        self.tray.open.assert_called_once()

    def test_error_preserves_previous_icon(self):
        connection = Mock()
        self.tray.connection = connection
        self.tray.badge = "2"
        with patch.object(module.badge_module, "read_clients", side_effect=ValueError()):
            self.tray.refresh()
        connection.close_sync.assert_not_called()
        self.assertEqual(self.tray.badge, "2")

    def test_unread_and_read_emit_icon_updates(self):
        connection = Mock()
        self.tray.connection = connection
        self.refresh([client("(1) Chat")])
        self.assertTrue(self.tray.properties()["IconName"].unpack().endswith("unread.svg"))
        connection.emit_signal.assert_any_call(None, module.PATH, module.ITEM, "NewIcon", None)
        self.refresh([client()])
        self.assertTrue(self.tray.properties()["IconName"].unpack().endswith("normal.svg"))

    def test_both_themes_have_assets(self):
        for theme in ("light", "dark"):
            for badge in ("0", "1"):
                self.tray.theme, self.tray.badge = theme, badge
                self.assertTrue(Path(self.tray.properties()["IconName"].unpack()).is_file())

    def test_activation_uses_exact_address(self):
        self.tray.address = "0x123abc"
        with patch.object(module.subprocess, "Popen") as launch:
            self.tray.activate()
            self.assertEqual(launch.call_args.args[0], [
                "hyprctl", "dispatch", 'hl.dsp.focus({ window = "address:0x123abc" })'
            ])

    def test_invalid_address_is_not_executed(self):
        self.tray.address = '0x123; bad command'
        with patch.object(module.subprocess, "Popen") as launch:
            self.tray.activate()
            launch.assert_not_called()

    def test_host_restart_registers_again(self):
        self.tray.connection = Mock()
        self.tray.watcher_vanished()
        self.tray.register()
        self.tray.connection.call.assert_not_called()
        self.tray.watcher_appeared()
        self.tray.connection.call.assert_called_once()


if __name__ == "__main__":
    unittest.main()
