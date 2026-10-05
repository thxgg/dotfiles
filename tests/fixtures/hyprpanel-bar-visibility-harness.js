const assert = require('node:assert/strict');
class Signals {
    signals = new Map();
    next = 0;
    connect(name, callback) { this.signals.set(++this.next, { name, callback }); return this.next; }
    disconnect(id) { assert(this.signals.delete(id)); }
    emit(name, ...args) {
        for (const signal of [...this.signals.values()]) {
            if (signal.name === name) signal.callback(this, ...args);
        }
    }
}
class Window extends Signals {
    visible = true;
    changes = [];
    set_visible(value) {
        this.visible = value;
        this.changes.push(value);
        this.emit('notify::visible');
    }
}
const app = new Signals();
const bars = new Map([['bar-0', new Window()], ['bar-1', new Window()]]);
app.get_window = name => bars.get(name);
const hyprland = new Signals();
let monitors = [
    { id: 0, activeWorkspace: { id: 4 }, specialWorkspace: { id: 0 } },
    { id: 1, activeWorkspace: { id: 11 }, specialWorkspace: { id: 0 } },
];
const wow = { initialTitle: 'World of Warcraft', mapped: true, hidden: false,
    fullscreen: 2, workspace: { id: 4 }, monitor: 0 };
let clients = [wow];
let fail = false;
let hold = false;
let requests = [];
hyprland.message_async = (command, callback) => {
    const response = fail ? 'invalid JSON' : JSON.stringify(command === 'j/monitors' ? monitors : clients);
    if (hold) requests.push(() => callback(hyprland, response));
    else callback(hyprland, response);
};
hyprland.message_finish = result => result;
const preferences = new Map();
const visibility = { get: name => preferences.get(name) ?? true };
let mode = 'never';
let optionCallback;
const autoHide = { get: () => mode, subscribe: callback => {
    optionCallback = callback;
    return () => { optionCallback = null; };
} };
const timers = new Map();
let nextTimer = 0;
const schedule = callback => { timers.set(++nextTimer, callback); return nextTimer; };
const cancel = id => timers.delete(id);
async function flush() {
    for (let i = 0; i < 20; i++) {
        for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
        await Promise.resolve();
        await Promise.resolve();
        if (!timers.size) return;
    }
    throw new Error('Visibility update loop');
}
async function event(name = 'fullscreen') { hyprland.emit('event', name, ''); await flush(); }
async function main() {
    const stop = startWoWBarVisibility({ app, hyprland, visibility, autoHide, schedule, cancel });
    await flush();
    assert.equal(bars.get('bar-0').visible, false, 'startup with fullscreen WoW must unmap bar');
    assert.equal(bars.get('bar-1').visible, true, 'other monitor unchanged');
    assert.equal(preferences.size, 0, 'automatic hiding must not change manual preferences');
    monitors[0].activeWorkspace.id = 5;
    await event('workspacev2');
    assert.equal(bars.get('bar-0').visible, true, 'empty workspace restores bar');
    wow.fullscreen = 0;
    await event();
    assert.equal(bars.get('bar-0').visible, true, 'inactive client must not hide bar');
    monitors[0].activeWorkspace.id = 4;
    await event('workspacev2');
    assert.equal(bars.get('bar-0').visible, true, 'windowed WoW keeps bar');
    wow.fullscreen = 1;
    await event();
    assert.equal(bars.get('bar-0').visible, true, 'maximized is not fullscreen');
    wow.fullscreen = 2;
    await event();
    assert.equal(bars.get('bar-0').visible, false);
    monitors[0].specialWorkspace.id = -98;
    await event('activespecialv2');
    assert.equal(bars.get('bar-0').visible, true, 'special workspace covers fullscreen WoW');
    monitors[0].specialWorkspace.id = 0;
    await event('activespecialv2');
    assert.equal(bars.get('bar-0').visible, false);
    clients = [];
    await event('closewindow');
    assert.equal(bars.get('bar-0').visible, true, 'closing game restores bar');

    // Match the initial title, not the generic Wine class or mutable current title.
    clients = [{ ...wow, title: 'World of Warcraft', initialTitle: 'Battle.net' }];
    await event('openwindow');
    assert.equal(bars.get('bar-0').visible, true);
    clients = [{ ...wow, title: 'Changed title' }];
    await event('windowtitlev2');
    assert.equal(bars.get('bar-0').visible, false);

    wow.monitor = 1;
    wow.workspace.id = 11;
    clients = [wow];
    await event('movewindowv2');
    assert.equal(bars.get('bar-0').visible, true);
    assert.equal(bars.get('bar-1').visible, false, 'follow game to another monitor');
    preferences.set('bar-1', false);
    clients = [];
    await event('closewindow');
    assert.equal(bars.get('bar-1').visible, false, 'manual hide wins on restoration');
    preferences.set('bar-1', true);
    clients = [wow];
    await event();
    clients = [];
    await event();
    assert.equal(bars.get('bar-1').visible, false, 'do not restore a bar we did not hide');

    // Recreated bars are reconciled, and old window subscriptions are removed.
    clients = [wow];
    const old = bars.get('bar-1');
    const replacement = new Window();
    bars.set('bar-1', replacement);
    app.emit('window-added', replacement);
    await flush();
    assert.equal(old.signals.size, 0);
    assert.equal(replacement.visible, false);
    replacement.set_visible(true);
    await flush();
    assert.equal(replacement.visible, false, 'manual reveal cannot expose hidden input over WoW');

    fail = true;
    clients = [];
    const warn = console.warn;
    console.warn = () => {};
    await event();
    console.warn = warn;
    assert.equal(replacement.visible, false, 'query failure retains state');
    fail = false;
    await event('workspacev2');
    assert.equal(replacement.visible, true, 'next event recovers');

    // Preserve other auto-hide modes, but use active workspaces and full fullscreen only.
    mode = 'fullscreen';
    clients = [{ ...wow, initialTitle: 'Netflix' }];
    optionCallback();
    await flush();
    assert.equal(replacement.visible, false);
    mode = 'never';
    optionCallback();
    await flush();
    assert.equal(replacement.visible, true);
    mode = 'single-window';
    optionCallback();
    await flush();
    assert.equal(replacement.visible, false);
    clients.push({ ...wow, initialTitle: 'Terminal' });
    await event('openwindow');
    assert.equal(replacement.visible, true);
    mode = 'never';

    // Discard stale snapshots if an event arrives during an asynchronous query.
    clients = [wow];
    hold = true;
    await event();
    assert.equal(requests.length, 2);
    clients = [];
    hyprland.emit('event', 'closewindow', '');
    hold = false;
    requests.splice(0).forEach(callback => callback());
    await flush();
    assert.equal(replacement.visible, true);
    assert.equal(replacement.changes.at(-1), true, 'stale fullscreen snapshot must not hide bar');

    // Shutdown drops subscriptions/timers and ignores outstanding query responses.
    hold = true;
    clients = [wow];
    await event();
    app.emit('shutdown');
    stop();
    requests.splice(0).forEach(callback => callback());
    await flush();
    assert.equal(replacement.visible, true);
    assert.equal(app.signals.size, 0);
    assert.equal(hyprland.signals.size, 0);
    assert.equal(replacement.signals.size, 0);
    assert.equal(timers.size, 0);
    assert.equal(optionCallback, null);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
