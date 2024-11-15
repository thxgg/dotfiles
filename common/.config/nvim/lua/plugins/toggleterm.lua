return {
	{
		"akinsho/toggleterm.nvim",
		lazy = false,
		opts = {
			open_mapping = [[<C-\>]],
			direction = "float",
		},
		config = function(_, opts)
			local toggleterm = require("toggleterm")
			toggleterm.setup(opts)

			local Terminal = require("toggleterm.terminal").Terminal
			local lazygit = Terminal:new({ cmd = "lazygit", hidden = true, direction = "float" })
			local lazydocker = Terminal:new({ cmd = "lazydocker", hidden = true, direction = "float" })

			function _lazygit_toggle()
				lazygit:toggle()
			end

            function _lazydocker_toggle()
              lazydocker:toggle()
            end

			vim.api.nvim_set_keymap(
				"n",
				"<leader>lg",
				"<CMD>lua _lazygit_toggle()<CR>",
				{ desc = "Toggle [L]azy[G]it" }
			)
			vim.api.nvim_set_keymap(
				"n",
				"<leader>ld",
				"<CMD>lua _lazydocker_toggle()<CR>",
				{ desc = "Toggle [L]azy[G]it" }
			)
		end,
	},
}
