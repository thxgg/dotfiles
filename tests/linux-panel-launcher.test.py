"""Check compatibility failure propagation without starting a desktop."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'linux/home/.config/hypr/scripts/start-hyprpanel.sh').read_text()
FUNCTION = 'prepare_lua_compatible_runtime() {' + SOURCE.split('prepare_lua_compatible_runtime() {', 1)[1].split('\n# Upstream builds', 1)[0]


class PanelFallback(unittest.TestCase):
    def check_launcher(self, content):
        with tempfile.TemporaryDirectory() as directory:
            launcher = Path(directory) / 'launcher'
            launcher.write_text(content)
            function = FUNCTION.replace('/usr/share/hyprpanel/hyprpanel-app', str(launcher))
            script = 'set -euo pipefail\nruntime_dir="$1"\n' + function
            script += '\nif ! result="$(prepare_lua_compatible_runtime)"; then echo FALLBACK; else echo PATCHED; fi'
            result = subprocess.run(['bash', '-c', script, 'test', directory], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'FALLBACK')

    def test_changed_launcher_format(self):
        self.check_launcher('#!/bin/sh\necho upstream-format-changed\n')

    def test_changed_generated_symbols(self):
        import base64
        payload = base64.b64encode(b'console.log("new symbols");').decode()
        self.check_launcher('cat <<EOF | base64 --decode > $file\n' + payload + '\nEOF\n')


if __name__ == '__main__':
    unittest.main()
