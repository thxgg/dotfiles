// Minimal synchronous model of Astal Variable.derive and GObject bindings.
const assert = require('node:assert/strict');
function Variable(value) {
  const listeners = new Set();
  return {
    get: () => value,
    set(next) { value = next; for (const fn of [...listeners]) fn(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
Variable.derive = (deps, fn) => {
  const update = () => fn(...deps.map(dep => dep.get()));
  const result = Variable(update());
  const cleanup = deps.map(dep => dep.subscribe(() => result.set(update())));
  result.drop = () => cleanup.forEach(fn => fn());
  return result;
};
function device(iconName) {
  return { iconName, signals: { iconName: Variable(iconName) } };
}
function bind(object, prop) { return prop ? object.signals[prop] : object; }
function change(object, prop, value) {
  object[prop] = value;
  object.signals[prop].set(value);
}
const service = { wired: null, wifi: null, primary: 0, state: 70, connectivity: 4 };
service.signals = Object.fromEntries(Object.entries(service).map(([k, v]) => [k, Variable(v)]));
const AstalNetwork2 = { get_default: () => service };
const AstalNetwork3 = { ...AstalNetwork2, Primary: { UNKNOWN: 0, WIRED: 1, WIFI: 2 } };
/* NETWORK_SOURCE */
const icon = Network();
assert.equal(icon.get(), 'network-offline-symbolic');
// Devices arrive after startup, with no state or connectivity notification.
const cable = device('network-wired-symbolic');
change(service, 'wired', cable);
change(service, 'primary', 1);
assert.equal(icon.get(), 'network-wired-symbolic');
change(cable, 'iconName', 'network-wired-acquiring-symbolic');
assert.equal(icon.get(), 'network-wired-acquiring-symbolic');
change(cable, 'iconName', '');
assert.equal(icon.get(), 'network-wired-symbolic');
const replacement = device('network-wired-symbolic');
change(service, 'wired', replacement);
change(cable, 'iconName', 'stale-icon');
assert.equal(icon.get(), 'network-wired-symbolic');
change(service, 'wired', null);
assert.equal(icon.get(), 'network-wired-disconnected-symbolic');
change(replacement, 'iconName', 'stale-icon');
assert.equal(icon.get(), 'network-wired-disconnected-symbolic');
const wifi = device('network-wireless-signal-good-symbolic');
change(service, 'wifi', wifi);
change(service, 'primary', 2);
assert.equal(icon.get(), 'network-wireless-signal-good-symbolic');
change(wifi, 'iconName', null);
assert.equal(icon.get(), 'network-wireless-offline-symbolic');
change(service, 'wifi', null);
change(wifi, 'iconName', 'stale-icon');
assert.equal(icon.get(), 'network-wireless-offline-symbolic');
change(service, 'primary', 0);
assert.equal(icon.get(), 'network-offline-symbolic');
// Reconnection and repeated state notifications still preserve subscriptions.
change(service, 'wired', cable);
change(cable, 'iconName', 'network-wired-symbolic');
change(service, 'primary', 1);
change(service, 'state', 70);
change(service, 'connectivity', 4);
assert.equal(icon.get(), 'network-wired-symbolic');
change(cable, 'iconName', 'network-wired-acquiring-symbolic');
assert.equal(icon.get(), 'network-wired-acquiring-symbolic');
