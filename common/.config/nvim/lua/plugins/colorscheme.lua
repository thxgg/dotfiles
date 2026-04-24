local theme = require("user.theme")

return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		opts = {
			color_overrides = theme.catppuccin_color_overrides(),
			integrations = {
				aerial = true,
				blink_cmp = {
					style = 'bordered',
				},
				dadbod_ui = true,
				mason = true,
				nvim_surround = true,
				which_key = true,
			},
		},
		init = function()
			vim.opt.background = theme.background()
			vim.cmd.colorscheme("catppuccin-" .. theme.catppuccin_flavour())
		end,
	},
}
