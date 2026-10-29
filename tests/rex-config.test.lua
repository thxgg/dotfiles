-- Run with: lua tests/rex-config.test.lua
-- Only capture declarations. Never connect to Rex or invoke an action.
local bindings, modes = {}, {}
rex = {
  bind = function(key, action, args)
    assert(not bindings[key], "Duplicate binding: " .. key)
    bindings[key] = { action = action, args = args or {} }
  end,
  mode = function(name, options)
    modes[name] = options
  end,
}
dofile("common/.config/rex/init.lua")

local function expect(key, action, arg, value)
  local binding = assert(bindings[key], "Missing binding: " .. key)
  assert(binding.action == action, "Wrong action: " .. key)
  if arg then assert(binding.args[arg] == value, "Wrong argument: " .. key) end
end

expect("ctrl+x>ctrl+x", "pane.send_key", "key", "ctrl+x")
expect("ctrl+x>s", "session.switch")
expect("ctrl+x>w", "session.switch")
expect("ctrl+x>shift+n", "session.new")
expect("ctrl+x>shift+w", "session.rename")
expect("ctrl+x>shift+d", "session.close")
expect("ctrl+x>shift+9", "session.previous")
expect("ctrl+x>shift+0", "session.next")
expect("ctrl+x>c", "client.tab.new")
expect("ctrl+x>p", "client.tab.previous")
expect("ctrl+x>n", "client.tab.next")
expect("ctrl+x>,", "client.tab.rename")
expect("ctrl+x>shift+x", "client.tab.close")
for index = 1, 9 do
  expect("ctrl+x>" .. index, "client.tab.goto", "index", index)
end
expect("ctrl+x>\\", "pane.split", "direction", "right")
expect("ctrl+x>enter", "pane.split", "direction", "down")
expect("ctrl+x>x", "pane.close")
expect("ctrl+x>m", "pane.zoom")
expect("ctrl+x>tab", "pane.focus_next")
expect("ctrl+x>shift+tab", "pane.focus_previous")
expect("ctrl+x>b", "client.sidebar.toggle")
expect("ctrl+x>r", "client.config.reload")
expect("ctrl+x>shift+s", "client.settings")
expect("ctrl+x>shift+/", "client.palette.toggle")
expect("ctrl+x>shift+r", "client.mode.enter", "name", "resize")
assert(modes.resize.exclusive)
for key, direction in pairs({ h = "left", j = "down", k = "up", l = "right" }) do
  expect("ctrl+" .. key, "pane.focus", "direction", direction)
  expect("resize/" .. key, "pane.resize", "direction", direction)
  expect("resize/" .. direction, "pane.resize", "direction", direction)
end
expect("resize/=", "pane.balance")
expect("resize/enter", "client.mode.exit")
expect("resize/escape", "client.mode.exit")
for _, key in ipairs({ "ctrl+x", "ctrl+x>d", "ctrl+x>q", "ctrl+x>v", "ctrl+x>g" }) do
  assert(not bindings[key], "Unsupported shortcut must remain unbound: " .. key)
end
for _, binding in pairs(bindings) do
  assert(not binding.action:find("theme"), "Do not change appearance")
  assert(not binding.action:find("appearance"), "Do not change appearance")
end
print("Rex navigation checks passed")
