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
				neotest = true,
				nvim_surround = true,
				which_key = true,
			},
		},
		init = function()
			local sign = vim.fn.sign_define

			sign("DapBreakpoint", { text = "●", texthl = "DapBreakpoint", linehl = "", numhl = "" })
			sign("DapBreakpointCondition", { text = "●", texthl = "DapBreakpointCondition", linehl = "", numhl = "" })
			sign("DapLogPoint", { text = "◆", texthl = "DapLogPoint", linehl = "", numhl = "" })

			vim.opt.background = "dark"
			vim.cmd.colorscheme("catppuccin-mocha")
		end,
	},
}
