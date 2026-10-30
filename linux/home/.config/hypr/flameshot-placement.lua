-- Hyprland 0.57 applies new_float_force_onscreen after static move rules.
-- A desktop-wide Flameshot overlay cannot fit inside a single monitor.
local M = {}

function M.setup(hl)
    hl.on("window.open", function(window)
        if window.class ~= "flameshot" then return end

        -- Wait until mapping, fullscreen requests, and layout updates finish.
        hl.timer(function()
            if not window.mapped or window.class ~= "flameshot" or not window.floating then return end
            -- Match the static move rule and this configuration's desktop origin.
            -- Do not resize, focus, or change the workspace/fullscreen state.
            hl.dispatch(hl.dsp.window.move({ window = window, x = 0, y = 0 }))
        end, { timeout = 1, type = "oneshot" })
    end)
end

return M
