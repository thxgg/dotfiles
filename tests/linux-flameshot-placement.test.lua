-- Offline: no compositor, shell, or desktop commands.
local policy = dofile("linux/home/.config/hypr/flameshot-placement.lua")
local count = 0
local function test(name, run)
    run()
    count = count + 1
    print("OK " .. name)
end

local function fixture()
    local f = { timers = {}, calls = {} }
    local hl = {
        on = function(event, callback)
            assert(event == "window.open")
            f.open = callback
        end,
        timer = function(callback, options)
            assert(options.timeout == 1 and options.type == "oneshot")
            f.timers[#f.timers + 1] = callback
        end,
        dsp = { window = { move = function(args) return args end } },
        dispatch = function(args)
            assert(args.x == 0 and args.y == 0)
            for key in pairs(args) do
                assert(key == "window" or key == "x" or key == "y")
            end
            f.calls[#f.calls + 1] = args
            args.window.at = { x = args.x, y = args.y }
        end,
    }
    function f.flush()
        local pending = f.timers
        f.timers = {}
        for _, callback in ipairs(pending) do callback() end
        assert(#f.timers == 0, "placement must not poll")
    end
    policy.setup(hl)
    return f
end

local function capture()
    return {
        class = "flameshot", mapped = true, floating = true,
        at = { x = -1920, y = 0 }, size = { x = 5760, y = 2160 },
        workspace = { id = 2 }, fullscreen = 0, pinned = true,
    }
end

test("corrects placement only after mapping finishes without other mutations", function()
    local f, w = fixture(), capture()
    local size, workspace = w.size, w.workspace
    f.open(w)
    assert(#f.calls == 0 and #f.timers == 1 and w.at.x == -1920)
    f.flush()
    assert(#f.calls == 1 and f.calls[1].window == w)
    assert(w.at.x == 0 and w.at.y == 0)
    assert(w.size == size and w.workspace == workspace)
    assert(w.fullscreen == 0 and w.pinned and w.floating)
end)

test("ignores unrelated applications without scheduling timers", function()
    local f = fixture()
    for _, class in ipairs({ "app", "World of Warcraft", "flameshot-other", "" }) do
        local w = capture()
        w.class = class
        f.open(w)
    end
    f.open({})
    assert(#f.calls == 0 and #f.timers == 0)
end)

test("ignores captures closed or changed before the timer runs", function()
    for _, change in ipairs({
        function(w) w.mapped = false end,
        function(w) w.class = "other" end,
        function(w) w.floating = false end,
    }) do
        local f, w = fixture(), capture()
        f.open(w)
        change(w)
        f.flush()
        assert(#f.calls == 0)
    end
end)

test("targets each capture rather than the currently focused window", function()
    local f, first, second = fixture(), capture(), capture()
    f.open(first)
    f.open(second)
    first.mapped = false
    f.flush()
    assert(#f.calls == 1 and f.calls[1].window == second)
    assert(first.at.x == -1920 and second.at.x == 0)
    local third = capture()
    f.open(third)
    f.flush()
    assert(#f.calls == 2 and f.calls[2].window == third)
end)

print(string.format("Passed %d Flameshot placement tests", count))
