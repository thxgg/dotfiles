-- Herdr-style navigation. Appearance and shell settings remain in Rex.
local function prefix(key, action, args)
  rex.bind("ctrl+x>" .. key, action, args)
end

-- Send a literal Ctrl+x by pressing it twice.
prefix("ctrl+x", "pane.send_key", { key = "ctrl+x" })
prefix("shift+/", "client.palette.toggle") -- ? on a US layout
prefix("shift+s", "client.settings")
prefix("r", "client.config.reload")

-- Herdr workspaces are Rex sessions.
prefix("s", "session.switch")
prefix("w", "session.switch")
prefix("shift+n", "session.new")
prefix("shift+w", "session.rename")
prefix("shift+d", "session.close")
prefix("shift+9", "session.previous") -- (
prefix("shift+0", "session.next") -- )

-- Tabs are called windows in the Rex server API.
prefix("c", "client.tab.new")
prefix("p", "client.tab.previous")
prefix("n", "client.tab.next")
prefix(",", "client.tab.rename")
prefix("shift+x", "client.tab.close")
for index = 1, 9 do
  prefix(tostring(index), "client.tab.goto", { index = index })
end

prefix("\\", "pane.split", { direction = "right" })
prefix("enter", "pane.split", { direction = "down" })
prefix("x", "pane.close")
prefix("m", "pane.zoom")
prefix("tab", "pane.focus_next")
prefix("shift+tab", "pane.focus_previous")
prefix("b", "client.sidebar.toggle")

-- These direct chords intentionally take precedence over terminal programs.
local directions = { h = "left", j = "down", k = "up", l = "right" }
for key, direction in pairs(directions) do
  rex.bind("ctrl+" .. key, "pane.focus", { direction = direction })
end

-- Ignore unrelated keys while resizing, rather than typing into the terminal.
rex.mode("resize", { exclusive = true })
prefix("shift+r", "client.mode.enter", { name = "resize" })
for key, direction in pairs(directions) do
  rex.bind("resize/" .. key, "pane.resize", { direction = direction })
  rex.bind("resize/" .. direction, "pane.resize", { direction = direction })
end
rex.bind("resize/=", "pane.balance")
rex.bind("resize/enter", "client.mode.exit")
rex.bind("resize/escape", "client.mode.exit")

-- No substitutes for Herdr detach (prefix+d/q), copy mode (prefix+v),
-- goto (prefix+g), or numbered agent focus. In particular, detach must not
-- become session.close: closing a session terminates its programs.
