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

M.semantic_palettes = {
	dark = {
		red = "#e06c75",
		orange = "#EC5B2B",
		green = "#7fd88f",
		blue = "#6ba1e6",
		cyan = "#56b6c2",
		yellow = "#e5c07b",
		magenta = "#c678dd",
		pink = "#EE7948",

		bright_red = "#f38ba8",
		bright_orange = "#fab387",
		bright_green = "#a3d6a5",
		bright_blue = "#89b4fa",
		bright_cyan = "#89dceb",
		bright_yellow = "#f9e2af",
		bright_magenta = "#f5c2e7",
		bright_white = "#eeeeee",

		bg = "#0a0a0a",
		fg = "#e6e8ee",
		cursorline = "#1a1a1a",
		selection = "#2a2a2a",
		linenr = "#4a4a4a",
		comment = "#6a6a6a",
		gutter_fg = "#4a4a4a",
		nontext = "#3a3a3a",
		menu_bg = "#1a1a1a",
		statusline = "#0a0a0a",
		split = "#1a1a1a",
	},
	light = {
		red = "#d1383d",
		orange = "#EC5B2B",
		green = "#3d9a57",
		blue = "#0062d1",
		cyan = "#318795",
		yellow = "#b0851f",
		magenta = "#a626a4",
		pink = "#c94d24",

		bright_red = "#d1383d",
		bright_orange = "#f28544",
		bright_green = "#50b56e",
		bright_blue = "#0078f0",
		bright_cyan = "#3d9fb1",
		bright_yellow = "#c99925",
		bright_magenta = "#bf35c1",
		bright_white = "#1a1a1a",

		bg = "#ffffff",
		fg = "#1a1a1a",
		cursorline = "#f5f5f5",
		selection = "#e0e0e0",
		linenr = "#999999",
		comment = "#6a737d",
		gutter_fg = "#999999",
		nontext = "#d0d0d0",
		menu_bg = "#f5f5f5",
		statusline = "#f0f0f0",
		split = "#e5e5e5",
	},
}

local function catppuccin_palette(colors)
	return {
		rosewater = colors.bright_orange,
		flamingo = colors.pink,
		pink = colors.pink,
		mauve = colors.magenta,
		red = colors.red,
		maroon = colors.bright_red,
		peach = colors.orange,
		yellow = colors.yellow,
		green = colors.green,
		teal = colors.cyan,
		sky = colors.bright_cyan,
		sapphire = colors.cyan,
		blue = colors.blue,
		lavender = colors.bright_blue,
		text = colors.fg,
		subtext1 = colors.bright_white,
		subtext0 = colors.comment,
		overlay2 = colors.comment,
		overlay1 = colors.gutter_fg,
		overlay0 = colors.nontext,
		surface2 = colors.selection,
		surface1 = colors.cursorline,
		surface0 = colors.menu_bg,
		base = colors.bg,
		mantle = colors.statusline,
		crust = colors.split,
	}
end

M.palettes = {
	dark = catppuccin_palette(M.semantic_palettes.dark),
	light = catppuccin_palette(M.semantic_palettes.light),
}

function M.catppuccin_color_overrides()
	return {
		mocha = M.palettes.dark,
		latte = M.palettes.light,
	}
end

function M.catppuccin_custom_highlights()
	local colors = M.semantic_palettes[read_mode()]
	local search_fg = read_mode() == "light" and colors.bg or "#0a0a0a"

	return {
		Comment = { fg = colors.comment, italic = true },
		Constant = { fg = colors.orange },
		String = { fg = colors.blue },
		Character = { fg = colors.orange },
		Number = { fg = colors.orange },
		Boolean = { fg = colors.orange },
		Float = { fg = colors.orange },
		Identifier = { fg = colors.fg },
		Function = { fg = colors.yellow },
		Statement = { fg = colors.magenta },
		Conditional = { fg = colors.blue },
		Repeat = { fg = colors.blue },
		Label = { fg = colors.cyan },
		Operator = { fg = colors.magenta },
		Keyword = { fg = colors.magenta },
		Exception = { fg = colors.magenta },
		PreProc = { fg = colors.yellow },
		Include = { fg = colors.magenta },
		Define = { fg = colors.magenta },
		Macro = { fg = colors.magenta },
		PreCondit = { fg = colors.cyan },
		Type = { fg = colors.cyan },
		StorageClass = { fg = colors.blue },
		Structure = { fg = colors.yellow },
		Typedef = { fg = colors.yellow },
		Special = { fg = colors.orange, italic = true },
		SpecialComment = { fg = colors.comment, italic = true },
		Underlined = { fg = colors.cyan, underline = true },

		Cursor = { fg = colors.bg, bg = colors.orange },
		CursorLineNr = { fg = colors.orange, bold = true },
		Search = { fg = search_fg, bg = colors.orange },
		IncSearch = { fg = colors.orange, bg = colors.selection },
		LineNr = { fg = colors.comment },
		Visual = { bg = colors.selection },
		FloatBorder = { fg = colors.fg },

		["@constant"] = { fg = colors.orange },
		["@constant.builtin"] = { fg = colors.orange },
		["@constant.macro"] = { fg = colors.orange },
		["@string"] = { fg = colors.blue },
		["@string.regex"] = { fg = colors.red },
		["@string.escape"] = { fg = colors.cyan },
		["@character"] = { fg = colors.orange },
		["@number"] = { fg = colors.orange },
		["@boolean"] = { fg = colors.orange },
		["@float"] = { fg = colors.orange },
		["@annotation"] = { fg = colors.yellow },
		["@attribute"] = { fg = colors.cyan },
		["@namespace"] = { fg = colors.orange },

		["@function"] = { fg = colors.yellow, bold = true },
		["@function.call"] = { fg = colors.yellow, bold = true },
		["@function.builtin"] = { fg = colors.yellow, bold = true },
		["@function.macro"] = { fg = colors.yellow },
		["@method"] = { fg = colors.yellow },
		["@method.call"] = { fg = colors.yellow },
		["@function.method"] = { fg = colors.yellow },
		["@function.method.call"] = { fg = colors.yellow },
		["@parameter"] = { fg = colors.orange },
		["@variable.parameter"] = { fg = colors.orange },
		["@field"] = { fg = colors.orange },
		["@property"] = { fg = colors.cyan },
		["@constructor"] = { fg = colors.cyan },

		["@keyword"] = { fg = colors.magenta, bold = true },
		["@keyword.function"] = { fg = colors.yellow },
		["@keyword.operator"] = { fg = colors.blue },
		["@operator"] = { fg = colors.blue },
		["@conditional"] = { fg = colors.blue },
		["@repeat"] = { fg = colors.blue },
		["@label"] = { fg = colors.cyan },
		["@exception"] = { fg = colors.magenta },
		["@type"] = { fg = colors.bright_cyan },
		["@type.builtin"] = { fg = colors.cyan, italic = true },
		["@type.qualifier"] = { fg = colors.blue },
		["@structure"] = { fg = colors.magenta },
		["@include"] = { fg = colors.blue },
		["@variable"] = { fg = colors.fg },
		["@variable.builtin"] = { fg = colors.fg },

		["@markup.heading"] = { fg = colors.blue, bold = true },
		["@markup.raw"] = { fg = colors.blue },
		["@markup.link"] = { fg = colors.yellow, italic = true },
		["@markup.link.url"] = { fg = colors.yellow, italic = true },
		["@tag"] = { fg = colors.cyan },
		["@tag.attribute"] = { fg = colors.orange },
		["@tag.delimiter"] = { fg = colors.blue },

		["@lsp.type.class"] = { fg = colors.cyan },
		["@lsp.type.enum"] = { fg = colors.cyan },
		["@lsp.type.decorator"] = { fg = colors.orange },
		["@lsp.type.enumMember"] = { fg = colors.magenta },
		["@lsp.type.function"] = { fg = colors.yellow },
		["@lsp.type.interface"] = { fg = colors.bright_yellow },
		["@lsp.type.macro"] = { fg = colors.cyan },
		["@lsp.type.method"] = { fg = colors.yellow },
		["@lsp.type.namespace"] = { fg = colors.orange },
		["@lsp.type.parameter"] = { fg = colors.orange },
		["@lsp.type.property"] = { fg = colors.bright_magenta },
		["@lsp.type.struct"] = { fg = colors.cyan },
		["@lsp.type.type"] = { fg = colors.yellow },
		["@lsp.type.variable"] = { fg = colors.fg },

		DiagnosticError = { fg = colors.red },
		DiagnosticWarn = { fg = colors.yellow },
		DiagnosticInfo = { fg = colors.cyan },
		DiagnosticHint = { fg = colors.cyan },
		DiagnosticUnderlineError = { undercurl = true, sp = colors.red },
		DiagnosticUnderlineWarn = { undercurl = true, sp = colors.yellow },
		DiagnosticUnderlineInfo = { undercurl = true, sp = colors.cyan },
		DiagnosticUnderlineHint = { undercurl = true, sp = colors.cyan },
		GitSignsAdd = { fg = colors.blue },
		GitSignsChange = { fg = colors.orange },
		GitSignsDelete = { fg = colors.red },
	}
end

return M
