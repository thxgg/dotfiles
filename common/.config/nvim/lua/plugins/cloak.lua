return {
	{
		"laytan/cloak.nvim",
		lazy = false,
		opts = {
			patterns = {
				{
					file_pattern = "**/*.env*",
					cloak_pattern = "=.+",
				},
				{
					file_pattern = "**/*.vars*",
					cloak_pattern = "=.+",
				},
			},
		},
	},
}
