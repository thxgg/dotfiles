"""Isolated stow safety checks. All scripts run in a temporary repo and HOME.

Stow and dependency tools are mocks. These tests do not deploy live dotfiles.
Run: python3 tests/stow-safety.test.py
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ZSH = shutil.which('zsh')
SCRIPTS = ('safe-stow.sh', 'unstow.sh', 'doctor.sh')


@unittest.skipUnless(ZSH, 'zsh is required')
class StowSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='stow-safety-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo with spaces'
        self.home = self.base / 'home'
        self.bin = self.base / 'bin'
        self.log = self.base / 'tools.log'
        for directory in (self.repo, self.home, self.bin):
            directory.mkdir()
        for name in (*SCRIPTS, 'scripts/lib/stow-roots.zsh'):
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        self.put(self.repo / 'dot', '#!/bin/sh\nexit 0\n')
        self.put(self.repo / 'common/.config/nvim/init.lua', '-- fixture\n')
        self.put(self.repo / 'common/.codex/AGENTS.md', 'managed instructions\n')
        self.put(self.repo / 'common/.pi/agent/theme.json', '{}\n')
        self.put(self.repo / 'common/.pi/package-lock.json', '{}\n')
        (self.repo / 'common/.pi/node_modules').mkdir()
        # Keep full doctor runs isolated from all optional dependency probes.
        self.put(self.repo / 'scripts/lib/pi-transcribe.zsh',
                 'dotfiles_check_pi_transcribe() { print -r -- transcribe >> "$TOOL_LOG"; }\n')
        for name in ('stow', 'pi', 'vp', 'npm', 'amp', 'jq', 'git', 'ffmpeg'):
            tool = self.bin / name
            self.put(tool, '#!/bin/sh\n'
                     'printf "%s %s\\n" "${0##*/}" "$*" >> "$TOOL_LOG"\n'
                     'printf "mock-version\\n"\nexit 0\n')
            tool.chmod(0o755)
        # Do not inherit live agent paths, startup files, or package managers.
        self.env = {
            'HOME': str(self.home),
            'ZDOTDIR': str(self.home),
            'PATH': str(self.bin) + ':/usr/bin:/bin',
            'TOOL_LOG': str(self.log),
            'LC_ALL': 'C',
        }

    @staticmethod
    def put(path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    @staticmethod
    def link(path, target):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(target)
        return path

    @staticmethod
    def snapshot(root):
        """Record content and link text without following directory symlinks."""
        entries = {}
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                path = Path(directory) / name
                key = str(path.relative_to(root))
                if path.is_symlink():
                    entries[key] = ('link', os.readlink(path))
                elif path.is_dir():
                    entries[key] = ('directory', path.stat().st_mode)
                else:
                    entries[key] = ('file', path.read_bytes(), path.stat().st_mode)
        return entries

    def run_script(self, script, *args, expected=0):
        result = subprocess.run(
            [ZSH, '-f', str(self.repo / script), *args],
            cwd=self.repo, env=self.env, capture_output=True, text=True,
            timeout=20,
        )
        if expected is not None:
            self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def assert_no_tools(self):
        self.assertFalse(self.log.exists(), self.log.read_text() if self.log.exists() else '')

    def assert_no_backups(self):
        self.assertEqual(list(self.home.glob('.dotfiles_backup_*')), [])

    def backup(self, relative):
        backups = list(self.home.glob('.dotfiles_backup_*'))
        self.assertEqual(len(backups), 1)
        return backups[0] / relative

    def folded_pi(self):
        self.put(self.repo / 'common/.pi/agent/settings.json', '{"local":true}\n')
        self.put(self.repo / 'common/.pi/agent/sessions/session.json', 'local session\n')
        self.link(self.home / '.pi', self.repo / 'common/.pi')

    def test_empty_and_invalid_selections_are_read_only(self):
        self.folded_pi()
        self.link(self.home / '.config', self.repo / 'common/.config')
        before = self.snapshot(self.base)
        options = (
            ('--only-config',), ('--only-config', ''),
            ('--only-config', ' , \t, '), ('--only-config', 'missing'),
            ('--only-config', 'nvim,missing'),
            ('--only-config', 'nvim', '--only-config', ''),
            ('--list-config', '--only-config', 'nvim'),
            ('--list-config', '--only-config', ''),
        )
        for script in SCRIPTS:
            for args in options:
                with self.subTest(script=script, args=args):
                    result = self.run_script(script, *args, expected=1)
                    self.assertNotIn('parameter not set', result.stderr)
                    self.assertEqual(self.snapshot(self.base), before)
                    self.assert_no_tools()

    def test_listing_does_not_migrate_folded_pi_or_config(self):
        self.folded_pi()
        self.link(self.home / '.config', self.repo / 'common/.config')
        before = self.snapshot(self.base)
        for script in SCRIPTS:
            with self.subTest(script=script):
                result = self.run_script(script, '--list-config')
                self.assertIn('nvim (from common)', result.stdout)
                self.assertEqual(self.snapshot(self.base), before)
                self.assert_no_tools()

    def test_listing_does_not_detach_runtime_links(self):
        source = self.put(self.repo / 'common/.pi/agent/auth.json', 'local auth\n')
        self.link(self.home / '.pi/agent/auth.json', source)
        before = self.snapshot(self.base)
        self.run_script('safe-stow.sh', '--list-config')
        self.assertEqual(self.snapshot(self.base), before)

    def test_config_only_leaves_codex_and_pi_unchanged(self):
        self.folded_pi()
        self.put(self.home / '.codex/AGENTS.md', 'local instructions\n')
        pi_before = self.snapshot(self.repo / 'common/.pi')
        self.run_script('safe-stow.sh', '--only-config', ' nvim,nvim ')
        config = self.home / '.config/nvim'
        self.assertEqual(config.resolve(), self.repo / 'common/.config/nvim')
        self.assertEqual((self.home / '.codex/AGENTS.md').read_text(), 'local instructions\n')
        self.assertTrue((self.home / '.pi').is_symlink())
        self.assertEqual(self.snapshot(self.repo / 'common/.pi'), pi_before)
        self.run_script('doctor.sh', '--only-config', 'nvim')
        self.run_script('unstow.sh', '--only-config', 'nvim')
        self.assertFalse(config.is_symlink())
        self.assertTrue((self.home / '.pi').is_symlink())
        self.assertEqual((self.home / '.codex/AGENTS.md').read_text(), 'local instructions\n')
        self.assert_no_backups()
        self.assert_no_tools()

    def test_config_modes_ignore_duplicate_non_config_sources(self):
        # Both roots make this test independent of the host operating system.
        for root in ('macos/home', 'linux/home'):
            self.put(self.repo / root / '.codex/AGENTS.md', 'duplicate special leaf\n')
            self.put(self.repo / root / '.pi/agent/theme.json', 'duplicate Pi leaf\n')
        for script in SCRIPTS:
            with self.subTest(script=script):
                config = self.home / '.config/nvim'
                if not config.is_symlink():
                    self.link(config, self.repo / 'common/.config/nvim')
                self.run_script(script, '--list-config')
                self.run_script(script, '--only-config', 'nvim')
        self.assert_no_backups()
        self.assert_no_tools()

    def test_config_only_backs_up_only_selected_conflicts(self):
        self.put(self.repo / 'common/.config/ghostty/config', 'managed\n')
        self.put(self.home / '.config/ghostty/config', 'local\n')
        self.link(self.home / '.codex/AGENTS.md', self.base / 'missing-codex')
        target = self.link(self.home / '.config/nvim', self.base / 'missing-config')
        self.run_script('safe-stow.sh', '--only-config', 'nvim')
        self.assertEqual(os.readlink(self.backup('.config/nvim')), str(self.base / 'missing-config'))
        self.assertEqual(target.resolve(), self.repo / 'common/.config/nvim')
        self.assertEqual((self.home / '.config/ghostty/config').read_text(), 'local\n')
        self.assertEqual(os.readlink(self.home / '.codex/AGENTS.md'), str(self.base / 'missing-codex'))
        self.assert_no_tools()

    def test_full_deploy_backs_up_live_and_broken_leaf_symlinks(self):
        live = self.put(self.base / 'external', 'keep external data\n')
        conflicts = {}
        for kind, destination in (('live', live), ('broken', self.base / 'missing')):
            relative = '.example-' + kind
            self.put(self.repo / 'common' / relative, 'managed\n')
            self.link(self.home / relative, destination)
            conflicts[relative] = str(destination)
        self.link(self.home / '.codex/AGENTS.md', live)
        conflicts['.codex/AGENTS.md'] = str(live)
        self.link(self.home / '.local/bin/dot', self.base / 'missing-dot')
        conflicts['.local/bin/dot'] = str(self.base / 'missing-dot')
        self.run_script('safe-stow.sh')
        for relative, destination in conflicts.items():
            self.assertEqual(os.readlink(self.backup(relative)), destination)
        self.assertEqual(live.read_text(), 'keep external data\n')
        self.assertEqual((self.home / '.codex/AGENTS.md').resolve(), self.repo / 'common/.codex/AGENTS.md')
        self.assertEqual((self.home / '.local/bin/dot').resolve(), self.repo / 'dot')
        self.assertIn('stow --no-folding', self.log.read_text())

    def test_dot_live_directory_symlink_is_backed_up_not_followed(self):
        external = self.base / 'external-bin'
        external.mkdir()
        self.link(self.home / '.local/bin/dot', external)
        self.run_script('safe-stow.sh')
        self.assertEqual(os.readlink(self.backup('.local/bin/dot')), str(external))
        self.assertEqual(list(external.iterdir()), [])
        self.assertEqual((self.home / '.local/bin/dot').resolve(), self.repo / 'dot')

    def test_managed_links_are_not_backed_up(self):
        source = self.put(self.repo / 'common/.example', 'managed\n')
        self.link(self.home / '.example', source)
        self.link(self.home / '.codex/AGENTS.md', self.repo / 'common/.codex/AGENTS.md')
        self.link(self.home / '.config/nvim', self.repo / 'common/.config/nvim')
        dot = self.home / '.local/bin/dot'
        self.link(dot, os.path.relpath(self.repo / 'dot', dot.parent))
        dot_text = os.readlink(dot)
        self.run_script('safe-stow.sh')
        self.assert_no_backups()
        self.assertEqual((self.home / '.example').resolve(), source)
        self.assertFalse(os.path.isabs(os.readlink(self.home / '.example')))
        self.assertEqual(os.readlink(dot), dot_text)

    def test_managed_broken_source_link_is_not_backed_up(self):
        source = self.link(self.repo / 'common/.example', self.base / 'missing-source')
        target = self.link(self.home / '.example', source)
        self.run_script('safe-stow.sh')
        self.assert_no_backups()
        self.assertTrue(target.is_symlink())
        self.assertFalse(target.exists())

    def test_broken_codex_leaf_symlink_is_backed_up(self):
        target = self.link(self.home / '.codex/AGENTS.md', '../../missing-codex')
        self.run_script('safe-stow.sh')
        self.assertEqual(os.readlink(self.backup('.codex/AGENTS.md')), '../../missing-codex')
        self.assertEqual(target.resolve(), self.repo / 'common/.codex/AGENTS.md')

    def test_removes_only_owned_broken_legacy_pi_links(self):
        owned = self.home / '.pi/agent/mcp.json'
        expected = self.repo / 'common/.pi/agent/mcp.json'
        unrelated = self.link(self.home / '.pi/agent/extensions/pi-mcp', self.base / 'missing-external')
        for target in (str(expected), os.path.relpath(expected, owned.parent)):
            with self.subTest(target=target):
                self.link(owned, target)
                self.run_script('safe-stow.sh')
                self.assertFalse(owned.is_symlink())
                self.assertTrue(unrelated.is_symlink())
        self.assert_no_backups()

    def test_legacy_pi_tree_preserves_unowned_broken_links(self):
        relative = '.pi/agent/extensions/pi-mcp/index.ts'
        child = self.home / relative
        expected = self.repo / 'common' / relative
        self.link(child, os.path.relpath(expected, child.parent))
        unrelated = self.link(child.parent / 'local.ts', self.base / 'missing-local')
        self.run_script('safe-stow.sh')
        self.assertTrue(child.is_symlink())
        self.assertTrue(unrelated.is_symlink())
        unrelated.unlink()
        self.run_script('safe-stow.sh')
        self.assertFalse(child.parent.exists())

    def test_doctor_reports_broken_managed_pi_runtime_links(self):
        self.put(self.repo / 'common/.ssh/config', '# fixture\n')
        (self.home / '.ssh').mkdir()
        for relative in ('.pi/agent/auth.json', '.pi/agent/sessions'):
            target = self.home / relative
            expected = self.repo / 'common' / relative
            self.link(target, os.path.relpath(expected, target.parent))
        self.link(self.home / '.pi/agent/trust.json', self.base / 'missing-external')
        result = self.run_script('doctor.sh', expected=1)
        for relative in ('.pi/agent/auth.json', '.pi/agent/sessions'):
            self.assertIn('Machine-local Pi runtime path is still managed by Stow: ' + relative, result.stdout)
        self.assertNotIn('Machine-local Pi runtime path is still managed by Stow: .pi/agent/trust.json', result.stdout)

    def test_doctor_reports_broken_managed_pi_ancestor(self):
        self.put(self.repo / 'common/.ssh/config', '# fixture\n')
        (self.home / '.ssh').mkdir()
        shutil.rmtree(self.repo / 'common/.pi')
        target = self.home / '.pi'
        self.link(target, os.path.relpath(self.repo / 'common/.pi', target.parent))
        result = self.run_script('doctor.sh', expected=1)
        self.assertIn('Pi directory must be unfolded before runtime state can be local: .pi ->', result.stdout)

    def test_full_deploy_still_migrates_pi_runtime(self):
        self.folded_pi()
        self.run_script('safe-stow.sh')
        self.assertFalse((self.home / '.pi').is_symlink())
        self.assertEqual((self.home / '.pi/agent/settings.json').read_text(), '{"local":true}\n')
        self.assertEqual((self.home / '.pi/agent/sessions/session.json').read_text(), 'local session\n')
        self.assertFalse((self.repo / 'common/.pi/agent/settings.json').exists())
        self.assertFalse((self.repo / 'common/.pi/agent/sessions').exists())
        self.assertTrue((self.repo / 'common/.pi/agent/theme.json').exists())


if __name__ == '__main__':
    unittest.main()
