return {
	"MeanderingProgrammer/markdown.nvim",
	main = "render-markdown",
	opts = {
		sign = {
			enabled = false,
		},
	},
	dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
	keys = {
		{ "<leader>md", "<CMD>RenderMarkdown toggle<CR>", desc = "Toggle [M]ark[d]own rendering" },
	},
}
