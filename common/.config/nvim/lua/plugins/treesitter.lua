local parser_languages = {
	-- Recommended
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

	"typespec",
}

local function install_missing_parsers()
	local ts = require("nvim-treesitter")
	local installed = {}
	for _, lang in ipairs(ts.get_installed()) do
		installed[lang] = true
	end
	local missing = vim.tbl_filter(function(lang)
		return not installed[lang]
	end, parser_languages)
	if #missing > 0 then
		ts.install(missing)
	end
end

return {
	{
		"nvim-treesitter/nvim-treesitter",
		branch = "main",
		lazy = false,
		dependencies = {
			{
				"windwp/nvim-ts-autotag",
				opts = {},
			},
		},
		build = function()
			local ts = require("nvim-treesitter")
			ts.install(parser_languages):wait(300000)
			ts.update(parser_languages):wait(300000)
		end,
		config = function()
			require("nvim-treesitter").setup({})
			install_missing_parsers()

			vim.api.nvim_create_autocmd("FileType", {
				group = vim.api.nvim_create_augroup("treesitter-setup", { clear = true }),
				callback = function(args)
					pcall(vim.treesitter.start, args.buf)

					if not vim.treesitter.get_parser(args.buf, nil, { error = false }) then
						return
					end

					local filetype = vim.bo[args.buf].filetype
					local language = vim.treesitter.language.get_lang(filetype)
					if not language then
						return
					end

					local has_indents, query = pcall(vim.treesitter.query.get, language, "indents")
					if has_indents and query then
						vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
					end
				end,
			})
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter-textobjects",
		branch = "main",
		dependencies = { "nvim-treesitter/nvim-treesitter" },
		config = function()
			require("nvim-treesitter-textobjects").setup({
				select = { lookahead = true },
				move = { set_jumps = true },
			})

			local function select_textobject(query, query_group)
				return function()
					require("nvim-treesitter-textobjects.select").select_textobject(
						query,
						query_group or "textobjects"
					)
				end
			end

			local function move(method, query, query_group)
				return function()
					require("nvim-treesitter-textobjects.move")[method](query, query_group or "textobjects")
				end
			end

			local map = vim.keymap.set

			-- Selection
			map({ "x", "o" }, "af", select_textobject("@function.outer"), { desc = "Select [A]round [F]unction" })
			map({ "x", "o" }, "if", select_textobject("@function.inner"), { desc = "Select [I]nside [F]unction" })
			map({ "x", "o" }, "ac", select_textobject("@class.outer"), { desc = "Select [A]round [C]lass" })
			map({ "x", "o" }, "ic", select_textobject("@class.inner"), { desc = "Select [I]nside [C]lass" })
			map({ "x", "o" }, "aa", select_textobject("@parameter.outer"), { desc = "Select [A]round [A]rgument" })
			map({ "x", "o" }, "ia", select_textobject("@parameter.inner"), { desc = "Select [I]nside [A]rgument" })
			map({ "x", "o" }, "ai", select_textobject("@conditional.outer"), { desc = "Select [A]round Conditional" })
			map({ "x", "o" }, "ii", select_textobject("@conditional.inner"), { desc = "Select [I]nside Conditional" })

			-- Movement: start/end
			map({ "n", "x", "o" }, "]m", move("goto_next_start", "@function.outer"), { desc = "Next function start" })
			map({ "n", "x", "o" }, "]]", move("goto_next_start", "@class.outer"), { desc = "Next class start" })
			map({ "n", "x", "o" }, "]M", move("goto_next_end", "@function.outer"), { desc = "Next function end" })
			map({ "n", "x", "o" }, "][", move("goto_next_end", "@class.outer"), { desc = "Next class end" })
			map({ "n", "x", "o" }, "[m", move("goto_previous_start", "@function.outer"), { desc = "Prev function start" })
			map({ "n", "x", "o" }, "[[", move("goto_previous_start", "@class.outer"), { desc = "Prev class start" })
			map({ "n", "x", "o" }, "[M", move("goto_previous_end", "@function.outer"), { desc = "Prev function end" })
			map({ "n", "x", "o" }, "[]", move("goto_previous_end", "@class.outer"), { desc = "Prev class end" })

			-- Movement: general (next/prev start)
			map({ "n", "x", "o" }, "]a", move("goto_next_start", "@parameter.outer"), { desc = "Next argument" })
			map({ "n", "x", "o" }, "[a", move("goto_previous_start", "@parameter.outer"), { desc = "Prev argument" })
			map({ "n", "x", "o" }, "]i", move("goto_next_start", "@conditional.outer"), { desc = "Next conditional" })
			map({ "n", "x", "o" }, "[i", move("goto_previous_start", "@conditional.outer"), { desc = "Prev conditional" })
			map({ "n", "x", "o" }, "]f", move("goto_next_start", "@function.outer"), { desc = "Next function" })
			map({ "n", "x", "o" }, "[f", move("goto_previous_start", "@function.outer"), { desc = "Prev function" })
			map({ "n", "x", "o" }, "]c", move("goto_next_start", "@class.outer"), { desc = "Next class" })
			map({ "n", "x", "o" }, "[c", move("goto_previous_start", "@class.outer"), { desc = "Prev class" })
		end,
	},
}
