// Injected into the private HyprPanel bundle by start-hyprpanel.sh.
// Query compositor state after events instead of retaining focused-client bindings.
function startWoWBarVisibility({ app, hyprland, visibility, autoHide, schedule, cancel }) {
    const hidden = new Set();
    const windows = new Map();
    let pending = null;
    let running = false;
    let dirty = false;
    let stopped = false;

    function request(command) {
        return new Promise((resolve, reject) => {
            hyprland.message_async(command, (service, result) => {
                try {
                    const value = JSON.parse(service.message_finish(result));
                    if (!Array.isArray(value)) throw new Error(`Invalid ${command} response`);
                    resolve(value);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    function queue() {
        if (stopped) return;
        dirty = true;
        if (running || pending !== null) return;
        pending = schedule(() => {
            pending = null;
            void refresh();
        });
    }

    function trackWindows(monitors) {
        const current = new Set();
        for (const monitor of monitors) {
            const name = `bar-${monitor.id}`;
            const window = app.get_window(name);
            if (!window) continue;
            current.add(window);
            if (!windows.has(window)) {
                windows.set(window, window.connect('notify::visible', queue));
            }
        }
        for (const [window, signal] of windows) {
            if (current.has(window)) continue;
            window.disconnect(signal);
            windows.delete(window);
            hidden.delete(window);
        }
    }

    function reconcile(monitors, clients) {
        trackWindows(monitors);
        const mode = autoHide.get();
        for (const monitor of monitors) {
            const name = `bar-${monitor.id}`;
            const window = app.get_window(name);
            if (!window) continue;
            // An open special workspace covers the regular workspace below it.
            const workspace = monitor.specialWorkspace?.id
                ? monitor.specialWorkspace.id : monitor.activeWorkspace?.id;
            const active = clients.filter(client => client.mapped && !client.hidden
                && client.monitor === monitor.id && client.workspace?.id === workspace);
            const fullscreen = active.filter(client => client.fullscreen === 2);
            const hide = fullscreen.some(client => client.initialTitle === 'World of Warcraft')
                || (mode === 'fullscreen' && fullscreen.length > 0)
                || (mode === 'single-window' && active.length === 1);

            // BarVisibility holds the user's preference. Never overwrite it.
            if (hide) {
                if (window.visible) {
                    if (visibility.get(name)) hidden.add(window);
                    window.set_visible(false); // Unmap the surface, including its input region.
                }
            } else if (hidden.delete(window) && visibility.get(name)) {
                window.set_visible(true);
            }
        }
    }

    async function refresh() {
        running = true;
        dirty = false;
        try {
            const [monitors, clients] = await Promise.all([
                request('j/monitors'), request('j/clients'),
            ]);
            // An intervening event invalidates this snapshot. Query again first.
            if (!stopped && !dirty) reconcile(monitors, clients);
        } catch (error) {
            // Keep current visibility on query failure. Retry on the next event.
            if (!stopped) console.warn('[WoWBarVisibility] State query failed:', error);
        } finally {
            running = false;
            if (!stopped && dirty) queue();
        }
    }

    const eventSignal = hyprland.connect('event', (_service, event) => {
        if (/^(workspace|focusedmon|activewindow|fullscreen|openwindow|closewindow|movewindow|moveworkspace|activespecial|monitoradded|monitorremoved|windowtitle|pin|configreloaded)/.test(event)) {
            queue();
        }
    });
    const addedSignal = app.connect('window-added', queue);
    const removedSignal = app.connect('window-removed', queue);
    const unsubscribe = autoHide.subscribe(queue);
    const shutdownSignal = app.connect('shutdown', stop);
    queue(); // Also covers startup/restart while WoW is already fullscreen.

    function stop() {
        if (stopped) return;
        stopped = true;
        if (pending !== null) cancel(pending);
        hyprland.disconnect(eventSignal);
        app.disconnect(addedSignal);
        app.disconnect(removedSignal);
        app.disconnect(shutdownSignal);
        unsubscribe();
        for (const [window, signal] of windows) window.disconnect(signal);
        windows.clear();
        hidden.clear();
    }
    return stop;
}
