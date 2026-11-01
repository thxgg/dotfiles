local M = {}

-- Static default. Select a different variant in this file, not shared runtime state.
local function read_mode()
	return "dark"
end

M.mode = read_mode

function M.background()
	return read_mode() == "light" and "light" or "dark"
end

function M.catppuccin_flavour()
	return read_mode() == "light" and "latte" or "mocha"
end

function M.catppuccin_color_overrides()
	return {}
end

function M.catppuccin_custom_highlights(colors)
	return {
		Cursor = { fg = colors.base, bg = colors.lavender },
		CursorLineNr = { fg = colors.lavender, bold = true },
		FloatBorder = { fg = colors.lavender },
		Search = { fg = colors.base, bg = colors.lavender },
		IncSearch = { fg = colors.crust, bg = colors.lavender },
		Visual = { bg = colors.surface1 },
	}
end

return M
