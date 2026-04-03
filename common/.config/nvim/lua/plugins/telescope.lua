return {
	{
		"nvim-telescope/telescope.nvim",
		lazy = false,
		branch = "0.1.x",
		dependencies = {
			"nvim-lua/plenary.nvim",
			{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
		},
		opts = {
			defaults = {
				path_display = { "smart" },
				file_ignore_patterns = { "**/fonts" },
			},
			pickers = {
				colorscheme = {
					enable_preview = true,
				},
			},
		},
		keys = {
			-- Search (file finding and live grep handled by fff.nvim)
			{ "<leader>fb", "<CMD>Telescope current_buffer_fuzzy_find<CR>", desc = "[F]ind in [B]uffer" },
			{ "<leader>fg", "<CMD>Telescope git_status<CR>",                desc = "[F]ind [G]it Status" },
			{ "<leader>fd", "<CMD>Telescope diagnostics<CR>",               desc = "[F]ind [D]iagnostics" },
			-- Util
			{ "<leader>?",  "<CMD>Telescope help_tags<CR>",                 desc = "Help" },
			{ "<leader>,",  "<CMD>Telescope keymaps<CR>",                   desc = "Keymaps" },
			{ "<leader>.",  "<CMD>Telescope vim_options<CR>",               desc = "Options" },
			{ "<leader>cs", "<CMD>Telescope colorscheme<CR>",               desc = "[C]olor[s]cheme" },
		},
	},
	{
		"nvim-telescope/telescope-ui-select.nvim",
		config = function()
			local telescope = require("telescope")
			pcall(telescope.load_extension, "fzf")
			telescope.load_extension("ui-select")
		end,
	},
}
