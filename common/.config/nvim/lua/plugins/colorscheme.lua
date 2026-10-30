local theme = require("user.theme")

return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		lazy = false,
		opts = {
			color_overrides = theme.color_overrides(),
			custom_highlights = theme.highlights,
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
		config = function(_, opts)
			require("catppuccin").setup(opts)
			vim.cmd.colorscheme("merino")
		end,
	},
}
