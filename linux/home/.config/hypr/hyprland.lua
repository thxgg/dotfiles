-- Hyprland Lua configuration.
-- See https://wiki.hypr.land/Configuring/Start/

local theme = require("mocha")

----------------
--- MONITORS ---
----------------

hl.monitor({ output = "DP-3", mode = "3840x2160", position = "0x0", scale = 1 })
hl.monitor({ output = "HDMI-A-1", mode = "1920x1080", position = "3840x0", scale = 1 })

-------------------
--- MY PROGRAMS ---
-------------------

local terminal = "ghostty"
local browser = "helium-browser"
local browser2 = "google-chrome-stable --ozone-platform=x11 --force-device-scale-factor=1"
local fileManager = "nautilus"
local menu = os.getenv("HOME") .. "/.local/bin/rofi -show drun"
local discord = "discord --enable-features=UseOzonePlatform,WaylandWindowDecorations --ozone-platform=wayland"

-----------------
--- AUTOSTART ---
-----------------

hl.on("hyprland.start", function()
    local commands = {
        "systemctl --user import-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE DISPLAY",
        "dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE DISPLAY",
        "systemctl --user start hyprland-session.target",
        "systemctl --user restart xdg-desktop-portal-hyprland.service xdg-desktop-portal.service",
        "systemctl --user start hyprpolkitagent",
        "udiskie",
        "bash -lc '$HOME/.local/bin/theme-mode --quiet --session-init apply'",
        os.getenv("HOME") .. "/.config/hypr/scripts/start-hyprpanel.sh",
        "bash -lc 'QT_QPA_PLATFORM=wayland XDG_CURRENT_DESKTOP=Hyprland flameshot'",
        "dropbox",
        "wl-clip-persist --clipboard regular",
        "wl-paste --type text --watch cliphist store",
        "wl-paste --type image --watch cliphist store",
        os.getenv("HOME") .. "/.config/hypr/scripts/switch-keyboard-layout.sh --sync-only",
    }

    for _, command in ipairs(commands) do
        hl.dispatch(hl.dsp.exec_cmd(command))
    end
end)

hl.on("hyprland.shutdown", function()
    hl.dispatch(hl.dsp.exec_cmd("systemctl --user stop hyprland-session.target"))
end)

-----------------------------
--- ENVIRONMENT VARIABLES ---
-----------------------------

hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")
hl.env("QT_QPA_PLATFORMTHEME", "qt6ct")
hl.env("QT_STYLE_OVERRIDE", "kvantum")

---------------------
--- LOOK AND FEEL ---
---------------------

hl.config({
    general = {
        border_size = 1,
        gaps_in = 5,
        gaps_out = 10,
        col = {
            inactive_border = theme.overlay0,
            active_border = theme.lavender,
        },
        layout = "dwindle",
        resize_on_border = true,
        extend_border_grab_area = 10,
    },
    decoration = {
        rounding = 0,
        blur = { size = 3 },
    },
    animations = { enabled = true },
    dwindle = { preserve_split = true },
    master = { new_status = "master" },
    misc = {
        force_default_wallpaper = 0,
        disable_hyprland_logo = true,
    },
    ecosystem = {
        no_update_news = true,
        no_donation_nag = true,
    },
})

hl.curve("myBezier", {
    type = "bezier",
    points = { { 0.05, 0.9 }, { 0.1, 1.05 } },
})

hl.animation({ leaf = "windows", enabled = true, speed = 7, bezier = "myBezier" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 7, bezier = "default", style = "popin 80%" })
hl.animation({ leaf = "border", enabled = true, speed = 10, bezier = "default" })
hl.animation({ leaf = "borderangle", enabled = true, speed = 8, bezier = "default" })
hl.animation({ leaf = "fade", enabled = true, speed = 7, bezier = "default" })
hl.animation({ leaf = "workspaces", enabled = true, speed = 6, bezier = "default" })

-------------
--- INPUT ---
-------------

hl.config({
    input = {
        kb_layout = "us,bg",
        kb_variant = ",phonetic",
        kb_model = "",
        kb_options = "caps:none,altwin:swap_alt_win",
        kb_rules = "",
        follow_mouse = 1,
        sensitivity = 0,
        touchpad = { natural_scroll = true },
    },
})

hl.device({ name = "epic-mouse-v1", sensitivity = -0.5 })

-------------------
--- KEYBINDINGS ---
-------------------

local mainMod = "SUPER"
local home = os.getenv("HOME")

hl.bind(mainMod .. " + RETURN", hl.dsp.exec_cmd(terminal))
hl.bind(mainMod .. " + B", hl.dsp.exec_cmd(browser))
hl.bind(mainMod .. " + SHIFT + B", hl.dsp.exec_cmd(browser2))
hl.bind(mainMod .. " + Q", hl.dsp.window.close())
hl.bind(mainMod .. " + E", hl.dsp.exec_cmd(fileManager))
hl.bind(mainMod .. " + D", hl.dsp.exec_cmd(discord))
hl.bind(mainMod .. " + SHIFT + D", hl.dsp.exec_cmd("slack"))
hl.bind(mainMod .. " + F", hl.dsp.exec_cmd('hyprctl --batch "dispatch togglefloating ; dispatch centerwindow 1"'))
hl.bind(mainMod .. " + V", hl.dsp.exec_cmd('cliphist list | ' .. home .. '/.local/bin/wofi --dmenu --prompt="Clipboard" --width=760 --height=520 --sort-order=default --cache-file /dev/null --no-custom-entry | cliphist decode | wl-copy'))
hl.bind(mainMod .. " + SHIFT + V", hl.dsp.exec_cmd('cliphist list | ' .. home .. '/.local/bin/wofi --dmenu --prompt="Delete clipboard entry" --width=760 --height=520 --sort-order=default --cache-file /dev/null --no-custom-entry | cliphist delete'))
hl.bind(mainMod .. " + C", hl.dsp.window.center())
hl.bind(mainMod .. " + SPACE", hl.dsp.exec_cmd(menu))
hl.bind("CTRL + ALT + SPACE", hl.dsp.exec_cmd(home .. "/.config/hypr/scripts/switch-keyboard-layout.sh"))

hl.bind(mainMod .. " + left", hl.dsp.focus({ direction = "left" }))
hl.bind(mainMod .. " + right", hl.dsp.focus({ direction = "right" }))
hl.bind(mainMod .. " + up", hl.dsp.focus({ direction = "up" }))
hl.bind(mainMod .. " + down", hl.dsp.focus({ direction = "down" }))

local function workspaceForActiveMonitor(slot)
    return hl.get_active_monitor().name == "HDMI-A-1" and slot + 10 or slot
end

for workspace = 1, 5 do
    local slot = workspace

    hl.bind(mainMod .. " + " .. slot, function()
        hl.dispatch(hl.dsp.focus({ workspace = workspaceForActiveMonitor(slot) }))
    end)

    hl.bind(mainMod .. " + SHIFT + " .. slot, function()
        hl.dispatch(hl.dsp.window.move({ workspace = workspaceForActiveMonitor(slot) }))
    end)
end

hl.bind(mainMod .. " + S", hl.dsp.workspace.toggle_special("magic"))
hl.bind(mainMod .. " + SHIFT + S", hl.dsp.window.move({ workspace = "special:magic" }))
hl.bind(mainMod .. " + mouse_down", hl.dsp.focus({ workspace = "e+1" }))
hl.bind(mainMod .. " + mouse_up", hl.dsp.focus({ workspace = "e-1" }))
hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })
hl.bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), { mouse = true })

hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd(home .. "/.config/hypr/scripts/volume-step.sh up"), { locked = true, repeating = true })
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd(home .. "/.config/hypr/scripts/volume-step.sh down"), { locked = true, repeating = true })
hl.bind("XF86AudioMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"), { locked = true, repeating = true })
hl.bind("XF86AudioMicMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"), { locked = true, repeating = true })
hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("brightnessctl s 10%+"), { locked = true, repeating = true })
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl s 10%-"), { locked = true, repeating = true })
hl.bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"), { locked = true })
hl.bind("XF86AudioPause", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"), { locked = true })
hl.bind("Print", hl.dsp.exec_cmd("bash -lc 'QT_QPA_PLATFORM=wayland XDG_CURRENT_DESKTOP=Hyprland flameshot gui'"))

------------------------------
--- WINDOWS AND WORKSPACES ---
------------------------------

hl.window_rule({
    name = "suppress-maximize-events",
    match = { class = ".*" },
    suppress_event = "maximize",
})

hl.window_rule({
    name = "fix-xwayland-drags",
    match = {
        class = "^$",
        title = "^$",
        xwayland = true,
        float = true,
        fullscreen = false,
        pin = false,
    },
    no_focus = true,
})

hl.window_rule({
    name = "float-bitwarden-popouts",
    match = { class = ".*nngceckbapebfimnlniiiahkandclblb.*" },
    float = true,
})

for workspace = 1, 5 do
    hl.workspace_rule({ workspace = tostring(workspace), monitor = "DP-3", default = workspace == 1 })
end
for workspace = 11, 15 do
    hl.workspace_rule({ workspace = tostring(workspace), monitor = "HDMI-A-1", default = workspace == 11 })
end

local function xwaylandVideoBridgeRule(name, effect)
    effect.name = name
    effect.match = { class = "xwaylandvideobridge" }
    hl.window_rule(effect)
end

xwaylandVideoBridgeRule("hide-xwayland-video-bridge", { opacity = "0.0 override" })
xwaylandVideoBridgeRule("disable-xwayland-video-bridge-animation", { no_anim = true })
xwaylandVideoBridgeRule("prevent-xwayland-video-bridge-initial-focus", { no_initial_focus = true })
xwaylandVideoBridgeRule("shrink-xwayland-video-bridge", { max_size = "1 1" })
xwaylandVideoBridgeRule("disable-xwayland-video-bridge-blur", { no_blur = true })
xwaylandVideoBridgeRule("prevent-xwayland-video-bridge-focus", { no_focus = true })

local function flameshotRule(name, effect)
    effect.name = name
    effect.match = { class = "flameshot" }
    hl.window_rule(effect)
end

flameshotRule("disable-flameshot-animation", { no_anim = true })
flameshotRule("float-flameshot", { float = true })
flameshotRule("move-flameshot", { move = "0 0" })
flameshotRule("pin-flameshot", { pin = true })
flameshotRule("place-flameshot", { monitor = "DP-3" })
flameshotRule("fullscreen-flameshot", { fullscreen = true })
