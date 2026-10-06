"""Session-action tests. No real locker, systemd, or compositor commands run."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'linux/home/.config/hypr/scripts/session-control.py'
spec = importlib.util.spec_from_file_location('session_control', SCRIPT)
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class SessionActions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.config = self.home / '.config/hypr'
        self.config.mkdir(parents=True)
        for key, value in {'HOME': self.home, 'CONFIG': self.config,
                           'MOVIE': self.home / 'original.mov',
                           'VIDEO_LOCKER': self.home / 'video-locker',
                           'STATE': self.home / 'state/idle-enabled'}.items():
            p = patch.object(control, key, value)
            p.start()
            self.addCleanup(p.stop)
        self.env = patch.dict(os.environ, {'XDG_RUNTIME_DIR': str(self.home)}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.run = patch.object(control.subprocess, 'run')
        self.process = self.run.start()
        self.addCleanup(self.run.stop)
        self.spawn = patch.object(control.subprocess, 'Popen')
        self.child = self.spawn.start()
        self.addCleanup(self.spawn.stop)

    def test_video_and_static_selection_require_zero_grace(self):
        self.assertEqual(control.locker_command()[0], '/usr/bin/hyprlock')
        control.VIDEO_LOCKER.write_text('mock')
        control.VIDEO_LOCKER.chmod(0o700)
        control.MOVIE.touch()
        cmd = control.locker_command()
        self.assertEqual(cmd[0], str(control.VIDEO_LOCKER))
        self.assertEqual(cmd[-3:], ['--no-fade-in', '--grace', '0'])
        self.assertEqual(control.locker_command(True)[0], '/usr/bin/hyprlock')

    def test_locked_session_does_not_start_another_locker(self):
        with patch.object(control, 'locked', return_value=True):
            control.lock()
        self.process.assert_not_called()

    def test_failed_video_start_falls_back_only_while_unlocked(self):
        with patch.object(control, 'locked', return_value=False), \
             patch.object(control, 'locker_command', side_effect=[['private-locker'], ['/usr/bin/hyprlock']]):
            self.process.return_value.returncode = 1
            control.lock()
        self.assertEqual(self.process.call_count, 2)
        self.assertEqual(self.process.call_args.args[0], ['/usr/bin/hyprlock'])

    def test_crash_while_locked_does_not_blindly_start_fallback(self):
        with patch.object(control, 'locked', side_effect=[False, True]), \
             patch.object(control, 'locker_command', return_value=['private-locker']):
            self.process.return_value.returncode = 1
            with self.assertRaises(RuntimeError):
                control.lock()
        self.assertEqual(self.process.call_count, 1)

    def test_suspend_requires_confirmation(self):
        with patch.object(control, 'locked', side_effect=[False, False, True, True]), \
             patch.object(control.time, 'sleep'):
            control.suspend()
        self.child.assert_called_once()
        self.process.assert_called_once_with(['systemctl', 'suspend'], check=True)

    def test_suspend_timeout_never_suspends(self):
        with patch.object(control, 'locked', return_value=False), patch.object(control.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'Suspend cancelled'):
                control.suspend()
        self.process.assert_not_called()

    def test_unlock_during_wait_cancels_suspend(self):
        with patch.object(control, 'locked', side_effect=[False, True, False]):
            with self.assertRaisesRegex(RuntimeError, 'no longer locked'):
                control.suspend()
        self.process.assert_not_called()

    def test_bad_compositor_state_fails_closed(self):
        with patch.object(control, 'run', return_value='{"locked": "false"}'):
            with self.assertRaises(RuntimeError):
                control.locked()

    def test_dpms_provider_dispatch(self):
        with patch.object(control, 'run', side_effect=['{"configProvider":"lua"}', '']) as run:
            control.dpms('on')
            self.assertIn('action = "enable"', run.call_args.args[-1])
        with patch.object(control, 'run', side_effect=['{"configProvider":"hyprlang"}', '']) as run:
            control.dpms('off')
            self.assertEqual(run.call_args.args, ('hyprctl', 'dispatch', 'dpms', 'off'))

    def test_failed_activation_removes_new_marker(self):
        self.process.return_value.returncode = 1  # No existing hypridle.
        with patch.object(control, 'check'), \
             patch.object(control, 'run', side_effect=['', '', RuntimeError('start failed')]):
            with self.assertRaises(RuntimeError):
                control.enable_idle()
        self.assertFalse(control.STATE.exists())

    def test_cannot_disable_idle_while_locked(self):
        control.STATE.parent.mkdir()
        control.STATE.touch()
        with patch.object(control.sys, 'argv', ['session-control.py', 'disable-idle']), \
             patch.object(control, 'locked', return_value=True):
            with self.assertRaisesRegex(RuntimeError, 'Unlock first'):
                control.main()
        self.assertTrue(control.STATE.exists())
        self.process.assert_not_called()

    def test_duplicate_request_does_not_launch_locker(self):
        with (self.home / 'hypr-session-lock.guard').open('a') as guard:
            control.fcntl.flock(guard, control.fcntl.LOCK_EX | control.fcntl.LOCK_NB)
            with patch.object(control, 'locked') as state:
                control.lock()
            state.assert_not_called()
        self.process.assert_not_called()

    def test_successful_activation_creates_marker(self):
        self.process.return_value.returncode = 1
        with patch.object(control, 'check'), patch.object(control, 'run') as run:
            control.enable_idle()
        self.assertTrue(control.STATE.exists())
        self.assertIn(('systemctl', '--user', 'start', control.SERVICE), [c.args for c in run.call_args_list])

    def test_check_only_uses_versions_parser_and_readonly_state(self):
        for name in ('hyprlock.conf', 'hyprlock-video.conf', 'hyprlock-layout.conf', 'hypridle.conf'):
            (control.CONFIG / name).touch()
        control.MOVIE.touch()
        with patch.object(control, 'run', return_value='OK') as run, \
             patch.object(control, 'locked', return_value=False):
            control.check()
        for call in run.call_args_list:
            args = call.args
            self.assertTrue('--version' in args or Path(args[0]).name == 'check-config')
        self.child.assert_not_called()
        self.process.assert_not_called()
        self.assertFalse(control.STATE.exists())

    def test_unknown_action_has_no_side_effects(self):
        with patch.object(control.sys, 'argv', ['session-control.py', 'typo']):
            with self.assertRaises(RuntimeError):
                control.main()
        self.process.assert_not_called()
        self.child.assert_not_called()

    def test_idle_policy_and_activation_gate(self):
        idle = (ROOT / 'linux/home/.config/hypr/hypridle.conf').read_text()
        self.assertIn('timeout = 900', idle)
        self.assertIn('timeout = 1800', idle)
        self.assertIn('inhibit_sleep = 3', idle)
        self.assertNotIn('systemctl suspend', idle)
        for inhibitor in ('dbus', 'systemd', 'wayland'):
            self.assertIn(f'ignore_{inhibitor}_inhibit = false', idle)
        unit = (ROOT / 'linux/home/.config/systemd/user/hypr-session-idle.service').read_text()
        self.assertIn('ConditionPathExists=%h/.local/state/hypr-lock/idle-enabled', unit)
        self.assertNotIn('[Install]', unit)
        lua = (ROOT / 'linux/home/.config/hypr/hyprland.lua').read_text()
        conf = (ROOT / 'linux/home/.config/hypr/hyprland.conf').read_text()
        self.assertIn('idle_inhibit = "always"', lua)
        self.assertIn('idle_inhibit always, match:initial_title ^World of Warcraft$', conf)

    def test_lock_ui_cursor_layout_switch_and_uncapped_video(self):
        layout = (ROOT / 'linux/home/.config/hypr/hyprlock-layout.conf').read_text()
        video = (ROOT / 'linux/home/.config/hypr/hyprlock-video.conf').read_text()
        lua = (ROOT / 'linux/home/.config/hypr/hyprland.lua').read_text()
        conf = (ROOT / 'linux/home/.config/hypr/hyprland.conf').read_text()
        self.assertIn('hide_cursor = false', layout)
        self.assertIn('onclick = ~/.config/hypr/scripts/switch-keyboard-layout.sh', layout)
        self.assertEqual(layout.count('monitor = DP-3'), 6)
        self.assertIn('video_fps_cap = 0', video)
        self.assertIn('video_hwdec = no', video)
        self.assertIn('path = ~/Pictures/Wallpapers/Golden_Dark_60fps.mov', video)
        self.assertIn("MOVIE = HOME / 'Pictures/Wallpapers/Golden_Dark_60fps.mov'", SCRIPT.read_text())
        self.assertIn('hl.bind("CTRL + ALT + SPACE", hl.dsp.exec_cmd(home .. "/.config/hypr/scripts/switch-keyboard-layout.sh"), { locked = true })', lua)
        self.assertIn('bindl = CTRL ALT, SPACE, exec, ~/.config/hypr/scripts/switch-keyboard-layout.sh', conf)

    def test_panel_actions_in_both_variants(self):
        for name in ('config.json', 'config-light.json'):
            config = json.loads((ROOT / 'linux/home/.config/hyprpanel' / name).read_text())
            self.assertEqual(config['menus.dashboard.shortcuts.left.shortcut2.tooltip'], 'Lock')
            self.assertTrue(config['menus.dashboard.shortcuts.left.shortcut2.command'].endswith('session-control.py lock'))
            for key in ('menus.dashboard.powermenu.sleep', 'menus.power.sleep'):
                self.assertTrue(config[key].endswith('session-control.py suspend'))


if __name__ == '__main__':
    unittest.main()
