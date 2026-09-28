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
    def test_claude_links_cover_shared_skills(self):
        shared = ROOT / 'common/.agents/skills'
        claude = ROOT / 'common/.claude/skills'
        skills = sorted(shared.glob('*/SKILL.md'))
        self.assertTrue(skills)
        for skill in skills:
            with self.subTest(skill=skill.parent.name):
                link = claude / skill.parent.name
                self.assertTrue(link.is_symlink())
                self.assertFalse(Path(os.readlink(link)).is_absolute())
                self.assertEqual(link.resolve(strict=True), skill.parent.resolve())

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

    def test_shared_and_macos_dark_theme_defaults(self):
        config = ROOT / 'common/.config'
        macos = ROOT / 'macos/home/Library/Application Support'
        for path in (config / 'ghostty/config', macos / 'com.mitchellh.ghostty/config'):
            source = path.read_text()
            self.assertIn('theme = Catppuccin Mocha\n', source)
            self.assertIn('window-theme = dark\n', source)
        herdr = (config / 'herdr/config.toml').read_text()
        self.assertIn('name = "catppuccin"\n', herdr)
        self.assertIn('auto_switch = false\n', herdr)
        self.assertEqual(json.loads((config / 'opencode/cli.json').read_text())['theme'],
                         {'name': 'catppuccin', 'mode': 'dark'})
        self.assertIn('color_theme = "catppuccin_mocha"',
                      (config / 'btop/btop.conf').read_text())
        self.assertTrue((config / 'btop/themes/catppuccin_mocha.theme').is_file())
        self.assertEqual((config / 'starship.toml').read_text(),
                         (config / 'starship-dark.toml').read_text())
        for base in (config, macos):
            self.assertEqual((base / 'lazydocker/config.yml').read_text(),
                             (config / 'lazydocker/dark/config.yml').read_text())
            lazygit = (base / 'lazygit/config.yml').read_text()
            self.assertEqual('gui:\n' + lazygit.split('gui:\n', 1)[1],
                             (config / 'lazygit/theme-dark.yml').read_text())
            self.assertIn('mode: "rebase"', lazygit)

    def test_fish_mocha_colors_in_isolated_shell(self):
        fish = shutil.which('fish')
        if not fish:
            self.skipTest('fish unavailable')
        with tempfile.TemporaryDirectory() as directory:
            env = {'HOME': directory, 'PATH': '/usr/bin:/bin',
                   'XDG_CONFIG_HOME': directory + '/config'}
            source = ROOT / 'common/.config/fish/conf.d/colors.fish'
            command = (f'source "{source}"; '
                       'printf "%s\\n" $fish_color_normal $fish_color_keyword '
                       '$fish_pager_color_selected_background')
            result = subprocess.run([fish, '--no-config', '-c', command], env=env,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines(),
                             ['cdd6f4', 'b4befe', '--background=45475a'])

    def test_browser_themes_use_mocha_with_lavender(self):
        for name in ('soft-lavender', 'soft-lavender-helium'):
            path = ROOT / 'common/.local/share/browser-themes' / name / 'manifest.json'
            manifest = json.loads(path.read_text())
            self.assertEqual(manifest['version'], '2.0.0')
            colors = manifest['theme']['colors']
            self.assertEqual(colors['toolbar'], [30, 30, 46])
            self.assertEqual(colors['ntp_background'], [30, 30, 46])
            self.assertEqual(colors['ntp_link'], [180, 190, 254])
            for color in colors.values():
                self.assertEqual(len(color), 3)
                self.assertTrue(all(isinstance(value, int) and 0 <= value <= 255
                                    for value in color))

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
