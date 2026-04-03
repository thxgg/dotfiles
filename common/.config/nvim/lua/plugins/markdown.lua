return {
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
		---@module 'render-markdown'
		---@type render.md.UserConfig
		opts = {
			sign = {
				enabled = false,
			},
			completions = { blink = { enabled = true } },
		},
		keys = {
			{ "<leader>md", "<CMD>RenderMarkdown toggle<CR>", desc = "Toggle [M]ark[d]own rendering" },
		},
	},
}
