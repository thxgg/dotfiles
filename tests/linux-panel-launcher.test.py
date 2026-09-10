"""Check compatibility patches and fallback without starting a desktop."""
import base64
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'linux/home/.config/hypr/scripts/start-hyprpanel.sh').read_text()
FUNCTION = 'prepare_lua_compatible_runtime() {' + SOURCE.split('prepare_lua_compatible_runtime() {', 1)[1].split('\n# Upstream builds', 1)[0]


class PanelFallback(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Do not inherit BASH_ENV, exported functions, or desktop session state.
        self.env = {'HOME': str(self.root), 'PATH': '/usr/bin:/bin'}

    def check_launcher(self, content, expected='FALLBACK'):
        launcher = self.root / 'launcher'
        launcher.write_text(content)
        function = FUNCTION.replace('/usr/share/hyprpanel/hyprpanel-app', str(launcher))
        script = 'set -euo pipefail\nruntime_dir="$1"\n' + function
        script += '\nif ! result="$(prepare_lua_compatible_runtime)"; then echo FALLBACK; else printf "PATCHED\\n%s\\n" "$result"; fi'
        result = subprocess.run(['bash', '--noprofile', '--norc', '-c', script,
                                 'test', str(self.root)], env=self.env,
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), expected)

    def encoded_launcher(self, source):
        payload = base64.b64encode(source.encode()).decode()
        return 'cat <<EOF | base64 --decode > $file\n' + payload + '\nEOF\n'

    def test_changed_launcher_format(self):
        self.check_launcher('#!/bin/sh\necho upstream-format-changed\n')

    def test_changed_generated_symbols(self):
        self.check_launcher(self.encoded_launcher('console.log("new symbols");'))

    def test_supported_launcher_patches_generated_runtime(self):
        source = '''// Unrelated generated content must remain intact.
hyprlandService9.dispatch("workspace", targetWorkspaceNumber.toString());
hyprlandService12.dispatch("workspace", wsId.toString());
/* @__PURE__ */ jsxs(LeftColumn, { isVisible: true, children: [
            /* @__PURE__ */ jsx2(RightShortcut1, {}),
            /* @__PURE__ */ jsx2(SettingsButton, {})
          ] }),
          /* @__PURE__ */ jsxs(RightColumn, { children: [
            /* @__PURE__ */ jsx2(RightShortcut3, {}),
            /* @__PURE__ */ jsx2(RecordingButton, {})
          ] })
const commands = [
  "${SRC_DIR}/scripts/screen_record.sh",
  "${SRC_DIR}/scripts/screen_record.sh stop",
  "${SRC_DIR}/scripts/screen_record.sh --area",
  "${SRC_DIR}/scripts/screen_record.sh --audio"
];
'''
        expected = '''// Unrelated generated content must remain intact.
hyprlandService9.message(`dispatch hl.dsp.focus({ workspace = ${targetWorkspaceNumber} })`);
hyprlandService12.message(`dispatch hl.dsp.focus({ workspace = ${wsId} })`);
/* @__PURE__ */ jsxs(LeftColumn, { isVisible: true, children: [
            /* @__PURE__ */ jsx2(RightShortcut1, {}),
            /* @__PURE__ */ jsx2(RecordingButton, {})
          ] }),
          /* @__PURE__ */ jsxs(RightColumn, { children: [
            /* @__PURE__ */ jsx2(RightShortcut3, {}),
            /* @__PURE__ */ jsx2(SettingsButton, {})
          ] })
const commands = [
  "$HOME/.local/bin/hyprpanel-screen-record",
  "$HOME/.local/bin/hyprpanel-screen-record stop",
  "$HOME/.local/bin/hyprpanel-screen-record --area",
  "$HOME/.local/bin/hyprpanel-screen-record --audio"
];
'''
        launcher = self.encoded_launcher(source)
        runtime = self.root / 'hyprpanel-ags.js'
        self.check_launcher(launcher, f'PATCHED\n{runtime}')
        self.assertEqual(runtime.read_text(), expected)
        self.assertEqual((self.root / 'launcher').read_text(), launcher)


if __name__ == '__main__':
    unittest.main()
