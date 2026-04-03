return {
	{
		"stevearc/conform.nvim",
		event = { "BufWritePre" },
		cmd = { "ConformInfo" },
		keys = {
			{
				"<F3>",
				function()
					require("conform").format({ async = true, lsp_format = "fallback" })
				end,
				desc = "Format buffer",
			},
		},
		opts = {
			notify_on_error = false,
			format_on_save = function(bufnr)
				if vim.bo[bufnr].filetype == "java" then
					return nil
				end
				return {
					timeout_ms = 500,
					lsp_format = "fallback",
				}
			end,
			formatters_by_ft = {
				javascript = { "oxfmt", "prettierd", stop_after_first = true },
				typescript = { "oxfmt", "prettierd", stop_after_first = true },
				javascriptreact = { "oxfmt", "prettierd", stop_after_first = true },
				typescriptreact = { "oxfmt", "prettierd", stop_after_first = true },
				vue = { "oxfmt", "prettierd", stop_after_first = true },
				css = { "oxfmt", "prettierd", stop_after_first = true },
				scss = { "prettierd" },
				json = { "prettierd" },
				jsonc = { "prettierd" },
				yaml = { "prettierd" },
				markdown = { "prettierd" },
			},
			formatters = {
				oxfmt = {
					condition = function(_, ctx)
						return vim.fs.find(
							{ "vite.config.ts", "vite.config.js", ".oxfmtrc.json", ".oxfmtrc.jsonc" },
							{ path = ctx.filename, upward = true, stop = vim.uv.os_homedir() }
						)[1] ~= nil
					end,
				},
				prettierd = {
					condition = function(_, ctx)
						return vim.fs.find({
							".prettierrc",
							".prettierrc.json",
							".prettierrc.js",
							".prettierrc.cjs",
							".prettierrc.mjs",
							"prettier.config.js",
							"prettier.config.cjs",
							"prettier.config.mjs",
						}, { path = ctx.filename, upward = true, stop = vim.uv.os_homedir() })[1] ~= nil
					end,
				},
			},
		},
	},
}
