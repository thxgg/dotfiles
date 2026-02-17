local map = function(mode, lhs, rhs, opts)
	opts = opts or {}
	opts.noremap = true
	opts.silent = true
	vim.keymap.set(mode, lhs, rhs, opts)
end

vim.api.nvim_create_autocmd("LspAttach", {
	desc = "LSP actions",
	callback = function(args)
		local client = vim.lsp.get_client_by_id(args.data.client_id)
		if not client then return end

		local bufnr = args.buf

		-- On save actions
		if client.supports_method('textDocument/formatting') and vim.bo.filetype ~= "java" then
			vim.api.nvim_create_autocmd("BufWritePre", {
				buffer = args.buf,
				callback = function()
					local clients = vim.lsp.get_clients({ bufnr = 0 })

					-- ESLint
					local has_eslint = false

					for _, c in ipairs(clients) do
						if c.name == "eslint" then
							has_eslint = true
							break
						end
					end

					if has_eslint then
						vim.cmd("LspEslintFixAll")
						return
					end

					-- Format
					vim.lsp.buf.format({ bufnr = args.buf, id = client.id })
				end,
			})
		end

		vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost" }, {
			group = vim.api.nvim_create_augroup("JdtlsCodelens", { clear = true }),
			buffer = bufnr,
			callback = function()
				vim.lsp.codelens.refresh()
			end,
		})
		-- Initial codelens refresh
		vim.lsp.codelens.refresh()

		map("n", "K", vim.lsp.buf.hover, { buffer = bufnr, desc = "Show tooltip" })
		map("i", "<C-k>", vim.lsp.buf.signature_help, { buffer = bufnr, desc = "Show signature help" })
		map("n", "<F2>", vim.lsp.buf.rename, { buffer = bufnr, desc = "Rename" })
		map("n", "<F3>", vim.lsp.buf.format, { buffer = bufnr, desc = "Format buffer" })
		map("v", "<F3>", function()
			vim.lsp.buf.format({
				range = {
					start = vim.api.nvim_buf_get_mark(0, "<"),
					["end"] = vim.api.nvim_buf_get_mark(0, ">"),
				},
				async = false
			})
		end, { desc = "Format selection" })
		map("n", "<F4>", vim.lsp.buf.code_action, { buffer = bufnr, desc = "Code Action" })
		map("n", "<leader>gd", vim.lsp.buf.definition, { buffer = bufnr, desc = "[G]o to [D]efinition" })
		map("n", "<leader>gtd", vim.lsp.buf.type_definition, { buffer = bufnr, desc = "[G]o to [T]ype [D]efinition" })
		map("n", "<leader>gr", vim.lsp.buf.references, { buffer = bufnr, desc = "[G]o to [R]eferences" })
		map("n", "<leader>gi", vim.lsp.buf.implementation, { buffer = bufnr, desc = "[G]o to [I]mplementation" })
		map("n", "<leader>go", function()
			pcall(vim.lsp.buf.code_action, {
				context = { only = { "source.organizeImports" } },
				apply = true,
			})
		end, { buffer = bufnr, desc = "[O]rganize Imports" })
	end
})

-- Lua
vim.lsp.config('lua_ls', {
	cmd = { 'lua-language-server' },
	filetypes = { 'lua' },
	root_markers = { { '.luarc.json', '.luarc.jsonc' }, '.git' },
	settings = {
		Lua = {
			runtime = {
				version = 'LuaJIT',
			}
		}
	}
})
vim.lsp.enable('lua_ls')

-- Vue
vim.lsp.config('ts_ls', {
	init_options = {
		plugins = {
			{
				name = "@vue/typescript-plugin",
				location =
				"$HOME/.local/share/nvim/mason/packages/vue-language-server/node_modules/@vue/language-server",
				languages = { "vue" },
			},
		},
	},
	filetypes = {
		"javascript",
		"typescript",
		"javascriptreact",
		"typescriptreact",
		"vue",
	},
})
vim.lsp.config('vue_ls', {})
vim.lsp.enable({ 'ts_ls', 'vue_ls' })

-- ESLint
vim.lsp.config('eslint', {
	settings = {
		codeActionOnSave = {
			enable = false,
		},
		experimental = {
			useFlatConfig = true
		},
		run = "onType",
	}
})
vim.lsp.enable('eslint')

vim.api.nvim_create_user_command('TimeWrite', function()
	local t0 = vim.uv.hrtime()
	vim.cmd('write')
	local dt_ms = (vim.uv.hrtime() - t0) / 1e6
	vim.notify(string.format('Write took %.2f ms', dt_ms), vim.log.levels.INFO)
end, {})

-- Java
vim.lsp.config('jdtls', {
	cmd = {
		"jdtls",
		"-configuration",
		"$HOME/.cache/jdtls/config",
		"-data",
		"$HOME/.cache/jdtls/workspace",
		'--jvm-arg=-javaagent:$HOME/.local/share/nvim/mason/share/jdtls/lombok.jar'
	},
	settings = {
		java = {
			eclipse = {
				downloadSources = true,
			},
			configuration = {
				updateBuildConfiguration = "interactive",
				runtimes = {
					{
						name = "JavaSE-21",
						path = vim.fn.expand(
							"$HOME/Library/Java/JavaVirtualMachines/corretto-21.0.6/Contents/Home"
						),
					},
				},
			},
			maven = {
				downloadSources = true,
			},
			implementationsCodeLens = {
				enabled = true,
			},
			referencesCodeLens = {
				enabled = true,
			},
			references = {
				includeAccessors = true,
			},
			inlayHints = {
				paramerNames = {
					enabled = "all",
				},
			},
			signatureHelp = {
				enabled = true,
			},
			completion = {
				enabled = true,
				favoriteStaticMembers = {
					"org.springframework.http.HttpStatus.*",
					"org.mockito.Mockito.*",
					"org.mockito.ArgumentMatchers.*",
					"org.mockito.AdditionalMatchers.*",
					"org.junit.jupiter.api.Assertions.*",
					"org.assertj.core.api.Assertions.*",
					"org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*",
				},
				importOrder = {
					"java",
					"javax",
					"com",
					"org",
				},
			},
			jdt = {
				ls = {
					lombokSupport = {
						enabled = true,
					},
				},
			},
			contentProvider = {
				preferred = "fernflower",
			},
			sources = {
				organizeImports = {
					starThreshold = 9999,
					staticStarThreshold = 9999,
				},
			},
			codeGeneration = {
				toString = {
					template = "${object.className}{${member.name()}=${member.value}, ${otherMembers}}",
				},
				useBlocks = true,
			},
		},
	},
})
vim.lsp.enable('jdtls')

return {
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",
		},
	},
	{
		"williamboman/mason.nvim",
		opts = {},
	},
	{
		"mfussenegger/nvim-jdtls"
	}
}
