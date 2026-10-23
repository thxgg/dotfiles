"""Offline T3 desktop updater tests. Never download or execute an AppImage."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('updater', ROOT / 'scripts/update-t3-desktop.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
OLD = '0.1.2-nightly.20261022.3526'
NEW = '0.1.3-nightly.20261023.3566'
PAYLOAD = b'\x7fELF\x02\x01\x01\x00AI\x02synthetic appimage'


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t3 test ')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.apps = self.home / 'Applications'
        self.apps.mkdir()
        self.old = self.install(OLD)
        self.fetches = []
        self.transfers = []
        self.release = self.make_release(NEW)
        self.environment = patch.dict(os.environ, {'T3CODE_HOME': str(self.home / '.t3')})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def install(self, version, arch='x86_64', payload=PAYLOAD):
        path = self.apps / f'T3-Code-{version}-{arch}.AppImage'
        path.write_bytes(payload)
        path.chmod(0o755)
        return path

    def make_release(self, version, arch='x86_64'):
        name = f'T3-Code-{version}-{arch}.AppImage'
        return {'tag_name': 'v' + version, 'draft': False, 'assets': [{
            'name': name, 'digest': 'sha256:' + hashlib.sha256(PAYLOAD).hexdigest(),
            'size': len(PAYLOAD),
            'browser_download_url': updater.DOWNLOAD + 'v' + version + '/' + name,
        }]}

    def fetch(self, url):
        self.fetches.append(url)
        return self.release if url.endswith('/latest') else [self.release]

    def transfer(self, url, target):
        self.transfers.append(url)
        target.write_bytes(PAYLOAD)

    def run_update(self, **kwargs):
        output = io.StringIO()
        with redirect_stdout(output):
            updater.update(self.home, machine='x86_64', system='Linux',
                           fetch=self.fetch, transfer=kwargs.pop('transfer', self.transfer), **kwargs)
        return output.getvalue()

    def assert_untouched(self):
        self.assertEqual(list(self.apps.iterdir()), [self.old])
        self.assertEqual(self.old.read_bytes(), PAYLOAD)

    def test_verified_atomic_install_preserves_old_and_is_idempotent(self):
        output = self.run_update()
        target = self.apps / self.release['assets'][0]['name']
        self.assertEqual(target.read_bytes(), PAYLOAD)
        self.assertTrue(os.access(target, os.X_OK))
        self.assertEqual(self.old.read_bytes(), PAYLOAD)
        self.assertIn('quit and relaunch', output)
        self.assertIn('already installed', self.run_update())
        self.assertEqual(len(self.transfers), 1)
        self.assertEqual(len(list(self.apps.iterdir())), 2)

    def test_missing_installation_and_other_platform_do_not_fetch(self):
        self.old.unlink()
        self.run_update()
        updater.update(self.home, system='Darwin', fetch=self.fetch)
        self.assertFalse(self.fetches)
        self.assertEqual(list(self.apps.iterdir()), [])

    def test_stable_uses_latest_endpoint_and_ignores_nightly(self):
        self.old.unlink()
        self.old = self.install('0.1.2')
        self.release = self.make_release('0.1.3')
        self.run_update()
        self.assertEqual(self.fetches, [updater.API + '/latest'])

    def test_arm64_asset_selection(self):
        self.old.unlink()
        self.old = self.install(OLD, 'arm64')
        self.release = self.make_release(NEW, 'arm64')
        updater.update(self.home, machine='aarch64', system='Linux',
                       fetch=self.fetch, transfer=self.transfer)
        self.assertTrue((self.apps / self.release['assets'][0]['name']).exists())

    def test_preview_and_explicit_channel_switch_are_rejected_before_network(self):
        settings = self.home / '.t3/userdata/desktop-settings.json'
        settings.parent.mkdir(parents=True)
        settings.write_text(json.dumps({'updateChannel': 'latest'}))
        with self.assertRaisesRegex(ValueError, 'switch channels'):
            self.run_update()
        settings.unlink()
        self.old.unlink()
        self.old = self.install('0.1.3-preview.12')
        with self.assertRaisesRegex(ValueError, 'preview'):
            self.run_update()
        self.assertFalse(self.fetches)
        self.assert_untouched()

    def test_matching_channel_setting_is_accepted(self):
        settings = self.home / '.t3/userdata/desktop-settings.json'
        settings.parent.mkdir(parents=True)
        settings.write_text(json.dumps({'updateChannel': 'nightly'}))
        self.run_update()
        self.assertEqual(len(self.transfers), 1)

    def test_no_downgrade(self):
        self.release = self.make_release('0.1.1-nightly.20261021.1')
        self.assertIn('keeping newer', self.run_update())
        self.assertFalse(self.transfers)
        self.assert_untouched()

    def test_numeric_version_order(self):
        self.assertGreater(updater.version_key('0.1.3-nightly.20261023.100'),
                           updater.version_key('0.1.3-nightly.20261023.99'))

    def test_paginated_channel_selection_skips_drafts_and_other_channels(self):
        calls = []
        draft = {**self.release, 'draft': True}
        def fetch(url):
            calls.append(url)
            return [draft, self.make_release('0.2.0')] if len(calls) == 1 else [self.release]
        version, _ = updater.latest_release('nightly', fetch)
        self.assertEqual(version, NEW)
        self.assertEqual(len(calls), 2)

    def test_missing_release_or_asset_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'No published'):
            updater.latest_release('nightly', lambda url: [])
        self.release['assets'] = []
        with self.assertRaisesRegex(ValueError, 'Missing or ambiguous'):
            self.run_update()
        self.assert_untouched()

    def test_missing_digest_or_unexpected_url_fails_before_download(self):
        for field, value in [('digest', None), ('browser_download_url', 'https://example.invalid/app')]:
            with self.subTest(field=field):
                self.release = self.make_release(NEW)
                self.release['assets'][0][field] = value
                with self.assertRaises(ValueError):
                    self.run_update()
                self.assertFalse(self.transfers)
                self.assert_untouched()

    def test_corrupt_download_and_transfer_failure_clean_up(self):
        def corrupt(url, target):
            target.write_bytes(b'bad download')
        def interrupted(url, target):
            target.write_bytes(b'partial')
            raise OSError('connection lost')
        for transfer, error in [(corrupt, ValueError), (interrupted, OSError)]:
            with self.subTest(transfer=transfer.__name__):
                with self.assertRaises(error):
                    self.run_update(transfer=transfer)
                self.assert_untouched()

    def test_verified_non_appimage_or_wrong_size_is_rejected(self):
        self.release['assets'][0]['size'] += 1
        with self.assertRaisesRegex(ValueError, 'size'):
            self.run_update()
        self.assert_untouched()
        bad = b'not an appimage'
        self.release['assets'][0].update(size=len(bad), digest='sha256:' + hashlib.sha256(bad).hexdigest())
        with self.assertRaisesRegex(ValueError, 'type-2 AppImage'):
            self.run_update(transfer=lambda url, target: target.write_bytes(bad))
        self.assert_untouched()

    def test_existing_target_is_not_overwritten(self):
        target = self.install(NEW, payload=b'local contents')
        with self.assertRaisesRegex(ValueError, 'left unchanged'):
            self.run_update()
        self.assertEqual(target.read_bytes(), b'local contents')
        self.assertFalse(self.transfers)

    def test_symlink_target_is_not_overwritten(self):
        target = self.apps / self.release['assets'][0]['name']
        target.symlink_to(self.old)
        with self.assertRaisesRegex(ValueError, 'left unchanged'):
            self.run_update()
        self.assertTrue(target.is_symlink())
        self.assertEqual(self.old.read_bytes(), PAYLOAD)

    def test_native_updater_race_does_not_overwrite_target(self):
        target = self.apps / self.release['assets'][0]['name']
        def race(url, temporary):
            temporary.write_bytes(PAYLOAD)
            target.write_bytes(b'other updater')
        with self.assertRaises(FileExistsError):
            self.run_update(transfer=race)
        self.assertEqual(target.read_bytes(), b'other updater')
        self.assertEqual(len(list(self.apps.iterdir())), 2)

    def test_dot_routes_desktop_without_cli_and_propagates_either_failure(self):
        source = (ROOT / 'dot').read_text()
        function = 'update_t3() {' + source.split('update_t3() {', 1)[1].split('\n}\n', 1)[0] + '\n}\n'
        for cli in (0, 1):
            for cli_failure, desktop_failure in ((0, 0), (1, 0), (0, 1)):
                body = f'''set -euo pipefail
warn() {{ :; }}
command_exists() {{ return {1-cli}; }}
t3() {{ print cli; return {cli_failure}; }}
update_t3_desktop() {{ print desktop; return {desktop_failure}; }}
{function}
update_t3
'''
                result = subprocess.run(['zsh', '-f', '-c', body], text=True, capture_output=True,
                                        env={'HOME': str(self.home), 'PATH': '/usr/bin:/bin'})
                self.assertEqual(result.returncode, int(bool((cli and cli_failure) or desktop_failure)))
                self.assertEqual(result.stdout.splitlines(), ['cli', 'desktop'] if cli else ['desktop'])


if __name__ == '__main__':
    unittest.main()
