const assert = require('node:assert/strict');
const calls = [];
const menus = [];
let update;
const Variable = { derive: (bindings, callback) => {
  update = callback;
  callback(...bindings);
  return { drop: () => calls.push('drop') };
} };
const bind = (item, key) => item[key];
const jsx2 = (_type, props) => props;
const createMenu = (model, actions) => {
  const menu = {
    model, actions, destroyed: false,
    destroy() { this.destroyed = true; },
    popup_at_widget(...args) { calls.push(['popup', ...args]); },
  };
  menus.push(menu);
  return menu;
};
const Gdk = { Gravity: { NORTH: 1, SOUTH: 2 } };
const isPrimaryClick = event => event.button === 1;
const isSecondaryClick = event => event.button === 3;
const isMiddleClick = event => event.button === 2;
const SystemUtilities = { notify: value => calls.push(['notify', value]) };
const GLib = { Variant: class { constructor(type, value) {
  this.type = type; this.value = value;
} } };
const Gio = { DBusCallFlags: { NONE: 0 }, DBus: { session: {
  call(...args) { calls.push(['dbus', ...args]); },
} } };
/* TRAY_SOURCE */

const item = {
  id: 'wine-test', itemId: ':1.42/custom/StatusNotifierItem',
  menuModel: null, actionGroup: null,
  activate: (...args) => calls.push(['activate', ...args]),
  about_to_show: () => calls.push('about'),
};
const self = { get_window: () => ({ get_root_coords: (x, y) => [x + 100, y + 200] }) };
const button = MenuEntry({ item, child: 'icon' });
const click = number => button.onClick(self, { button: number, x: 10.4, y: 20.6 });
click(1);
assert.deepEqual(calls.pop(), ['activate', 0, 0]);
click(2);
assert.deepEqual(calls.pop(), ['notify', { summary: 'App Name', body: 'wine-test' }]);
click(3);
const request = calls.pop();
assert.equal(request?.[0], 'dbus', 'missing exported menu must call ContextMenu');
assert.deepEqual(request.slice(1, 5), [':1.42', '/custom/StatusNotifierItem', 'org.kde.StatusNotifierItem', 'ContextMenu']);
assert.equal(request[5].type, '(ii)');
assert.deepEqual(request[5].value, [110, 221]);
assert.deepEqual(request.slice(6, 10), [null, 0, 2000, null]);
request[10]({ call_finish: value => assert.equal(value, 'reply') }, 'reply');
const errors = [];
const originalError = console.error;
console.error = message => errors.push(message);
try {
  request[10]({ call_finish() { throw new Error('disconnected'); } }, 'reply');
} finally { console.error = originalError; }
assert.match(errors[0], /Tray context menu failed.*disconnected/);

// Exported menus retain native GTK presentation and refresh before showing.
update('model', 'actions');
click(3);
assert.equal(calls.shift(), 'about');
assert.deepEqual(calls.shift(), ['popup', self, 1, 2, null]);
update('new-model', 'new-actions');
assert.equal(menus[0].destroyed, true);
assert.equal(menus[1].model, 'new-model');

// Missing either half discards stale menus and returns to the protocol fallback.
for (const values of [[null, 'actions'], ['model', null], [null, null]]) {
  update(...values);
  click(3);
  assert.equal(calls.pop()[0], 'dbus');
}
assert.equal(menus[1].destroyed, true);
item.itemId = 'invalid';
click(3);
assert.equal(calls.length, 0);
update('final-model', 'final-actions');
button.onDestroy();
assert.equal(menus[2].destroyed, true);
assert.equal(calls.pop(), 'drop');
