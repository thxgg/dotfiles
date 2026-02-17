return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		dependencies = {
			{ "windwp/nvim-ts-autotag" },
		},
		config = function()
			local configs = require("nvim-treesitter.configs")

			configs.setup({
				ensure_installed = {
					-- Recommended languages
					"c",
					"lua",
					"vim",
					"vimdoc",
					"query",
					-- Git
					"diff",
					"git_config",
					"git_rebase",
					"gitattributes",
					"gitcommit",
					"gitignore",
					-- Config
					"dockerfile",
					"ssh_config",
					"toml",
					"yaml",
					"xml",
					-- Documentation
					"markdown",
					"markdown_inline",
					"latex",
					-- Frontend
					"css",
					"html",
					"javascript",
					"jsdoc",
					"json",
					"jsonc",
					"scss",
					"tsx",
					"typescript",
					"templ",
					"vue",
					-- Backend
					"bash",
					"go",
					"gomod",
					"gotmpl",
					"gosum",
					"gowork",
					"groovy",
					"java",
					"javadoc",
					"kotlin",
					"properties",
					"rust",
					"sql",
					"python",
					-- Other
					"csv",
					"tsv",
					"editorconfig",
					"hyprlang",
					"nginx",
					"rasi",
					"regex",
					"requirements",
					"robots",
					"typespec"
				},
				sync_install = false,
				highlight = {
					enable = true,
					additional_vim_regex_highlighting = false,
				},
				autotag = {
					enable = true,
				},
				textobjects = {
					select = {
						enable = true,
						lookahead = true,
						keymaps = {
							["af"] = { query = "@function.outer", desc = "Select [A]round [F]unction" },
							["if"] = { query = "@function.inner", desc = "Select [I]nside [F]unction" },
							["ac"] = { query = "@class.outer", desc = "Select [A]round [C]lass" },
							["ic"] = { query = "@class.inner", desc = "Select [I]nside [C]lass" },
							["aa"] = { query = "@parameter.outer", desc = "Select [A]round [A]rgument" },
							["ia"] = { query = "@parameter.inner", desc = "Select [I]nside [A]rgument" },
							["ai"] = { query = "@conditional.outer", desc = "Select [A]round Conditional" },
							["ii"] = { query = "@conditional.inner", desc = "Select [I]nside Conditional" },
						},
						selection_modes = {
							["@parameter.outer"] = "v", -- charwise
							["@function.outer"] = "V", -- linewise
							["@class.outer"] = "V", -- linewise
						},
					},
					move = {
						enable = true,
						set_jumps = true,
						goto_next_start = {
							["]m"] = "@function.outer",
							["]]"] = "@class.outer",
						},
						goto_next_end = {
							["]M"] = "@function.outer",
							["]["] = "@class.outer",
						},
						goto_previous_start = {
							["[m"] = "@function.outer",
							["[["] = "@class.outer",
						},
						goto_previous_end = {
							["[M"] = "@function.outer",
							["[]"] = "@class.outer",
						},
						goto_next = {
							["]a"] = "@parameter.outer",
							["]i"] = "@conditional.outer",
							["]f"] = "@function.outer",
							["]c"] = "@class.outer",
						},
						goto_previous = {
							["[a"] = "@parameter.outer",
							["[i"] = "@conditional.outer",
							["[f"] = "@function.outer",
							["[c"] = "@class.outer",
						},
					},
				},
			})
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter-textobjects",
		dependencies = { "nvim-treesitter/nvim-treesitter" },
	},
}
