#!/usr/bin/env python3
"""Report the Teams PWA title badge: count, empty if closed, ? if unavailable."""
import json
import re
import subprocess
import sys

TEAMS_APP_IDS = {"teams.microsoft.com_/", "teams.cloud.microsoft_/"}


def is_teams(client):
    return (client.get("class") == "MicrosoftTeams"
            and client.get("initialTitle") in TEAMS_APP_IDS)


def read_clients():
    result = subprocess.run(
        ["hyprctl", "clients", "-j"], check=True, capture_output=True,
        text=True, timeout=1,
    )
    return json.loads(result.stdout)


def teams_badge(clients):
    if not isinstance(clients, list) or any(not isinstance(c, dict) for c in clients):
        raise ValueError("Invalid Hyprland client list")
    teams = [
        client for client in clients
        if is_teams(client)
    ]
    if not teams:
        return ""
    counts = []
    for client in teams:
        title = client.get("title")
        if not isinstance(title, str):
            raise ValueError("Missing Teams window title")
        match = re.match(r"^\(([0-9]+)\)", title)
        counts.append(int(match[1]) if match else 0)
    # Duplicate windows can show the same aggregate badge. Do not sum them.
    return str(max(counts))


def main():
    try:
        output = teams_badge(read_clients())
    except (OSError, subprocess.SubprocessError, ValueError):
        # A failed query does not prove the PWA is closed. Keep the module visible.
        output = "?"
    sys.stdout.write(output)


if __name__ == "__main__":
    main()
