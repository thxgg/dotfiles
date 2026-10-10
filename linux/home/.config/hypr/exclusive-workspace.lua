-- WoW's normal-control guard and workspace policy (Hyprland 0.56 Lua API).
-- Events run inside compositor moves. Defer mutations until those moves finish.
local M = {}

function M.is_game(window)
    return window ~= nil and window.initial_title == "World of Warcraft"
end

function M.setup(hl, main_monitor)
    local locations = {}
    local pending = {}
    local scheduled = false

    local function workspace_id(window)
        return window.workspace and window.workspace.id
    end

    local function range(id)
        if id and id >= 1 and id <= 5 then return 1 end
        if id and id >= 11 and id <= 15 then return 11 end
    end

    local function windows(id)
        local result = {}
        -- Do not query an absent workspace: the API can fall back to all windows.
        for _, window in ipairs(hl.get_windows()) do
            if workspace_id(window) == id then result[#result + 1] = window end
        end
        return result
    end

    local function owner(id, except)
        for _, window in ipairs(windows(id)) do
            if M.is_game(window) and window.address ~= except then return window end
        end
    end

    local function next_workspace(id, empty, except)
        local first = range(id)
        if not first then return nil end
        for step = 1, 4 do
            local candidate = first + (id - first + step) % 5
            if not owner(candidate, except) and (not empty or #windows(candidate) == 0) then
                return candidate
            end
        end
    end

    local function warn()
        hl.notification.create({ text = "WoW: no available workspace in this monitor's five-workspace range.", timeout = 5000 })
    end

    local function move(window, destination, follow)
        if M.is_game(window) then locations[window.address] = destination end
        hl.dispatch(hl.dsp.window.move({ window = window, workspace = destination, follow = follow }))
    end

    local function fullscreen(window)
        if window.floating then
            hl.dispatch(hl.dsp.window.float({ window = window, action = "off" }))
        end
        hl.dispatch(hl.dsp.window.fullscreen({ window = window, action = "set", layout_aware = false }))
    end

    local function evict(game, destination)
        local id = workspace_id(game)
        for _, window in ipairs(windows(id)) do
            if window.address ~= game.address and not M.is_game(window) then
                move(window, destination, false)
            end
        end
        fullscreen(game)
    end

    local function handle(item)
        local window = item.window
        if not window.mapped or not window.address then return end
        local id = workspace_id(window)
        if item.kind == "open" and M.is_game(window) then
            local monitor = hl.get_monitor(main_monitor) or window.monitor or hl.get_active_monitor()
            id = monitor and monitor.active_workspace and monitor.active_workspace.id
        end
        if not range(id) then return end
        if item.to and item.to ~= id then return end -- superseded move
        if M.is_game(window) then
            if item.kind == "open" then
                -- Use the main monitor's current workspace, not the launcher's.
                -- Keep another game in place and use an empty slot in that case.
                local destination = id
                if owner(id, window.address) then destination = next_workspace(id, true) end
                if destination then
                    local overflow = next_workspace(destination, false, window.address)
                    if not overflow then warn(); return end
                    move(window, destination, true)
                    evict(window, overflow)
                else
                    warn()
                end
            elseif item.kind == "move" and item.from and item.from ~= id then
                if owner(id, window.address) then
                    -- Two exclusive windows cannot own the same workspace.
                    move(window, item.from, true)
                    fullscreen(window)
                else
                    evict(window, item.from)
                end
            elseif item.kind == "adopt" then
                local destination = next_workspace(id, false)
                if destination then evict(window, destination) else warn() end
            end
        else
            local game = owner(id)
            if not game then return end
            local destination = next_workspace(id, false)
            if destination then
                move(window, destination, false)
                fullscreen(game)
            else
                warn()
            end
        end
    end

    local function enqueue(item)
        pending[#pending + 1] = item
        if scheduled then return end
        scheduled = true
        hl.timer(function()
            local batch = pending
            pending = {}
            -- Keep scheduled true while dispatching to collect synchronous events.
            for _, entry in ipairs(batch) do handle(entry) end
            scheduled = false
            if #pending > 0 then
                local rest = pending
                pending = {}
                for _, entry in ipairs(rest) do enqueue(entry) end
            end
        end, { timeout = 1, type = "oneshot" })
    end

    hl.on("window.open", function(window)
        if M.is_game(window) then locations[window.address] = workspace_id(window) end
        enqueue({ kind = "open", window = window })
    end)
    hl.on("window.move_to_workspace", function(window, destination)
        local old = locations[window.address]
        if M.is_game(window) then locations[window.address] = destination.id end
        -- Ignore policy-generated moves, including its launch placement.
        if M.is_game(window) and old == destination.id then return end
        enqueue({ kind = "move", window = window, from = old, to = destination.id })
    end)
    hl.on("window.close", function(window) locations[window.address] = nil end)
    hl.on("config.reloaded", function()
        for _, window in ipairs(hl.get_windows()) do
            if M.is_game(window) then
                locations[window.address] = workspace_id(window)
                enqueue({ kind = "adopt", window = window })
            end
        end
    end)

    local controls = {}
    function controls.toggle_float()
        local window = hl.get_active_window()
        if not window or M.is_game(window) then return end
        hl.dispatch(hl.dsp.window.float({ window = window }))
        hl.dispatch(hl.dsp.window.center({ window = window }))
    end

    function controls.special()
        if M.is_game(hl.get_active_window()) then return end
        hl.dispatch(hl.dsp.window.move({ workspace = "special:magic" }))
    end

    function controls.mouse(dispatcher)
        local dragging = false
        return function()
            -- The Lua mouse dispatcher asks Hyprland to call this again on release.
            -- Always forward that release, even if the pointer is now over WoW.
            if dragging then
                dragging = false
                hl.dispatch(dispatcher)
                return
            end
            local monitor = hl.get_monitor_at_cursor()
            local cursor = hl.get_cursor_pos()
            if monitor and cursor then
                local workspace = monitor.active_special_workspace or monitor.active_workspace
                -- visible alone includes off-workspace surfaces. Check the pointer
                -- monitor's top workspace as well as geometry, not keyboard focus.
                for _, window in ipairs(hl.get_windows()) do
                    if M.is_game(window) and window.visible and workspace
                        and workspace_id(window) == workspace.id then
                        local at, size = window.at, window.size
                        if cursor.x >= at.x and cursor.x < at.x + size.x
                            and cursor.y >= at.y and cursor.y < at.y + size.y then
                            return
                        end
                    end
                end
            end
            dragging = true
            hl.dispatch(dispatcher)
        end
    end
    return controls
end

return M
