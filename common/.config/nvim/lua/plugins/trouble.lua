return {
	"folke/trouble.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	opts = {
		fold_open = "",
		fold_closed = "",
		signs = {
			error = "E",
			warning = "W",
			hint = "H",
			information = "I",
			other = "O",
		},
	},
	keys = {
		{ "<leader>xd", "<CMD>Telescope diagnostics<CR>", desc = "Diagnostics" },
		{ "<leader>gd", "<CMD>Telescope lsp_definitions<CR>", desc = "[G]o to [D]efinition" },
		{ "<leader>gtd", "<CMD>Telescope lsp_type_definitions<CR>", desc = "[G]o to [T]ype [D]efinition" },
		{ "<leader>gr", "<CMD>Telescope lsp_references<CR>", desc = "[G]o to [R]eferences" },
		{ "<leader>gi", "<CMD>Telescope lsp_implementations<CR>", desc = "[G]o to [I]mplementations" },
	},
}
