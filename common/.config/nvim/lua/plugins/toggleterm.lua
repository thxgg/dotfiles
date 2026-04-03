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

			vim.keymap.set("n", "<leader>lg", function()
				lazygit:toggle()
			end, { desc = "Toggle [L]azy[G]it" })
		end,
	},
}
