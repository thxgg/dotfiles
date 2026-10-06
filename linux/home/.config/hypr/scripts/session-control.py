#!/usr/bin/env python3
"""Explicit session actions. `check` is read-only; idle activation is opt-in."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HOME = Path.home()
CONFIG = HOME / '.config/hypr'
REVISION = '5010673f28ddb154fd83ddae7d17fb4c1032ab8c'
VIDEO_LOCKER = Path(os.environ.get('XDG_DATA_HOME', HOME / '.local/share')) / 'hyprlock-video' / REVISION / 'hyprlock'
MOVIE = HOME / 'Pictures/Wallpapers/Golden_Dark_60fps.mov'
STATE = HOME / '.local/state/hypr-lock/idle-enabled'
SERVICE = 'hypr-session-idle.service'


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=5).stdout.strip()


def locked():
    value = json.loads(run('hyprctl', '-j', 'locked'))['locked']
    if not isinstance(value, bool):
        raise RuntimeError('Invalid compositor lock state; refusing to continue')
    return value


def runtime_dir():
    value = os.environ.get('XDG_RUNTIME_DIR')
    if not value:
        raise RuntimeError('XDG_RUNTIME_DIR is required')
    path = Path(value)
    if path.is_symlink() or not path.is_dir() or path.stat().st_uid != os.getuid():
        raise RuntimeError('A private, owned XDG_RUNTIME_DIR is required')
    return path


def locker_command(static=False):
    if not static and VIDEO_LOCKER.is_file() and os.access(VIDEO_LOCKER, os.X_OK) and MOVIE.is_file():
        return [str(VIDEO_LOCKER), '--config', str(CONFIG / 'hyprlock-video.conf'), '--no-fade-in', '--grace', '0']
    return ['/usr/bin/hyprlock', '--config', str(CONFIG / 'hyprlock.conf'), '--no-fade-in', '--grace', '0']


def lock(static=False):
    # Hold across authentication. Concurrent panel, idle, and sleep requests must
    # not create multiple lockers. Keep this FD out of the child process.
    guard = runtime_dir() / 'hypr-session-lock.guard'
    with guard.open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if locked():
            return
        command = locker_command(static)
        result = subprocess.run(command, check=False)
        if result.returncode:
            # Startup failure is not a successful lock. Only retry on an unlocked
            # compositor; a crashed locked session needs explicit recovery.
            if command[0] != '/usr/bin/hyprlock' and not locked():
                print('Video locker failed; starting stock static Hyprlock', file=sys.stderr)
                subprocess.run(locker_command(True), check=True)
            else:
                raise RuntimeError('Locker exited with an error; inspect the session-lock log')


def suspend():
    # Unlike logind's finite delay inhibitor, this panel action refuses to request
    # suspend at all unless Hyprland confirms a real session lock.
    if not locked():
        log = runtime_dir() / 'hypr-session-lock.log'
        with log.open('a') as output:
            subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'lock'],
                             stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                             start_new_session=True)
        for _ in range(100):
            if locked():
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('No lock confirmation within 20 seconds. Suspend cancelled.')
    # Recheck after the wait. Never treat a process PID as proof of a lock.
    if not locked():
        raise RuntimeError('Session is no longer locked. Suspend cancelled.')
    subprocess.run(['systemctl', 'suspend'], check=True)


def dpms(action):
    provider = json.loads(run('hyprctl', '-j', 'status'))['configProvider']
    if provider == 'lua':
        mode = 'enable' if action == 'on' else 'disable'
        run('hyprctl', 'dispatch', f'hl.dsp.dpms({{ action = "{mode}" }})')
    elif provider == 'hyprlang':
        run('hyprctl', 'dispatch', 'dpms', action)
    else:
        raise RuntimeError(f'Unknown Hyprland config provider: {provider}')


def check():
    # No Wayland connection from either locker: --version exits before startup.
    for name in ('hyprlock.conf', 'hyprlock-video.conf', 'hyprlock-layout.conf', 'hypridle.conf'):
        if not (CONFIG / name).is_file():
            raise RuntimeError(f'Missing {CONFIG / name}')
    if not MOVIE.is_file():
        raise RuntimeError(f'Missing playback movie: {MOVIE}')
    print(run(str(VIDEO_LOCKER), '--version'))
    for name in ('hyprlock-video.conf', 'hyprlock.conf'):
        print(name + ':', run(str(VIDEO_LOCKER.parent / 'check-config'), str(CONFIG / name)))
    print('Stock fallback:', run('/usr/bin/hyprlock', '--version'))
    print('Compositor locked:', locked())
    print('Idle activation:', 'enabled' if STATE.exists() else 'DISABLED (awaiting explicit activation)')
    print('Selected video:', MOVIE)
    print('Live rendering, authentication, and sleep behavior are NOT validated by this check.')


def enable_idle():
    check()
    run('systemctl', '--user', 'daemon-reload')
    run('systemctl', '--user', 'import-environment', 'WAYLAND_DISPLAY',
        'HYPRLAND_INSTANCE_SIGNATURE', 'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'DISPLAY')
    # A hypridle launched separately would duplicate timers and sleep hooks.
    existing = subprocess.run(['pgrep', '-x', 'hypridle'], capture_output=True, check=False)
    if existing.returncode == 0:
        raise RuntimeError('hypridle is already running. Stop it before enabling this service.')
    if existing.returncode != 1:
        raise RuntimeError('Could not check for an existing hypridle process')
    STATE.parent.mkdir(parents=True, exist_ok=True)
    already_enabled = STATE.exists()
    STATE.touch()
    try:
        run('systemctl', '--user', 'start', SERVICE)
        run('systemctl', '--user', 'is-active', SERVICE)
    except Exception:
        if not already_enabled:
            STATE.unlink(missing_ok=True)
        raise
    print('Idle policy enabled now and for future Hyprland sessions.')


def main():
    if len(sys.argv) != 2:
        raise RuntimeError('Usage: session-control.py check|lock|lock-static|suspend|display-on|display-off|enable-idle|disable-idle')
    action = sys.argv[1]
    if action == 'check':
        check()
    elif action == 'lock':
        lock()
    elif action == 'lock-static':
        lock(static=True)
    elif action == 'suspend':
        suspend()
    elif action in ('display-on', 'display-off'):
        dpms(action.removeprefix('display-'))
    elif action == 'enable-idle':
        enable_idle()
    elif action == 'disable-idle':
        # systemd may also stop the locker's child process in this unit's cgroup.
        # Do not turn a working lock screen into a crashed-lock recovery case.
        if locked():
            raise RuntimeError('Unlock first, then disable idle handling')
        STATE.unlink(missing_ok=True)
        run('systemctl', '--user', 'stop', SERVICE)
        print('Idle policy disabled.')
    else:
        raise RuntimeError(f'Unknown action: {action}')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Session action failed: {error}', file=sys.stderr)
        sys.exit(1)
