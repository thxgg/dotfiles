local M = {}

-- No shared runtime state. :set background=light selects Merino Light.
function M.background()
	return vim.o.background
end

function M.palette()
	return require("user.merino_palette")[M.background()]
end

function M.color_overrides()
	local palettes = require("user.merino_palette")
	return { latte = palettes.light, mocha = palettes.dark }
end

function M.highlights(colors)
	return {
		Cursor = { fg = colors.cursorText, bg = colors.accent },
		CursorLineNr = { fg = colors.accent, bold = true },
		FloatBorder = { fg = colors.surface1 },
		Search = { fg = colors.onAccent, bg = colors.accent },
		IncSearch = { fg = colors.onAccent, bg = colors.accent },
		Visual = { fg = colors.selectionForeground, bg = colors.selectionBackground },
		DiffAdd = { bg = colors.successBg },
		DiffDelete = { bg = colors.errorBg },
		DiffChange = { bg = colors.accentBg },
		DiffText = { fg = colors.onAccent, bg = colors.accent },
	}
end

function M.lualine()
	local c = M.palette()
	local function section(color)
		return {
			a = { fg = c.base, bg = color, gui = "bold" },
			b = { fg = c.text, bg = c.surface0 },
			c = { fg = c.text, bg = c.mantle },
		}
	end
	return {
		normal = section(c.accent),
		insert = section(c.green),
		visual = section(c.mauve),
		replace = section(c.red),
		command = section(c.yellow),
		inactive = {
			a = { fg = c.subtext0, bg = c.mantle },
			b = { fg = c.subtext0, bg = c.mantle },
			c = { fg = c.subtext0, bg = c.mantle },
		},
	}
end

return M
