#!/usr/bin/env python3
"""Read-only preflight by default. `lock` explicitly starts a diagnostic lock."""
import datetime
import fcntl
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys

spec = importlib.util.spec_from_file_location('session_control', Path(__file__).with_name('session-control.py'))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


def diagnostic_binary():
    return control.VIDEO_LOCKER.parent.with_name(control.REVISION + '-diagnostic') / 'hyprlock'


def filtered_line(line):
    clean = re.sub(r'\x1b\[[0-9;]*m', '', line)
    # Keep no generic verbose output, password/PAM messages, or keyboard events.
    return any(marker in clean for marker in (
        '[perf]', '[mpv]', 'onLockLocked called', 'Unlocked, exiting!',
        'Configuring surface for',
    ))


def main():
    action = sys.argv[1] if len(sys.argv) == 2 else 'check' if len(sys.argv) == 1 else None
    if action not in ('check', 'lock'):
        raise RuntimeError('Usage: diagnose-hyprlock.py [check|lock]')
    control.check()
    binary = diagnostic_binary()
    print(control.run(str(binary), '--version'))
    print(control.run(str(binary.parent / 'check-config'), str(control.CONFIG / 'hyprlock-video.conf')))
    if action == 'check':
        print('Diagnostic build ready. No lock started.')
        return
    with (control.runtime_dir() / 'hypr-session-lock.guard').open('a') as guard:
        try:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('A lock request is already running') from None
        if control.locked():
            raise RuntimeError('Session already locked; diagnostic not started')
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        path = control.runtime_dir() / f'hyprlock-perf-{stamp}.log'
        print(f'Diagnostic log: {path}', flush=True)
        with path.open('x', buffering=1) as log:
            command = [str(binary), '--config', str(control.CONFIG / 'hyprlock-video.conf'), '--no-fade-in', '--grace', '0']
            # No --verbose: instrumentation logs aggregate metrics once per second.
            with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True) as process:
                for line in process.stdout:
                    if filtered_line(line):
                        log.write(line)
                status = process.wait()
                log.write(f'EXIT_STATUS={status}\n')
        if status:
            raise RuntimeError(f'Diagnostic locker exited with status {status}. See {path}; use the documented stock recovery if still locked.')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Diagnostic failed: {error}', file=sys.stderr)
        sys.exit(1)
