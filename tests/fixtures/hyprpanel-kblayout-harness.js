const assert = require('node:assert/strict');
const timers = new Set();
const errors = [];
const console = { error: (error) => errors.push(error) };
let devices = { keyboards: [] };
let queryError = false;
let reads = 0;
let format = 'code';
const hyprlandService4 = {
    listeners: new Set(),
    message(command) {
        assert.equal(command, 'j/devices'); // Never switch the actual layout.
        reads++;
        if (queryError) throw new Error('IPC unavailable');
        return typeof devices === 'string' ? devices : JSON.stringify(devices);
    },
};
const labelType = { listeners: new Set(), get: () => format };
function timeout(delay, callback) {
    assert.equal(delay, 1000);
    const timer = { callback, cancel: () => timers.delete(timer) };
    timers.add(timer);
    return timer;
}
function tick() {
    for (const timer of [...timers]) {
        timers.delete(timer);
        timer.callback();
    }
}
function useHook(widget, target, setup, signal) {
    if (target === hyprlandService4) assert.equal(signal, 'keyboard-layout');
    setup();
    target.listeners.add(setup);
    widget.connect('destroy', () => target.listeners.delete(setup));
}
function emit(target) {
    for (const listener of [...target.listeners]) listener();
}
function Module({ labelHook }) {
    const destroyHandlers = [];
    const widget = {
        label: '',
        connect(signal, callback) {
            assert.equal(signal, 'destroy');
            destroyHandlers.push(callback);
        },
        destroy() { destroyHandlers.forEach((callback) => callback()); },
    };
    labelHook(widget);
    return widget;
}
function keymap(name) {
    return { keyboards: [{ main: true, active_keymap: name }] };
}

/* KEYBOARD_SOURCE */

const widget = KbInput();
assert.equal(widget.label, 'Unknown');
assert.equal(timers.size, 1, 'missing initial keyboard must schedule one recovery read');
tick();
assert.equal(timers.size, 1, 'unknown state must keep retrying without duplicate timers');
devices = keymap('English (US)');
tick();
assert.equal(widget.label, 'US', 'recover without a layout event');
assert.equal(timers.size, 0, 'stop polling after recovery');
const validReads = reads;
tick();
assert.equal(reads, validReads);

devices = keymap('Bulgarian (traditional phonetic)');
emit(hyprlandService4);
assert.equal(widget.label, 'BG (Phonetic)');
format = 'name';
emit(labelType);
assert.equal(widget.label, 'Bulgarian (traditional phonetic)');
assert.equal(timers.size, 0);

for (const badData of [{ keyboards: [] }, keymap(''), keymap('unmapped'), '{']) {
    devices = badData;
    emit(hyprlandService4);
    assert.equal(timers.size, 1);
    emit(hyprlandService4);
    emit(labelType);
    assert.equal(timers.size, 1, 'events must not accumulate retries');
    devices = keymap('English (US)');
    tick();
    assert.equal(widget.label, 'English (US)');
    assert.equal(timers.size, 0);
}
assert.ok(errors.length > 0, 'malformed JSON must be handled');
queryError = true;
emit(hyprlandService4);
assert.equal(timers.size, 1, 'IPC errors must also recover');
queryError = false;
devices = keymap('Bulgarian (traditional phonetic)');
emit(hyprlandService4);
assert.equal(widget.label, 'Bulgarian (traditional phonetic)');
assert.equal(timers.size, 0, 'successful event must cancel the pending retry');

devices = { keyboards: [] };
const secondWidget = KbInput();
emit(hyprlandService4);
assert.equal(timers.size, 2, 'each label must own its timer');
const queuedCallbacks = [...timers].map((timer) => timer.callback);
widget.destroy();
assert.equal(timers.size, 1);
secondWidget.destroy();
assert.equal(timers.size, 0);
assert.equal(hyprlandService4.listeners.size, 0);
assert.equal(labelType.listeners.size, 0);
const destroyedReads = reads;
queuedCallbacks.forEach((callback) => callback());
assert.equal(reads, destroyedReads, 'a stale callback must not read or update a destroyed label');
assert.equal(timers.size, 0);

devices = keymap('English (US)');
const recreated = KbInput();
assert.equal(recreated.label, 'English (US)');
assert.equal(timers.size, 0, 'valid startup needs no polling');
recreated.destroy();
