"""Isolated shared configuration checks. No live editor plugins or shell startup."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CommonConfigTests(unittest.TestCase):
    def test_retired_configuration_is_absent(self):
        self.assertFalse((ROOT / 'common/.config/amp').exists())
        self.assertFalse((ROOT / 'common/.config/fish/conf.d/theme.fish').exists())
        for name in ('btop', 'starship', 'lazygit', 'lazydocker', 'rofi', 'wofi',
                     'theme-mode', 'theme-lib.sh', 'catppuccin-macos-theme-setup',
                     'catppuccin-nighttab-lavender'):
            self.assertFalse((ROOT / 'common/.local/bin' / name).exists(), name)
        for name in ('config.json', 'config-light.json'):
            panel = json.loads((ROOT / 'linux/home/.config/hyprpanel' / name).read_text())
            self.assertNotIn('theme-mode', json.dumps(panel))
        for name in ('start-hyprpanel.sh', 'teams-tray.py'):
            source = (ROOT / 'linux/home/.config/hypr/scripts' / name).read_text()
            self.assertNotIn('theme/mode', source)

    def test_hyprland_uses_installed_launchers_and_static_wofi_style(self):
        style = ROOT / 'linux/home/.config/wofi/style-dark.css'
        self.assertTrue(style.is_file())
        pipelines = []
        for name in ('hyprland.conf', 'hyprland.lua'):
            source = (ROOT / 'linux/home/.config/hypr' / name).read_text()
            with self.subTest(config=name):
                self.assertNotIn('.local/bin/rofi', source)
                self.assertNotIn('.local/bin/wofi', source)
                self.assertIn('rofi -show drun', source)
                clipboard = [line.split('cliphist list | ', 1)[1]
                             for line in source.splitlines() if 'cliphist list | ' in line]
                self.assertEqual(len(clipboard), 2)
                for command in clipboard:
                    self.assertTrue(command.startswith(
                        'wofi --style "$HOME/.config/wofi/style-dark.css" --dmenu '))
                if name.endswith('.lua'):
                    clipboard = [command.removesuffix("'))") for command in clipboard]
                pipelines.append(clipboard)
        self.assertEqual(pipelines[0], pipelines[1])

    def test_history_uses_existing_home_directory(self):
        source = (ROOT / 'common/.psqlrc').read_text()
        self.assertIn(r'\set HISTFILE ~/.psql_history-:DBNAME', source)
        self.assertNotIn('.psql_history.d', source)

    def test_docker_path_is_guarded_and_idempotent(self):
        fish = shutil.which('fish')
        if not fish:
            self.skipTest('fish unavailable')
        source = (ROOT / 'common/.config/fish/config.fish').read_text()
        block = source.split('set __dotfiles_uname (uname)\n', 1)[1].split('\nend', 1)[0] + '\nend'
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / '.docker/bin').mkdir(parents=True)
            env = {'HOME': directory, 'PATH': '/usr/bin:/bin', 'XDG_CONFIG_HOME': str(home / '.config')}
            for platform, expected in [('Darwin', '1'), ('Linux', '0')]:
                command = f'set __dotfiles_uname {platform}\n{block}\n{block}\ncount (string match -- "$HOME/.docker/bin" $PATH)'
                result = subprocess.run([fish, '--no-config', '-c', command], env=env,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.stdout.strip(), expected, result.stderr)

    def test_editor_configuration_without_plugins(self):
        nvim = shutil.which('nvim')
        if not nvim:
            self.skipTest('nvim unavailable')
        with tempfile.TemporaryDirectory() as directory:
            env = {'HOME': directory, 'PATH': '/usr/bin:/bin', 'DOTFILES_TEST_ROOT': str(ROOT),
                   'XDG_CONFIG_HOME': directory + '/config', 'XDG_DATA_HOME': directory + '/data',
                   'XDG_STATE_HOME': directory + '/state', 'XDG_CACHE_HOME': directory + '/cache'}
            result = subprocess.run([nvim, '--clean', '--headless', '-l', str(ROOT / 'tests/common-config.test.lua')],
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
