#!/usr/bin/env python3
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "teams_unread", ROOT / "linux/home/.config/hypr/scripts/teams-unread.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def client(title="Chat | Microsoft Teams", app_id="teams.microsoft.com_/", **kwargs):
    return {"class": "MicrosoftTeams", "initialTitle": app_id, "title": title, **kwargs}


class TeamsBadgeTests(unittest.TestCase):
    def test_open_without_badge_stays_visible(self):
        self.assertEqual(module.teams_badge([client()]), "0")
        self.assertEqual(module.teams_badge([client("(0) Chat | Microsoft Teams")]), "0")

    def test_unread_count(self):
        self.assertEqual(module.teams_badge([client("(1) Chat | TEAM CHAT | Microsoft Teams")]), "1")
        self.assertEqual(module.teams_badge([client("(12) Chat | Microsoft Teams")]), "12")

    def test_closed_is_empty(self):
        self.assertEqual(module.teams_badge([]), "")

    def test_other_chrome_apps_are_excluded(self):
        others = [client("(9) Inbox", "outlook.cloud.microsoft_/mail/"),
                  client("(20) Development", "linear.app_/")]
        self.assertEqual(module.teams_badge(others), "")
        self.assertEqual(module.teams_badge(others + [client()]), "0")

    def test_duplicate_windows_are_not_summed(self):
        self.assertEqual(module.teams_badge([client("(3) Chat"), client("(3) Chat")]), "3")

    def test_cloud_domain(self):
        self.assertEqual(module.teams_badge([client("(2) Chat", "teams.cloud.microsoft_/")]), "2")

    def test_count_must_be_at_start(self):
        self.assertEqual(module.teams_badge([client("Chat (123) | Microsoft Teams")]), "0")

    def test_invalid_client_data(self):
        for value in ({}, [None], [client(None)]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.teams_badge(value)

    def run_main(self, stdout="[]", error=None):
        output = io.StringIO()
        result = subprocess.CompletedProcess([], 0, stdout=stdout)
        with patch.object(module.subprocess, "run", return_value=result, side_effect=error), \
                contextlib.redirect_stdout(output):
            module.main()
        return output.getvalue()

    def test_closed_emits_zero_bytes(self):
        self.assertEqual(self.run_main(), "")

    def test_failed_query_stays_visible_as_unknown(self):
        for error in (OSError(), subprocess.TimeoutExpired("hyprctl", 1),
                      subprocess.CalledProcessError(1, "hyprctl")):
            with self.subTest(error=error):
                self.assertEqual(self.run_main(error=error), "?")
        self.assertEqual(self.run_main(stdout="invalid JSON"), "?")


if __name__ == "__main__":
    unittest.main()
