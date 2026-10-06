"""Diagnostic instrumentation and launcher checks, without starting a locker."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'linux/home/.config/hypr/scripts'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


patcher = load('instrumentation', 'patch-hyprlock-diagnostics.py')
launcher = load('diagnose', 'diagnose-hyprlock.py')


class Diagnostics(unittest.TestCase):
    def fixture(self, root):
        for relative, edits in patcher.PATCHES.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('\n'.join(old for old, _ in edits))
        (root / 'src/helpers').mkdir(exist_ok=True)

    def test_patch_is_render_only_and_rejects_second_application(self):
        self.assertEqual(set(patcher.PATCHES), {
            'src/renderer/MpvVideo.hpp', 'src/renderer/MpvVideo.cpp',
            'src/core/LockSurface.hpp', 'src/core/LockSurface.cpp',
        })
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            patcher.apply(root)
            self.assertTrue((root / 'src/helpers/PerfDiagnostics.hpp').is_file())
            source = (root / 'src/renderer/MpvVideo.cpp').read_text()
            self.assertIn('mpv_observe_property', source)
            self.assertNotIn('mpv_get_property', source)
            self.assertNotIn('glFinish(', source)
            with self.assertRaises(RuntimeError):
                patcher.apply(root)

    def test_missing_target_makes_no_partial_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            path = root / 'src/core/LockSurface.cpp'
            path.write_text('unsupported source')
            before = {p: p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with self.assertRaises(RuntimeError):
                patcher.apply(root)
            self.assertEqual(before, {p: p.read_bytes() for p in root.rglob('*') if p.is_file()})

    def test_preflight_cannot_launch_locker(self):
        with patch.object(launcher.sys, 'argv', ['diagnose']), \
             patch.object(launcher.control, 'check'), \
             patch.object(launcher.control, 'run', return_value='OK'), \
             patch.object(launcher.subprocess, 'Popen') as spawn:
            launcher.main()
            spawn.assert_not_called()

    def test_invalid_action_cannot_launch_locker(self):
        with patch.object(launcher.sys, 'argv', ['diagnose', 'typo']), \
             patch.object(launcher.subprocess, 'Popen') as spawn:
            with self.assertRaises(RuntimeError):
                launcher.main()
            spawn.assert_not_called()

    def test_log_filter(self):
        for text in ('[perf] video=3840x2160 hwdec=vaapi', '[mpv] video initialized', 'onLockLocked called'):
            self.assertTrue(launcher.filtered_line(text))
        for text in ('Authenticating', 'key pressed: a', 'Clearing password buffer', 'auth: Authentication failed'):
            self.assertFalse(launcher.filtered_line(text))

    def test_regular_build_target_is_not_diagnostic(self):
        self.assertNotEqual(launcher.diagnostic_binary(), launcher.control.VIDEO_LOCKER)
        self.assertIn('-diagnostic', str(launcher.diagnostic_binary()))


if __name__ == '__main__':
    unittest.main()
