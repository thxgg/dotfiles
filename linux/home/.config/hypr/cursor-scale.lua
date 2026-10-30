-- Cursor-only sizing. Do not change monitor scale, geometry, or application UI.
local M = {}

function M.setup(hl)
    local lastSize
    local function update()
        -- Pointer location, not keyboard focus: focus can change on another screen.
        -- The headless config verifier has no outputs. Its pointer query is unsafe.
        if #hl.get_monitors() == 0 then return end
        local monitor = hl.get_monitor_at_cursor()
        if not monitor then return end
        local size = monitor.name == "DP-3" and 36 or 24
        if size == lastSize then return end
        lastSize = size
        -- Async: never run blocking IPC back into Hyprland from its Lua callback.
        -- Only constants enter this command; no monitor names or client data.
        hl.exec_cmd("hyprctl setcursor macOS-27 " .. size
            .. " && gsettings set org.gnome.desktop.interface cursor-size " .. size)
    end

    -- There is no Lua pointer-motion event in Hyprland 0.57. This queries local
    -- compositor state four times/second, with no process spawn until size changes.
    local started = false
    local function start()
        -- Do not create runtime timers during headless config verification.
        if #hl.get_monitors() == 0 then return end
        if not started then
            hl.timer(update, { timeout = 250, type = "repeat" })
            started = true
        end
        lastSize = nil
        update()
    end
    hl.on("config.reloaded", start)
    hl.on("hyprland.start", start)
end

return M
