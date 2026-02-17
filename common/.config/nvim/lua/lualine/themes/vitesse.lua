-- Vitesse theme for lualine
-- Based on the Vitesse Black VSCode theme
local function get_vitesse_theme()
	local vitesse = require("vitesse")
	local palette = require("vitesse.palettes").get_palette(vitesse.flavour)
	local O = vitesse.options

	-- Determine background based on transparency settings
	local bg_base = O.transparent_background and "NONE" or palette.base
	local bg_mantle = O.transparent_background and "NONE" or palette.mantle
	local bg_crust = O.transparent_background and "NONE" or palette.crust

	local colors = {
		-- Background layers (from darkest to brightest in the UI context)
		bg = bg_base, -- Main sections (lualine_c)
		bg_alt = bg_mantle, -- Secondary sections (lualine_b)
		bg_accent = bg_crust, -- Mode indicator (lualine_a)

		-- Foreground colors
		fg = palette.text,
		fg_alt = palette.subtext1,
		fg_dim = palette.subtext0,

		-- Mode colors
		green = palette.green, -- Normal mode
		blue = palette.blue, -- Insert mode
		yellow = palette.yellow, -- Command mode
		red = palette.red, -- Replace mode
		pink = palette.pink, -- Visual mode
		peach = palette.peach, -- Terminal mode

		-- Diagnostic colors
		error = palette.red,
		warning = palette.yellow,
		info = palette.blue,
		hint = palette.teal,
	}

	-- Helper to create mode sections with proper styling
	local function mode_section(fg, bg, gui)
		return {
			a = { fg = bg or colors.bg_accent, bg = fg, gui = gui or "bold" },
			b = { fg = colors.fg_alt, bg = colors.bg_alt },
			c = { fg = colors.fg_dim, bg = colors.bg },
		}
	end

	return {
		normal = mode_section(colors.green),
		insert = mode_section(colors.blue),
		visual = mode_section(colors.pink),
		replace = mode_section(colors.red),
		command = mode_section(colors.yellow),
		terminal = mode_section(colors.peach),

		inactive = {
			a = { fg = colors.fg_dim, bg = colors.bg_alt, gui = "bold" },
			b = { fg = colors.fg_dim, bg = colors.bg_alt },
			c = { fg = colors.fg_dim, bg = colors.bg },
		},
	}
end

return get_vitesse_theme()
