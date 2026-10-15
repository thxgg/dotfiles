"""Offline checks: no display, session bus, key injection, or live app access."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from Xlib import X

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'tray_menu', ROOT / 'linux/home/.config/hypr/scripts/battlenet-tray-menu.py')
menu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(menu)


class TrayMenu(unittest.TestCase):
    def test_only_owner_popup_near_requested_position(self):
        args = [123, 'Battle.net', 0x96000000, X.IsViewable,
                (300, 53, 169, 293), 123, 300, 53]
        self.assertTrue(menu.is_menu(*args))
        for index, value in ((0, 456), (1, 'World of Warcraft'),
                             (2, 0x96C00000), (2, 0x16000000),
                             (3, X.IsUnmapped), (4, (300, 53, 1920, 1080)),
                             (4, (2000, 53, 169, 293))):
            changed = args.copy()
            changed[index] = value
            self.assertFalse(menu.is_menu(*changed), (index, value))

    def test_focus_loss_not_grabs_or_child_focus(self):
        def event(kind=X.FocusOut, mode=X.NotifyNormal, detail=X.NotifyNonlinear):
            return SimpleNamespace(type=kind, mode=mode, detail=detail)
        self.assertTrue(menu.should_dismiss(event()))
        self.assertFalse(menu.should_dismiss(event(kind=X.FocusIn)))
        self.assertFalse(menu.should_dismiss(event(mode=X.NotifyGrab)))
        self.assertFalse(menu.should_dismiss(event(mode=X.NotifyUngrab)))
        self.assertFalse(menu.should_dismiss(event(detail=X.NotifyInferior)))

    def test_escape_addresses_popup_without_focus_or_global_injection(self):
        connection = Mock()
        connection.screen.return_value.root = 1
        connection.keysym_to_keycode.return_value = 9
        window = Mock()
        # Replace event encoders only, so no real X connection is needed.
        with patch.object(menu.protocol.event, 'KeyPress', side_effect=lambda **kw: kw), \
             patch.object(menu.protocol.event, 'KeyRelease', side_effect=lambda **kw: kw):
            menu.escape(connection, window)
        self.assertEqual(window.send_event.call_count, 2)
        for call in window.send_event.call_args_list:
            self.assertIs(call.args[0]['window'], window)
            self.assertEqual(call.args[0]['detail'], 9)
            self.assertEqual(call.kwargs, {'event_mask': 0})
        window.set_input_focus.assert_not_called()
        connection.flush.assert_called_once()

    def test_watch_dismisses_on_loss_and_exits_on_unmap(self):
        for kind, closes in ((X.FocusOut, True), (X.UnmapNotify, False)):
            connection = Mock()
            window = Mock()
            window.get_full_property.side_effect = lambda atom, _: SimpleNamespace(
                value=[123 if atom == '_NET_WM_PID' else 0x96000000])
            window.get_wm_name.return_value = 'Battle.net'
            window.get_attributes.return_value.map_state = X.IsViewable
            window.get_geometry.return_value = SimpleNamespace(x=300, y=53, width=169, height=293)
            connection.intern_atom.side_effect = lambda name: name
            connection.screen.return_value.root.query_tree.return_value.children = [window]
            connection.pending_events.return_value = 1
            connection.next_event.return_value = SimpleNamespace(
                window=window, type=kind, mode=X.NotifyNormal, detail=X.NotifyNonlinear)
            with patch.object(menu, 'escape') as escape:
                menu.watch(connection, 123, 300, 53)
            self.assertEqual(escape.called, closes)
            window.set_input_focus.assert_called_once_with(X.RevertToParent, X.CurrentTime)


if __name__ == '__main__':
    unittest.main()
