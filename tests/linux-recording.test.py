"""Portable tests. No real clipboard, desktop, or recorder is used."""
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
ACTION = ROOT / 'linux/home/.local/bin/hyprpanel-recording-action'
loader = importlib.machinery.SourceFileLoader('recording_action', str(ACTION))
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)


class RecordingActions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "clip ' ; $(touch nope) ü.mp4"
        self.path.write_bytes(b'video')
        self.token = os.fsencode(self.path).hex()

    def run_action(self, action, token=None):
        with patch('sys.argv', [str(ACTION), action, token or self.token]):
            return module.main()

    @patch.object(module.subprocess, 'run')
    def test_copy_file_uri_encodes_filename(self, run):
        self.assertEqual(self.run_action('copy-file'), 0)
        run.assert_called_once_with(['wl-copy', '--type', 'text/uri-list'],
                                    input=(self.path.as_uri() + '\r\n').encode(), check=True)

    @patch.object(module.subprocess, 'run')
    def test_copy_path_is_plain_text(self, run):
        self.assertEqual(self.run_action('copy-path'), 0)
        run.assert_called_once_with(['wl-copy', '--type', 'text/plain;charset=utf-8'],
                                    input=os.fsencode(self.path), check=True)

    @patch.object(module.subprocess, 'run')
    def test_old_notification_uses_original_path(self, run):
        other = Path(self.temp.name) / 'new.mp4'
        other.write_bytes(b'new')
        self.assertEqual(self.run_action('play'), 0)
        run.assert_called_once_with(['xdg-open', str(self.path)], check=True)

    @patch.object(module.subprocess, 'run')
    def test_directory_uses_no_shell(self, run):
        self.assertEqual(self.run_action('directory'), 0)
        run.assert_called_once_with(['nautilus', '--select', str(self.path)], check=True)

    @patch.object(module.subprocess, 'run')
    def test_invalid_or_missing_paths(self, run):
        self.assertEqual(self.run_action('play', 'not-hex'), 1)
        self.path.unlink()
        self.assertEqual(self.run_action('copy-file'), 1)
        run.assert_not_called()

    @patch.object(module.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'wl-copy'))
    def test_clipboard_failure_propagates(self, run):
        self.assertEqual(self.run_action('copy-path'), 1)


class RecordingStop(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.video = self.root / "original ' recording.mp4"
        self.video.write_bytes(b'video')
        state = self.root / 'last-path'
        state.write_text(str(self.video))
        self.log = self.root / 'actions'
        self.log.touch()
        helper = self.root / '.local/bin/hyprpanel-recording-action'
        helper.parent.mkdir(parents=True)
        helper.write_text('#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$ACTION_LOG"\n')
        helper.chmod(0o755)
        self.script = (ROOT / 'linux/home/.local/bin/hyprpanel-screen-record').read_text()
        self.script = self.script.replace('/tmp/last_recording_path', str(state))
        # Do not inherit BASH_ENV, exported functions, or desktop session state.
        self.env = {
            'HOME': str(self.root),
            'PATH': '/usr/bin:/bin',
            'ACTION_LOG': str(self.log),
            'NOTIFY_LOG': str(self.root / 'notify'),
        }

    def run_stop(self, prelude):
        return subprocess.run(['bash', '--noprofile', '--norc', '-c',
                               prelude + self.script, 'record', 'stop'],
                              env=self.env, capture_output=True, text=True, timeout=5)

    def test_stop_copies_original_path_and_offers_actions(self):
        prelude = '''
pgrep() { printf '12345\\n'; }
kill() { [[ "$1" == -INT ]]; }
notify-send() { printf '%s\\n' "$@" > "$NOTIFY_LOG"; printf 'copy-path'; }
export -f pgrep kill notify-send
'''
        result = self.run_stop(prelude)
        self.assertEqual(result.returncode, 0, result.stderr)
        # Background notification handling can finish after the parent.
        import time
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if 'copy-path' in self.log.read_text():
                break
            time.sleep(0.01)
        token = os.fsencode(self.video).hex()
        self.assertEqual(self.log.read_text().splitlines(), [f'copy-file {token}', f'copy-path {token}'])
        self.assertIn('--action=copy-file=Copy File', (self.root / 'notify').read_text())

    def test_still_running_never_copies(self):
        prelude = '''
pgrep() { printf '12345\\n'; }
kill() { return 0; }
sleep() { :; }
notify-send() { printf '%s\\n' "$1"; }
'''
        result = self.run_stop(prelude)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('Recording is still stopping', result.stdout)
        self.assertEqual(self.log.read_text(), '')


if __name__ == '__main__':
    unittest.main()
