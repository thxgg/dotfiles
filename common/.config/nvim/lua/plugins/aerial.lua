return {
	"stevearc/aerial.nvim",
	opts = {
		backends = {
			sql = { "lsp" },
			["_"] = { "treesitter", "lsp", "markdown", "asciidoc", "man" },
		},
	},
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
		"nvim-tree/nvim-web-devicons",
	},
	keys = {
		{ "<leader>a", "<CMD>AerialToggle!<CR>", desc = "Toggle [A]erial" },
	},
}
