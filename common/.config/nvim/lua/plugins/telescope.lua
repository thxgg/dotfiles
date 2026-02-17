return {
	{
		"nvim-telescope/telescope.nvim",
		lazy = false,
		branch = "0.1.x",
		dependencies = { "nvim-lua/plenary.nvim" },
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
			-- Search
			{ "<leader>ff", "<CMD>Telescope find_files<CR>",                desc = "[F]ind [F]iles" },
			{ "<leader>fb", "<CMD>Telescope current_buffer_fuzzy_find<CR>", desc = "[F]ind in [B]uffer" },
			{ "<leader>/",  "<CMD>Telescope live_grep<CR>",                 desc = "Search" },
			{ "<leader>fs", "<CMD>Telescope grep_string<CR>",               desc = "[F]ind [S]election" },
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
			require("telescope").load_extension("ui-select")
		end,
	},
}
