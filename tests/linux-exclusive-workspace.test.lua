-- Offline: no compositor, shell, inherited startup files, or desktop commands.
local policy = dofile("linux/home/.config/hypr/exclusive-workspace.lua")
local count = 0
local function test(name, run)
    run()
    count = count + 1
    print("OK " .. name)
end

local function fixture()
    local f = { windows = {}, events = {}, timers = {}, calls = {}, warnings = 0,
        cursor = { x = 10, y = 10 }, monitor = { name = "DP-3", active_workspace = { id = 3 } } }
    f.main_monitor = f.monitor
    local function emit(name, ...)
        if f.events[name] then f.events[name](...) end
    end
    local hl = {
        get_windows = function() return f.windows end,
        get_active_window = function() return f.active end,
        get_monitor_at_cursor = function() return f.monitor end,
        get_active_monitor = function() return f.monitor end,
        get_monitor = function(name)
            assert(name == "DP-3")
            return f.main_monitor
        end,
        get_cursor_pos = function() return f.cursor end,
        on = function(event, callback) f.events[event] = callback end,
        timer = function(callback) f.timers[#f.timers + 1] = callback end,
        notification = { create = function() f.warnings = f.warnings + 1 end },
        dsp = { window = {} },
    }
    for _, name in ipairs({ "move", "float", "fullscreen", "center", "drag", "resize" }) do
        hl.dsp.window[name] = function(args) return { name = name, args = args or {} } end
    end
    hl.dispatch = function(command)
        f.calls[#f.calls + 1] = command
        local args = command.args
        local w = args.window or f.active
        if command.name == "move" then
            local id = args.workspace
            w.workspace = { id = id }
            -- Mimic the synchronous event before the outer compositor move finishes.
            emit("window.move_to_workspace", w, w.workspace)
            if args.follow then f.active = w end
        elseif command.name == "fullscreen" then
            assert(args.action == "set" and args.layout_aware == false)
            w.fullscreen = 2
        elseif command.name == "float" then
            assert(args.action == nil or args.action == "off")
            w.floating = args.action ~= "off" and not w.floating
        end
    end
    function f.add(id, game)
        local w = { address = tostring(#f.windows + 1), workspace = { id = id },
            initial_title = game and "World of Warcraft" or "App", mapped = true,
            visible = true, floating = false, fullscreen = 0,
            at = { x = 0, y = 0 }, size = { x = 1920, y = 1080 } }
        f.windows[#f.windows + 1] = w
        return w
    end
    function f.flush()
        local rounds = 0
        while #f.timers > 0 do
            rounds = rounds + 1
            assert(rounds < 20, "event feedback loop")
            local batch = f.timers
            f.timers = {}
            for _, cb in ipairs(batch) do cb() end
        end
    end
    function f.adopt() emit("config.reloaded"); f.flush(); f.calls = {} end
    function f.open(w) emit("window.open", w); f.flush() end
    function f.move(w, id)
        w.workspace = { id = id }
        emit("window.move_to_workspace", w, w.workspace)
    end
    f.emit = emit
    f.hl = hl
    f.controls = policy.setup(hl, "DP-3")
    return f
end

local function at(w, id) assert(w.workspace.id == id, tostring(w.workspace.id) .. " ~= " .. id) end

test("launch uses main active workspace and sends occupants to next slot", function()
    local f = fixture()
    local source, occupant, next_app = f.add(2), f.add(3), f.add(4)
    local game = f.add(2, true)
    f.open(game)
    at(game, 3); at(source, 2); at(occupant, 4); at(next_app, 4)
    assert(f.active == game and game.fullscreen == 2)
end)

test("secondary launch and focus still use the main current workspace", function()
    local f = fixture()
    f.main_monitor.active_workspace.id = 5
    f.monitor = { name = "HDMI-A-1", active_workspace = { id = 15 } }
    local occupant = f.add(5)
    local game = f.add(15, true)
    game.monitor = f.monitor
    f.open(game)
    at(game, 5); at(occupant, 1)
end)

test("missing main monitor falls back to the launch monitor", function()
    local f = fixture()
    f.main_monitor = nil
    f.monitor = { name = "HDMI-A-1", active_workspace = { id = 15 } }
    local game, app = f.add(11, true), f.add(15)
    game.monitor = f.monitor
    f.open(game)
    at(game, 15); at(app, 11)
end)

test("launch on the main current workspace evicts without moving to another slot", function()
    local f = fixture()
    local game, app = f.add(3, true), f.add(3)
    f.open(game)
    at(game, 3); at(app, 4)
end)

test("move evicts all destination occupants to the source", function()
    local f = fixture()
    local game = f.add(3, true)
    local a, b = f.add(4), f.add(4)
    b.floating = true
    f.adopt()
    f.move(game, 4)
    at(a, 4) -- no mutations inside the compositor's move event
    f.flush()
    at(a, 3); at(b, 3); at(game, 4)
    assert(b.floating and game.fullscreen == 2)
    f.move(game, 2); f.flush()
    at(a, 3); at(b, 3)
end)

test("ordinary new and incoming windows go to the next occupied workspace", function()
    local f = fixture()
    local game = f.add(3, true)
    local existing = f.add(4)
    f.adopt()
    local new = f.add(3)
    f.open(new)
    at(new, 4); at(existing, 4); at(game, 3)
    f.move(existing, 3); f.flush(); at(existing, 4)
    assert(game.fullscreen == 2)
end)

test("eviction wraps 5 to 1 and 15 to 11", function()
    for _, id in ipairs({ 5, 15 }) do
        local f = fixture()
        f.add(id, true); f.adopt()
        local app = f.add(id)
        f.open(app)
        at(app, id - 4)
    end
end)

test("cross-monitor game moves return occupants to the actual source", function()
    local f = fixture()
    local game, app = f.add(3, true), f.add(12)
    f.adopt(); f.move(game, 12); f.flush()
    at(app, 3); at(game, 12)
end)

test("reload adopts an existing game without relocating it", function()
    local f = fixture()
    local game, app = f.add(3, true), f.add(3)
    game.floating = true
    f.adopt()
    at(game, 3); at(app, 4)
    assert(not game.floating and game.fullscreen == 2)
    f.adopt(); at(game, 3); at(app, 4)
end)

test("closed games release workspace and pending callbacks ignore dead windows", function()
    local f = fixture()
    local game = f.add(3, true)
    f.adopt()
    f.move(game, 4)
    game.mapped = false
    f.emit("window.close", game)
    f.windows = {}
    f.flush()
    local app = f.add(3)
    f.open(app); at(app, 3)
end)

test("occupied main range still launches on the current workspace", function()
    local f = fixture()
    local apps = {}
    for id = 1, 5 do apps[id] = f.add(id) end
    local game = f.add(12, true)
    f.open(game)
    at(game, 3); at(apps[3], 4)
    assert(f.warnings == 0)
end)

test("another game on main current workspace uses the next empty main slot", function()
    local f = fixture()
    local existing, app = f.add(3, true), f.add(4)
    local game = f.add(12, true)
    f.open(game)
    at(existing, 3); at(app, 4); at(game, 5)
end)

test("game collision without an empty slot warns without moving windows", function()
    local f = fixture()
    for id = 1, 5 do f.add(id, id == 3) end
    local game = f.add(12, true)
    f.open(game)
    at(game, 12)
    assert(f.warnings == 1 and #f.calls == 0)
end)

test("exclusive owners are skipped and collisions return the incoming game", function()
    local f = fixture()
    local first, second = f.add(3, true), f.add(4, true)
    f.adopt()
    local app = f.add(3)
    f.open(app); at(app, 5)
    f.move(first, 4); f.flush()
    at(first, 3); at(second, 4)
end)

test("rapid successive moves ignore stale destinations", function()
    local f = fixture()
    local game, a, b = f.add(2, true), f.add(3), f.add(4)
    f.adopt()
    f.move(game, 3); f.move(game, 4); f.flush()
    at(game, 4); at(a, 3); at(b, 3)
end)

test("normal floating works and WoW floating and special moves are blocked", function()
    local f = fixture()
    local game, app = f.add(3, true), f.add(4)
    f.active = game
    f.controls.toggle_float(); f.controls.special()
    assert(#f.calls == 0)
    f.active = app
    f.controls.toggle_float()
    assert(app.floating and #f.calls == 2 and f.calls[2].name == "center")
    f.controls.special(); at(app, "special:magic")
end)

test("mouse guard uses pointer geometry and forwards releases over WoW", function()
    for _, action in ipairs({ "drag", "resize" }) do
        local f = fixture()
        local game, app = f.add(3, true), f.add(11)
        f.active = app -- keyboard focus differs from pointer target
        local callback = f.controls.mouse(f.hl.dsp.window[action]())
        callback(); assert(#f.calls == 0)
        f.cursor.x = 2000
        callback(); assert(#f.calls == 1)
        f.cursor.x = 10
        callback(); assert(#f.calls == 2) -- release must end the drag
        callback(); assert(#f.calls == 2) -- new press is blocked
        game.visible = false
        callback(); assert(#f.calls == 3)
    end
end)

test("game on a hidden workspace does not block ordinary windows at the same coordinates", function()
    local f = fixture()
    f.add(2, true)
    local callback = f.controls.mouse(f.hl.dsp.window.drag())
    callback(); callback()
    assert(#f.calls == 2)
    f.add(3, true)
    f.monitor.active_special_workspace = { id = -99 }
    callback(); callback()
    assert(#f.calls == 4)
end)

test("launch from the scratchpad uses the main regular active workspace", function()
    local f = fixture()
    f.main_monitor.active_special_workspace = { id = -99 }
    f.monitor = { name = "HDMI-A-1", active_workspace = { id = 13 } }
    local game = f.add(-99, true)
    game.monitor = f.monitor
    f.open(game)
    at(game, 3)
end)

test("unrelated Wine and special workspace windows are unchanged", function()
    local f = fixture()
    local wine = f.add(3)
    wine.class = "wine"
    f.open(wine); at(wine, 3)
    f.add(3, true); f.adopt()
    local special = f.add(-99)
    f.open(special); at(special, -99)
end)

print(string.format("%d exclusive workspace checks passed", count))
