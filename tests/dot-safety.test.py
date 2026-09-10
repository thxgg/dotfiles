"""Offline CLI tests; no real links, package database, or update commands."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'dot').read_text()
ZSH = shutil.which('zsh')


def function(name):
    return name + '() {' + SOURCE.split(name + '() {', 1)[1].split('\n}\n', 1)[0] + '\n}\n'


class DotSafety(unittest.TestCase):
    def test_unlink_preserves_unrelated_links_and_honors_custom_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / 'repo'
            repo.mkdir()
            (repo / 'dot').touch()
            bindir = root / 'custom bin'
            bindir.mkdir()
            link = bindir / 'dot'
            other = root / 'other-link'
            other.symlink_to('/unrelated/tool')
            fn = function('cmd_unlink').replace('"/usr/local/bin/dot"', '"$HOME/other-link"').replace('"/opt/homebrew/bin/dot"', '"$HOME/absent"')
            body = 'set -euo pipefail\nheader() { :; }; success() { :; }; warn() { :; };\n' + fn + '\ncmd_unlink'
            env = {'HOME': directory, 'PATH': '/usr/bin:/bin', 'DOTFILES_DIR': str(repo), 'DOTFILES_BIN_DIR': str(bindir)}
            for target in (str(repo / 'dot'), '../repo/dot'):
                link.symlink_to(target)
                result = subprocess.run([ZSH, '-f', '-c', body], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(link.is_symlink())
                self.assertTrue(other.is_symlink())

    def test_package_check_matches_bootstrap_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profiles = root / 'linux/packages'
            profiles.mkdir(parents=True)
            (profiles/'core-cli.txt').write_text('redis\nfish\n')
            common = 'set -euo pipefail\nOSTYPE=linux-gnu\nheader() { :; }; success() { :; }; warn() { :; }; error() { :; }; command_exists() { return 0; };\n'
            for redis_available, expected in ((False, 'valkey'), (True, 'redis')):
                mock = f'''pacman() {{
 if [[ "$1" == -Si ]]; then
  [[ "$2" == valkey ]] && return 0
  return {0 if redis_available else 1}
 fi
 [[ "$1" == -Q && ( "$2" == {expected} || "$2" == fish ) ]]
}}
'''
                result = subprocess.run([ZSH, '-f', '-c', common + mock + function('cmd_check_packages') + '\ncmd_check_packages'], env={'HOME': directory, 'PATH': '/usr/bin:/bin', 'DOTFILES_DIR': directory, 'OSTYPE': 'linux-gnu'}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_update_does_not_apply_theme(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory)/'.local/bin/theme-mode'
            fake.parent.mkdir(parents=True)
            fake.write_text('#!/bin/sh\nexit 99\n')
            fake.chmod(0o755)
            body = '''set -euo pipefail
header() { :; }; success() { :; }; warn() { :; }; error() { :; };
run_update_step() { printf '%s\\n' "$1"; }
'''+ function('cmd_update') + '\ncmd_update --skip-packages --skip-stow --skip-pi --skip-herdr --skip-nvim'
            result = subprocess.run([ZSH, '-f', '-c', body], env={'HOME': directory, 'PATH': '/usr/bin:/bin', 'OSTYPE': 'darwin', 'UPDATE_VERBOSE': '0'}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'repo')


if __name__ == '__main__':
    unittest.main()
