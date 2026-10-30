"""Offline Merino palette and configuration checks. No live app reloads."""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

try:
    import tomllib
except ImportError:
    tomllib = None  # Python 3.11+ is needed for the TOML parser checks.

ROOT = Path(__file__).resolve().parents[1]
COMMON = ROOT / 'common'
PALETTE = json.loads((COMMON / '.local/share/merino/palette.json').read_text())


def read(path):
    return (ROOT / path).read_text()


class MerinoTests(unittest.TestCase):
    def test_ghostty_source_colors(self):
        for mode in ('dark', 'light'):
            p = PALETTE[mode]
            source = read(f'common/.config/ghostty/themes/Merino {mode.title()}')
            actual = dict(re.findall(r'^palette = (\d+)=(#[0-9a-f]{6})$', source, re.M))
            self.assertEqual(actual, {str(i): color for i, color in enumerate(p['ansi'])})
            for key, role in {'background': 'background', 'foreground': 'foreground',
                              'cursor-color': 'cursor', 'cursor-text': 'cursorText',
                              'selection-background': 'selectionBackground',
                              'selection-foreground': 'selectionForeground',
                              'split-divider-color': 'border'}.items():
                self.assertIn(f'{key} = {p[role]}\n', source)

    @unittest.skipIf(tomllib is None, 'TOML checks require Python 3.11+')
    def test_starship_and_btop_variants(self):
        for mode in ('dark', 'light'):
            p = PALETTE[mode]
            starship = tomllib.loads(read(f'common/.config/starship-{mode}.toml'))
            self.assertEqual(starship['palette'], f'merino_{mode}')
            self.assertEqual(starship['palettes'][f'merino_{mode}']['accent'], p['accent'])
            btop = read(f'common/.config/btop/themes/merino_{mode}.theme')
            tokens = dict(re.findall(r'^theme\[(\w+)\]="(#[0-9a-f]{6})"$', btop, re.M))
            fallback = read('common/.config/btop/themes/catppuccin_mocha.theme')
            self.assertEqual(set(tokens), set(re.findall(r'^theme\[(\w+)\]', fallback, re.M)))
            self.assertEqual(tokens['main_bg'], p['background'])
            self.assertEqual(tokens['main_fg'], p['foreground'])
            self.assertEqual(tokens['hi_fg'], p['accent'])
        self.assertEqual(read('common/.config/starship.toml'), read('common/.config/starship-dark.toml'))

    def test_pi_and_opencode_tokens_resolve(self):
        for mode in ('dark', 'light'):
            p = PALETTE[mode]
            theme = json.loads(read(f'common/.pi/agent/themes/merino-{mode}.json'))
            self.assertEqual(theme['appearance'], mode)
            self.assertEqual(theme['vars']['base'], p['background'])
            self.assertEqual(theme['vars']['accent'], p['accent'])
            for value in theme['colors'].values():
                self.assertIn(value, theme['vars'])
        theme = json.loads(read('common/.config/opencode/themes/merino.json'))
        for mode in ('dark', 'light'):
            for value in theme['theme'].values():
                self.assertIn(value[mode], theme['defs'])
            self.assertEqual(theme['defs'][theme['theme']['background'][mode]], PALETTE[mode]['background'])
            self.assertEqual(theme['defs'][theme['theme']['primary'][mode]], PALETTE[mode]['accent'])

    @unittest.skipIf(tomllib is None, 'TOML checks require Python 3.11+')
    def test_herdr_custom_palette_and_browser_variants(self):
        config = tomllib.loads(read('common/.config/herdr/config.toml'))['theme']
        self.assertTrue(config['auto_switch'])
        for mode in ('dark', 'light'):
            p = PALETTE[mode]
            self.assertEqual(config[f'{mode}_name'], 'terminal')
            self.assertEqual(config['custom'][mode]['panel_bg'], p['background'])
            self.assertEqual(config['custom'][mode]['accent'], p['accent'])
            theme = json.loads(read(f'common/.local/share/browser-themes/merino-{mode}/manifest.json'))
            colors = theme['theme']['colors']
            rgb = lambda color: [int(color[i:i+2], 16) for i in (1, 3, 5)]
            self.assertEqual(colors['toolbar'], rgb(p['background']))
            self.assertEqual(colors['ntp_link'], rgb(p['accent']))
            for value in colors.values():
                self.assertEqual(len(value), 3)
                self.assertTrue(all(isinstance(x, int) and 0 <= x <= 255 for x in value))

    def test_linux_variants(self):
        for mode in ('dark', 'light'):
            p = PALETTE[mode]
            hypr = read(f'linux/home/.config/hypr/merino-{mode}.conf')
            self.assertIn(f'$accent = rgb({p["accent"][1:]})', hypr)
            lua = read(f'linux/home/.config/hypr/merino-{mode}.lua')
            self.assertIn(f'accent = 0xff{p["accent"][1:]}', lua)
            rofi = read(f'linux/home/.config/rofi/merino-{mode}.rasi')
            self.assertIn(f'base: {p["background"]};', rofi)
            wofi = read(f'linux/home/.config/wofi/style-{mode}.css')
            self.assertIn(f'@define-color base {p["background"]};', wofi)
            self.assertIn(f'@define-color lavender {p["accent"]};', wofi)

    def test_fish_both_variants_in_temporary_home(self):
        fish = shutil.which('fish')
        if not fish:
            self.skipTest('fish unavailable')
        with tempfile.TemporaryDirectory() as home:
            env = {'HOME': home, 'PATH': '/usr/bin:/bin', 'XDG_CONFIG_HOME': home + '/config'}
            for mode in ('dark', 'light'):
                path = COMMON / f'.config/fish/colors/merino-{mode}.fish'
                command = f'source "{path}"; printf "%s\\n" $fish_color_normal $fish_color_keyword'
                result = subprocess.run([fish, '--no-config', '-c', command], env=env,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines(),
                                 [PALETTE[mode]['foreground'][1:], PALETTE[mode]['accent'][1:]])

    def test_starship_character_with_real_parser(self):
        starship = shutil.which('starship')
        if not starship:
            self.skipTest('starship unavailable')
        with tempfile.TemporaryDirectory() as home:
            for mode in ('dark', 'light'):
                env = {'HOME': home, 'PATH': '/usr/bin:/bin', 'TERM': 'xterm-256color',
                       'STARSHIP_CONFIG': str(COMMON / f'.config/starship-{mode}.toml'),
                       'STARSHIP_CACHE': home + '/cache'}
                result = subprocess.run([starship, 'module', 'character'], cwd=home,
                                        env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, '')
                rgb = [int(PALETTE[mode]['accent'][i:i+2], 16) for i in (1, 3, 5)]
                self.assertIn('38;2;' + ';'.join(map(str, rgb)), result.stdout)

    def test_nvim_in_temporary_home(self):
        nvim = shutil.which('nvim')
        if not nvim:
            self.skipTest('nvim unavailable')
        with tempfile.TemporaryDirectory() as home:
            env = {'HOME': home, 'PATH': '/usr/bin:/bin', 'DOTFILES_TEST_ROOT': str(ROOT),
                   'XDG_CONFIG_HOME': home + '/config', 'XDG_DATA_HOME': home + '/data',
                   'XDG_CACHE_HOME': home + '/cache', 'XDG_STATE_HOME': home + '/state'}
            # Optional read-only plugin source. Its compiled cache stays in the temporary home.
            if os.environ.get('MERINO_CATPPUCCIN_PATH'):
                env['MERINO_CATPPUCCIN_PATH'] = os.environ['MERINO_CATPPUCCIN_PATH']
            result = subprocess.run([nvim, '--clean', '--headless', '-l',
                                     str(ROOT / 'tests/merino-nvim.test.lua')], env=env,
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
