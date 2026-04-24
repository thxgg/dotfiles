local M = {}

local function mode_file()
	local home = vim.uv.os_homedir()
	return home .. "/.local/state/theme/mode"
end

local function read_mode()
	local ok, lines = pcall(vim.fn.readfile, mode_file())
	if not ok or not lines or not lines[1] then
		return "dark"
	end

	local mode = vim.trim(lines[1])
	if mode ~= "light" and mode ~= "dark" then
		return "dark"
	end

	return mode
end

M.mode = read_mode

function M.background()
	return read_mode() == "light" and "light" or "dark"
end

function M.catppuccin_flavour()
	return read_mode() == "light" and "latte" or "mocha"
end

M.palettes = {
	dark = {
		rosewater = "#ffc08a",
		flamingo = "#ffb37a",
		pink = "#ffab66",
		mauve = "#ffa252",
		red = "#ff9940",
		maroon = "#f68a2c",
		peach = "#f48120",
		yellow = "#ffb04d",
		green = "#ff9c52",
		teal = "#f28f3b",
		sky = "#f48120",
		sapphire = "#e67300",
		blue = "#ff9c52",
		lavender = "#ffb366",
		text = "#ffffff",
		subtext1 = "#d6d6d6",
		subtext0 = "#b5b5b5",
		overlay2 = "#8c8c8c",
		overlay1 = "#666666",
		overlay0 = "#404040",
		surface2 = "#262626",
		surface1 = "#1a1a1a",
		surface0 = "#101010",
		base = "#050505",
		mantle = "#000000",
		crust = "#000000",
	},
	light = {
		rosewater = "#ffc08a",
		flamingo = "#ffb37a",
		pink = "#ffab66",
		mauve = "#ffa252",
		red = "#e96a00",
		maroon = "#f48120",
		peach = "#f48120",
		yellow = "#cc8400",
		green = "#ff9c52",
		teal = "#ff934f",
		sky = "#f48120",
		sapphire = "#e67300",
		blue = "#d96d00",
		lavender = "#ffb04d",
		text = "#161616",
		subtext1 = "#3e3e3e",
		subtext0 = "#5c5c5c",
		overlay2 = "#7a7a7a",
		overlay1 = "#9a9a9a",
		overlay0 = "#c4c4c4",
		surface2 = "#d9d9d9",
		surface1 = "#ececec",
		surface0 = "#ffffff",
		base = "#fafafa",
		mantle = "#f1f1f1",
		crust = "#e8e8e8",
	},
}

function M.catppuccin_color_overrides()
	return {
		mocha = M.palettes.dark,
		latte = M.palettes.light,
	}
end

return M
