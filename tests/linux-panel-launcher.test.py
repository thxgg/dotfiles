"""Check compatibility patches and fallback without starting a desktop."""
import base64
import json
import os
import signal
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
        self.visibility = (ROOT / 'linux/home/.config/hypr/scripts/hyprpanel-bar-visibility.js').read_text()
        helper = self.root / '.config/hypr/scripts/hyprpanel-bar-visibility.js'
        helper.parent.mkdir(parents=True)
        helper.write_text(self.visibility)

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

    def test_theme_restarts_use_compatibility_launcher(self):
        for name in ('config.json', 'config-light.json'):
            with self.subTest(config=name):
                config = json.loads((ROOT / 'linux/home/.config/hyprpanel' / name).read_text())
                self.assertEqual(
                    config['hyprpanel.restartCommand'],
                    'hyprpanel -q; "$HOME/.config/hypr/scripts/start-hyprpanel.sh"',
                )

    def test_wow_visibility_lifecycle(self):
        harness = (ROOT / 'tests/fixtures/hyprpanel-bar-visibility-harness.js').read_text()
        result = subprocess.run(['node', '-e', self.visibility + '\n' + harness],
                                env=self.env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)

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
        network = (ROOT / 'tests/fixtures/hyprpanel-network.js').read_text()
        source += network + '\n  autoHide2.initialize();\n'
        # Apply the production patch dictionary independently to the fixture.
        patcher = SOURCE.split("<<'PY' || return 1\n", 1)[1].split('\nPY', 1)[0]
        import ast
        tree = ast.parse(patcher)
        replacements = next(ast.literal_eval(n.value) for n in tree.body
                            if isinstance(n, ast.Assign)
                            and any(isinstance(t, ast.Name) and t.id == 'replacements' for t in n.targets))
        patched_network = network
        for old, new in replacements.items():
            patched_network = patched_network.replace(old, new)
        expected += patched_network + '\n' + replacements['  autoHide2.initialize();'] + '\n'
        expected = self.visibility + '\n' + expected
        launcher = self.encoded_launcher(source)
        runtime = self.root / 'hyprpanel-ags.js'
        self.check_launcher(launcher, f'PATCHED\n{runtime}')
        self.assertEqual(runtime.read_text(), expected)
        self.assertEqual((self.root / 'launcher').read_text(), launcher)
        harness = (ROOT / 'tests/fixtures/hyprpanel-network-harness.js').read_text()
        result = subprocess.run(['node', '-e', harness.replace('/* NETWORK_SOURCE */', patched_network)],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        # The same lifecycle test must expose the original bug.
        original = subprocess.run(['node', '-e', harness.replace('/* NETWORK_SOURCE */', network)],
                                  capture_output=True, text=True, timeout=5)
        self.assertNotEqual(original.returncode, 0)
        # A changed or duplicated target must not generate a partial patch.
        self.check_launcher(self.encoded_launcher(source.replace('  autoHide2.initialize();', '  autoHide3.initialize();')))
        self.check_launcher(self.encoded_launcher(source + '\n  autoHide2.initialize();'))
        self.check_launcher(self.encoded_launcher(source.replace('    wiredIcon.set(icon14);', '    wiredIcon.set(newIcon);')))
        self.check_launcher(self.encoded_launcher(source + '\nvar wiredIcon = Variable("");'))


class WallpaperDaemon(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {'HOME': str(self.root), 'PATH': '/usr/bin:/bin',
                    'XDG_RUNTIME_DIR': str(self.root), 'WAYLAND_DISPLAY': 'wayland-test'}
        self.daemon = self.root / 'daemon'
        self.client = self.root / 'client'
        self.daemon.write_text('''#!/usr/bin/env python3
import os, pathlib, signal, sys, time
root = pathlib.Path(os.environ['HOME'])
if len(sys.argv) > 1:
    print(' '.join(sys.argv[1:]))
    sys.exit(0)
(root / 'pid').write_text(str(os.getpid()))
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
(root / 'ready').touch()
while True:
    print('daemon alive', flush=True)
    time.sleep(0.1)
''')
        self.client.write_text('#!/bin/sh\ntest -f "$HOME/ready"\n')
        self.daemon.chmod(0o755)
        self.client.chmod(0o755)
        source = (ROOT / 'linux/home/.config/hypr/scripts/swww-daemon').read_text()
        # Always test the awww fallback, without touching the desktop or system binaries.
        source = source.replace('/usr/bin/swww-daemon', str(self.root / 'missing-daemon'))
        source = source.replace('/usr/bin/swww', str(self.root / 'missing-client'))
        source = source.replace('/usr/bin/awww-daemon', str(self.daemon))
        source = source.replace('/usr/bin/awww', str(self.client))
        self.wrapper = self.root / 'wrapper'
        self.wrapper.write_text(source)
        self.addCleanup(self.stop_daemon)

    def stop_daemon(self):
        pid_file = self.root / 'pid'
        if pid_file.exists():
            try:
                os.kill(int(pid_file.read_text()), signal.SIGTERM)
            except ProcessLookupError:
                pass

    def run_wrapper(self, *args):
        return subprocess.run(['bash', '--noprofile', '--norc', str(self.wrapper), *args],
                              env=self.env, capture_output=True, text=True, timeout=8)

    def test_detached_start_and_restart_reuse(self):
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        pid = int((self.root / 'pid').read_text())
        os.kill(pid, 0)
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(int((self.root / 'pid').read_text()), pid)
        self.assertTrue((self.root / 'hyprpanel-wallpaper-wayland-test.log').exists())

    def test_explicit_arguments_are_forwarded(self):
        result = self.run_wrapper('--help')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), '--help')
        self.assertFalse((self.root / 'pid').exists())

    def test_failed_start_is_reported(self):
        self.daemon.write_text('#!/bin/sh\nexit 1\n')
        result = self.run_wrapper()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('did not become ready', result.stderr)

    def test_missing_runtime_is_rejected(self):
        del self.env['XDG_RUNTIME_DIR']
        result = self.run_wrapper()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'pid').exists())


if __name__ == '__main__':
    unittest.main()
