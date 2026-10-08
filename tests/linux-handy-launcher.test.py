#!/usr/bin/env python3
"""Isolated launcher checks. Never start Handy or access the desktop/audio bus."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / 'linux/home/.config/handy-launcher/launch'
DESKTOP = ROOT / 'linux/home/.local/share/applications/Handy.desktop'


@unittest.skipUnless(shutil.which('cc'), 'A C compiler is required')
class HandyLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.env = {
            'HOME': str(self.home),
            'PATH': f'{self.bin}:/usr/bin:/bin',
            'XDG_CACHE_HOME': str(self.home / 'cache'),
            'APPIMAGE': '/wrong/parent.AppImage',
            'APPDIR': '/wrong/appdir',
            'OWD': '/wrong/directory',
        }
        (self.bin / 'handy').write_text('''#!/usr/bin/python3
import json, os, sys
print(json.dumps({"args": sys.argv[1:], "env": {k: os.environ.get(k) for k in
    ["APPIMAGE", "APPDIR", "OWD", "WEBKIT_DISABLE_DMABUF_RENDERER", "LD_PRELOAD", "HANDY_DISABLE_UPDATER"]}}))
''')
        (self.bin / 'handy').chmod(0o755)

    def run_launcher(self, *args, **extra):
        return subprocess.run([str(LAUNCHER), *args], env=self.env | extra,
                              text=True, capture_output=True)

    def test_launch_arguments_environment_and_cache_reuse(self):
        first = self.run_launcher('--start-hidden', 'two words')
        self.assertEqual(first.returncode, 0, first.stderr)
        result = json.loads(first.stdout)
        self.assertEqual(result['args'], ['--start-hidden', 'two words'])
        for key in ('APPIMAGE', 'APPDIR', 'OWD'):
            self.assertIsNone(result['env'][key])
        self.assertEqual(result['env']['WEBKIT_DISABLE_DMABUF_RENDERER'], '0')
        library = Path(result['env']['LD_PRELOAD'])
        self.assertTrue(library.is_file())
        before = library.stat().st_mtime_ns
        (self.bin / 'cc').write_text('#!/bin/sh\nexit 99\n')
        (self.bin / 'cc').chmod(0o755)
        second = self.run_launcher('--toggle-transcription')
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(library.stat().st_mtime_ns, before)

    def test_shim_blocks_only_renderer_variable(self):
        result = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stderr)
        library = json.loads(result.stdout)['env']['LD_PRELOAD']
        source = self.home / 'probe.c'
        source.write_text('''#include <assert.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    assert(setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1", 1) == 0);
    assert(strcmp(getenv("WEBKIT_DISABLE_DMABUF_RENDERER"), "0") == 0);
    assert(setenv("HANDY_TEST", "first", 1) == 0);
    assert(setenv("HANDY_TEST", "second", 0) == 0);
    assert(strcmp(getenv("HANDY_TEST"), "first") == 0);
    assert(setenv("HANDY_TEST", "second", 1) == 0);
    assert(strcmp(getenv("HANDY_TEST"), "second") == 0);
    return 0;
}
''')
        probe = self.home / 'probe'
        subprocess.run(['cc', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(probe)],
                       env=self.env, check=True)
        subprocess.run([str(probe)], env=self.env | {
            'LD_PRELOAD': library, 'WEBKIT_DISABLE_DMABUF_RENDERER': '0'}, check=True)

    def test_private_build_selection_and_packaged_fallback(self):
        custom = self.home / '.local/share/handy-catppuccin/current/bin/handy'
        custom.parent.mkdir(parents=True)
        shutil.copy2(self.bin / 'handy', custom)
        result = self.run_launcher('--start-hidden')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['env']['HANDY_DISABLE_UPDATER'], '1')
        packaged = self.run_launcher(HANDY_USE_PACKAGED='1')
        self.assertEqual(packaged.returncode, 0, packaged.stderr)
        self.assertIsNone(json.loads(packaged.stdout)['env']['HANDY_DISABLE_UPDATER'])
        custom.unlink()
        fallback = self.run_launcher()
        self.assertEqual(fallback.returncode, 0, fallback.stderr)
        self.assertIsNone(json.loads(fallback.stdout)['env']['HANDY_DISABLE_UPDATER'])

    def test_opt_out_needs_no_build(self):
        result = self.run_launcher('--start-hidden', HANDY_DMABUF_WORKAROUND='0')
        self.assertEqual(result.returncode, 0, result.stderr)
        env = json.loads(result.stdout)['env']
        self.assertIsNone(env['LD_PRELOAD'])
        self.assertIsNone(env['APPIMAGE'])
        self.assertFalse((self.home / 'cache').exists())

    def test_build_failure_does_not_launch_or_leave_library(self):
        (self.bin / 'cc').write_text('#!/bin/sh\nexit 99\n')
        (self.bin / 'cc').chmod(0o755)
        result = self.run_launcher()
        self.assertEqual(result.returncode, 99)
        self.assertEqual(result.stdout, '')
        self.assertEqual(list((self.home / 'cache/handy-launcher').iterdir()), [])

    def test_reject_loader_unsafe_cache_paths(self):
        for name in ('has space', 'has:colon'):
            with self.subTest(name=name):
                result = self.run_launcher(XDG_CACHE_HOME=str(self.home / name))
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.home / name).exists())

    def test_desktop_entry_parses_and_launches_wrapper(self):
        subprocess.run(['desktop-file-validate', str(DESKTOP)], check=True, env=self.env)
        # Use the same GLib parser as desktop launchers, but run only our mock.
        config = self.home / '.config/handy-launcher'
        config.mkdir(parents=True)
        shutil.copy2(self.bin / 'handy', config / 'launch')
        script = '''from gi.repository import Gio, GLib
import subprocess, sys
app = Gio.DesktopAppInfo.new_from_filename(sys.argv[1])
ok, argv = GLib.shell_parse_argv(app.get_commandline())
assert ok
sys.exit(subprocess.run(argv).returncode)
'''
        result = subprocess.run(['/usr/bin/python3', '-c', script, str(DESKTOP)],
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['args'], [])

    def test_hyprland_entries_use_wrapper(self):
        for name in ('hyprland.lua', 'hyprland.conf'):
            config = (ROOT / 'linux/home/.config/hypr' / name).read_text()
            self.assertIn('/.config/handy-launcher/launch --start-hidden', config)
            self.assertIn('/.config/handy-launcher/launch --toggle-transcription', config)
            self.assertNotIn('exec_cmd("handy --toggle-transcription")', config)


if __name__ == '__main__':
    unittest.main()
