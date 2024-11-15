return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		opts = {
			integrations = {
				aerial = true,
				mason = true,
				neotest = true,
				lsp_trouble = true,
				which_key = true,
			},
		},
        init = function()
			local sign = vim.fn.sign_define

			sign("DapBreakpoint", { text = "●", texthl = "DapBreakpoint", linehl = "", numhl = "" })
			sign("DapBreakpointCondition", { text = "●", texthl = "DapBreakpointCondition", linehl = "", numhl = "" })
			sign("DapLogPoint", { text = "◆", texthl = "DapLogPoint", linehl = "", numhl = "" })

			vim.opt.background = "dark"
			vim.cmd.colorscheme("catppuccin")
		end,
	},
}
