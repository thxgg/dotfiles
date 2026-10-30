-- Offline: no compositor, processes, or desktop settings.
local policy = dofile("linux/home/.config/hypr/cursor-scale.lua")
local events, calls, tick = {}, {}, nil
local monitor
local outputs = {}
local hl = {
    get_monitors = function() return outputs end,
    get_monitor_at_cursor = function()
        assert(#outputs > 0, "must not query pointer without outputs")
        return monitor
    end,
    exec_cmd = function(command) calls[#calls + 1] = command end,
    on = function(event, callback) events[event] = callback end,
    timer = function(callback, opts)
        assert(not tick, "only one timer")
        assert(opts.timeout == 250 and opts.type == "repeat")
        tick = callback
    end,
}
policy.setup(hl)
assert(#calls == 0 and tick == nil)
events["config.reloaded"]()
assert(#calls == 0 and tick == nil, "headless verification must not create timers")
outputs = { {} }
events["config.reloaded"]()
assert(tick and #calls == 0, "missing pointer monitor must be a no-op")
monitor = { name = "DP-3" }
events["hyprland.start"]()
assert(calls[1] == "hyprctl setcursor macOS-27 36 && gsettings set org.gnome.desktop.interface cursor-size 36")
for _ = 1, 20 do tick() end
assert(#calls == 1, "do not spawn while size is unchanged")
monitor = { name = "HDMI-A-1" }
tick()
assert(calls[2] == "hyprctl setcursor macOS-27 24 && gsettings set org.gnome.desktop.interface cursor-size 24")
monitor = { name = "untrusted; exit 1" }
tick()
assert(#calls == 2, "unknown outputs use the same safe fallback")
monitor = nil
tick()
assert(#calls == 2)
monitor = { name = "DP-3" }
tick()
assert(#calls == 3 and calls[3] == calls[1])
events["config.reloaded"]()
assert(#calls == 4 and calls[4] == calls[1], "reload re-applies the desired size")
assert(monitor.name == "DP-3" and monitor.scale == nil, "never mutate the output")
print("PASS: cursor sizing, unchanged-size deduplication, missing/unknown outputs, reload and safe commands")
