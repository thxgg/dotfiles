return {
	{
		"akinsho/toggleterm.nvim",
		lazy = false,
		opts = {
			open_mapping = [[<C-`>]],
			direction = "float",
			size = 80,
		},
		config = function(_, opts)
			local toggleterm = require("toggleterm")
			toggleterm.setup(opts)

			local Terminal = require("toggleterm.terminal").Terminal
			local lazygit = Terminal:new({ cmd = "lazygit", hidden = true, direction = "float" })

			function _lazygit_toggle()
				lazygit:toggle()
			end

			vim.api.nvim_set_keymap(
				"n",
				"<leader>lg",
				"<CMD>lua _lazygit_toggle()<CR>",
				{ desc = "Toggle [L]azy[G]it" }
			)
		end,
	},
}
