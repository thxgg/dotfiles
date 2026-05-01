local M = {}

local function fallback_mode_file()
	local home = vim.uv.os_homedir()
	return home .. "/.local/state/theme/mode"
end

local function read_mode_file()
	local ok, lines = pcall(vim.fn.readfile, fallback_mode_file())
	if not ok or not lines or not lines[1] then
		return "dark"
	end

	local mode = vim.trim(lines[1])
	if mode == "auto" then
		return "dark"
	end
	if mode ~= "light" and mode ~= "dark" then
		return "dark"
	end

	return mode
end

local function read_mode()
	local home = vim.uv.os_homedir()
	local theme_mode = home .. "/.local/bin/theme-mode"

	if vim.fn.executable(theme_mode) == 1 then
		local result = vim.fn.system({ theme_mode, "get" })
		if vim.v.shell_error == 0 then
			local mode = vim.trim(result)
			if mode == "light" or mode == "dark" then
				return mode
			end
		end
	end

	return read_mode_file()
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
