"""Offline night-light configuration and IPC checks. No desktop access."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
HYPR = ROOT / 'linux/home/.config/hypr'
SPEC = importlib.util.spec_from_file_location('night_light', HYPR / 'scripts/night-light.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NightLight(unittest.TestCase):
    def invoke(self, action, replies):
        stdout, stderr = io.StringIO(), io.StringIO()
        results = [subprocess.CompletedProcess([], 0, reply) for reply in replies]
        with patch.object(MODULE.subprocess, 'run', side_effect=results) as run:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = MODULE.main(action)
        return code, stdout.getvalue(), run.call_args_list

    def test_status(self):
        for state, label in [('true', 'Day'), ('false', 'Night')]:
            with self.subTest(state=state):
                code, output, calls = self.invoke('status', [state])
                self.assertEqual(code, 0)
                self.assertEqual(json.loads(output), {'text': label, 'alt': label.lower()})
                config = json.loads((HYPR.parent / 'hyprpanel/modules.json').read_text())['custom/nightlight']
                expected = '\U000f06e8' if state == 'true' else '\U000f1a4c'
                self.assertEqual(config['icon'][json.loads(output)['alt']], expected)
                self.assertEqual(calls[0].args[0], ['hyprctl', 'hyprsunset', 'identity', 'get'])

    def test_toggle_uses_ipc_not_process_control(self):
        for state, command in [('true', ['temperature', '4500']), ('false', ['identity'])]:
            with self.subTest(state=state):
                code, _, calls = self.invoke('toggle', [state, 'ok'])
                self.assertEqual(code, 0)
                self.assertEqual(len(calls), 2)
                self.assertEqual(calls[-1].args[0], ['hyprctl', 'hyprsunset', *command])

    def test_reset(self):
        code, _, calls = self.invoke('reset', ['ok'])
        self.assertEqual(code, 0)
        self.assertEqual(calls[0].args[0], ['hyprctl', 'hyprsunset', 'reset'])

    def test_bad_reply_does_not_toggle(self):
        code, _, calls = self.invoke('toggle', ['not running'])
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.invoke('toggle', ['true', 'error'])[0], 1)
        self.assertEqual(self.invoke('reset', ['error'])[0], 1)

    def test_unavailable_status(self):
        code, output, _ = self.invoke('status', ['invalid'])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output), {'text': 'Unavailable', 'alt': 'unavailable'})
        for error in [FileNotFoundError(), subprocess.TimeoutExpired('hyprctl', 3),
                      subprocess.CalledProcessError(1, 'hyprctl')]:
            with self.subTest(error=error):
                with patch.object(MODULE.subprocess, 'run', side_effect=error):
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(MODULE.main('status'), 1)
                    self.assertEqual(json.loads(output.getvalue()),
                                     {'text': 'Unavailable', 'alt': 'unavailable'})

    def test_schedule_and_actions(self):
        source = (HYPR / 'hyprsunset.conf').read_text()
        profiles = [dict(re.findall(r'(\w+)\s*=\s*([^\s]+)', block))
                    for block in re.findall(r'profile\s*\{([^}]+)\}', source)]
        self.assertEqual(profiles, [{'time': '06:00', 'identity': 'true'},
                                    {'time': '21:00', 'temperature': '4500'}])
        config = json.loads((HYPR.parent / 'hyprpanel/modules.json').read_text())['custom/nightlight']
        base = 'python3 $HOME/.config/hypr/scripts/night-light.py '
        self.assertEqual(config['execute'], base + 'status')
        self.assertEqual(config['actions']['onLeftClick'], base + 'toggle')
        self.assertEqual(config['actions']['onRightClick'], base + 'reset')
        self.assertEqual(config['label'], '{text}')
        self.assertEqual(config['icon']['unavailable'], config['icon']['default'])
        self.assertNotEqual(config['icon']['day'], config['icon']['night'])


if __name__ == '__main__':
    unittest.main()
