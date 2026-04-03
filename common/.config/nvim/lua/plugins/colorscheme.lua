return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		opts = {
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
			vim.opt.background = "dark"
			vim.cmd.colorscheme("catppuccin-mocha")
		end,
	},
}
