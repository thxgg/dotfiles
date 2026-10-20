"""Portable tests. No real clipboard, desktop, or recorder is used."""
import importlib.machinery
import importlib.util
import json
import os
import shutil
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


class RecordingStart(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = self.root / 'recorder-args.json'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        recorder = self.bin / 'wf-recorder'
        recorder.write_text('''#!/usr/bin/python3
import json, os, sys
with open(os.environ['RECORDER_LOG'], 'w') as log:
    json.dump(sys.argv[1:], log)
''')
        recorder.chmod(0o755)
        # Match upstream's Bash invocation, including its fixed RGB codec.
        upstream = self.root / 'upstream'
        upstream.write_text('''#!/usr/bin/env bash
set -eu
if [[ "$1" == status ]]; then echo 'not recording'; exit; fi
filters=()
if [[ -n "${TEST_FILTER:-}" ]]; then filters=(-F "$TEST_FILTER"); fi
wf-recorder --audio=test.monitor -c libx264rgb "${filters[@]}" \\
    --geometry '10,20 65x49' --file "$2/clip with spaces.mp4"
''')
        upstream.chmod(0o755)
        script = (ROOT / 'linux/home/.local/bin/hyprpanel-screen-record').read_text()
        self.script = script.replace('/usr/share/hyprpanel/scripts/screen_record.sh', str(upstream))
        self.env = {
            'HOME': str(self.root),
            'PATH': f'{self.bin}:/usr/bin:/bin',
            'RECORDER_LOG': str(self.log),
        }

    def run_start(self, rotation=''):
        result = subprocess.run(
            ['bash', '--noprofile', '--norc', '-c', self.script, 'record', 'start', str(self.root)],
            env={**self.env, 'TEST_FILTER': rotation}, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(self.log.read_text())

    def test_start_overrides_rgb_and_preserves_arguments(self):
        args = self.run_start()
        self.assertEqual(args[:8], ['--audio=test.monitor', '-c', 'libx264rgb',
                                   '--geometry', '10,20 65x49', '--file',
                                   str(self.root / 'clip with spaces.mp4'), '-c'])
        self.assertEqual(args[8:11], ['libx264', '-x', 'yuv420p'])
        params = [args[i + 1] for i, arg in enumerate(args) if arg == '-p']
        self.assertEqual(params, ['color_range=tv', 'colorspace=bt709',
                                 'color_primaries=bt709', 'color_trc=iec61966-2-1'])
        self.assertEqual(args.count('-F'), 1)
        self.assertEqual(args[-1], 'pad=ceil(iw/2)*2:ceil(ih/2)*2,'
                         'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,'
                         'setparams=range=limited:color_primaries=bt709:'
                         'color_trc=iec61966-2-1:colorspace=bt709')

    def test_rotation_is_composed_before_color_conversion(self):
        for rotation in ('transpose=1', 'transpose=2'):
            with self.subTest(rotation=rotation):
                args = self.run_start(rotation)
                self.assertEqual(args.count('-F'), 1)
                self.assertTrue(args[-1].startswith(rotation + ',pad='))

    def test_status_does_not_start_recorder(self):
        result = subprocess.run(
            ['bash', '--noprofile', '--norc', '-c', self.script, 'record', 'status'],
            env=self.env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'not recording')
        self.assertFalse(self.log.exists())

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),
                         'FFmpeg and ffprobe are required for the offline codec check')
    def test_real_encoder_metadata_and_colors(self):
        # No Wayland capture: encode synthetic RGB swatches with the actual args.
        args = self.run_start()
        codec_args = []
        for i, arg in enumerate(args):
            if arg == '-p':
                key, value = args[i + 1].split('=', 1)
                codec_args.extend(['-' + key, value])
        colors = [(23, 25, 29), (32, 35, 41), (147, 197, 253)]
        ppm = self.root / 'input.ppm'
        ppm.write_bytes(b'P6\n65 49\n255\n' + b''.join(
            bytes(colors[min(x // 22, 2)]) for y in range(49) for x in range(65)))
        video = self.root / 'output.mp4'
        encoded = subprocess.run(
            ['ffmpeg', '-v', 'error', '-i', str(ppm), '-frames:v', '1',
             '-vf', args[-1], '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
             *codec_args, str(video)], capture_output=True, timeout=20)
        self.assertEqual(encoded.returncode, 0, encoded.stderr.decode())
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(video)],
            capture_output=True, text=True, check=True, timeout=10)
        stream = json.loads(probe.stdout)['streams'][0]
        for key, expected in {'codec_name': 'h264', 'pix_fmt': 'yuv420p',
                              'width': 66, 'height': 50, 'color_range': 'tv',
                              'color_space': 'bt709', 'color_primaries': 'bt709',
                              'color_transfer': 'iec61966-2-1'}.items():
            self.assertEqual(stream[key], expected, key)
        decoded = subprocess.run(
            ['ffmpeg', '-v', 'error', '-i', str(video), '-frames:v', '1',
             '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            capture_output=True, check=True, timeout=10).stdout
        for x, expected in zip((10, 32, 54), colors):
            offset = (24 * 66 + x) * 3
            actual = decoded[offset:offset + 3]
            self.assertEqual(len(actual), 3)
            for channel, reference in zip(actual, expected):
                self.assertLessEqual(abs(channel - reference), 4, (actual, expected))


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
