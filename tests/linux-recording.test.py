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
    def test_stop_copies_original_path_and_offers_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "original ' recording.mp4"
            video.write_bytes(b'video')
            state = root / 'last-path'
            state.write_text(str(video))
            log = root / 'actions'
            helper = root / '.local/bin/hyprpanel-recording-action'
            helper.parent.mkdir(parents=True)
            helper.write_text('#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$ACTION_LOG"\n')
            helper.chmod(0o755)
            script = (ROOT / 'linux/home/.local/bin/hyprpanel-screen-record').read_text()
            script = script.replace('/tmp/last_recording_path', str(state))
            prelude = '''
pgrep() { printf '12345\\n'; }
kill() { [[ "$1" == -INT ]]; }
notify-send() { printf '%s\\n' "$@" > "$NOTIFY_LOG"; printf 'copy-path'; }
export -f pgrep kill notify-send
'''
            env = dict(os.environ, HOME=str(root), ACTION_LOG=str(log), NOTIFY_LOG=str(root/'notify'))
            result = subprocess.run(['bash', '-c', prelude + script, 'record', 'stop'],
                                    env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            # Background notification handling can finish after the parent.
            import time
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if log.exists() and 'copy-path' in log.read_text():
                    break
                time.sleep(0.01)
            token = os.fsencode(video).hex()
            self.assertEqual(log.read_text().splitlines(), [f'copy-file {token}', f'copy-path {token}'])
            self.assertIn('--action=copy-file=Copy File', (root/'notify').read_text())

    def test_still_running_never_copies(self):
        script = (ROOT / 'linux/home/.local/bin/hyprpanel-screen-record').read_text()
        prelude = '''
pgrep() { printf '12345\\n'; }
kill() { return 0; }
sleep() { :; }
notify-send() { printf '%s\\n' "$1"; }
'''
        result = subprocess.run(['bash', '-c', prelude + script, 'record', 'stop'],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Recording is still stopping', result.stdout)


if __name__ == '__main__':
    unittest.main()
