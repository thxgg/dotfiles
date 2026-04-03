return {
	{
		"dmtrKovalenko/fff.nvim",
		lazy = false,
		build = function()
			require("fff.download").download_or_build_binary()
		end,
		opts = {},
		keys = {
			{ "<leader>ff", function() require("fff").find_files() end,                                    desc = "[F]ind [F]iles" },
			{ "<leader>/",  function() require("fff").live_grep() end,                                     desc = "Search" },
			{ "<leader>fs", function() require("fff").live_grep({ query = vim.fn.expand("<cword>") }) end, desc = "[F]ind [S]election" },
		},
	},
}
