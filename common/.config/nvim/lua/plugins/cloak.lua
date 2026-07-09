return {
	{
		"laytan/cloak.nvim",
		lazy = false,
		opts = {
			enabled = false,
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
