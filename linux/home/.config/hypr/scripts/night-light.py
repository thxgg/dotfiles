#!/usr/bin/env python3
"""Control Hyprsunset over IPC without stopping its schedule."""
import json
import subprocess
import sys


def request(*args):
    result = subprocess.run(
        ['hyprctl', 'hyprsunset', *args],
        check=True, capture_output=True, text=True, timeout=3,
    )
    return result.stdout.strip()


def is_day():
    state = request('identity', 'get')
    if state not in ('true', 'false'):
        raise ValueError(f'Unexpected Hyprsunset identity: {state}')
    return state == 'true'


def main(action):
    try:
        if action == 'status':
            day = is_day()
            print(json.dumps({
                'text': 'Day' if day else 'Night',
                'alt': 'day' if day else 'night',
            }))
        elif action == 'toggle':
            args = ('temperature', '4500') if is_day() else ('identity',)
            reply = request(*args)
            if reply != 'ok':
                raise ValueError(reply)
        elif action == 'reset':
            reply = request('reset')
            if reply != 'ok':
                raise ValueError(reply)
        else:
            raise ValueError(f'Unknown action: {action}')
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        if action == 'status':
            print(json.dumps({'text': 'Unavailable', 'alt': 'unavailable'}))
        print(f'Night light: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) == 2 else 'status'))
