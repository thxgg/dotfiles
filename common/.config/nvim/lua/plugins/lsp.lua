local map = function(mode, lhs, rhs, opts)
	opts = opts or {}
	opts.noremap = true
	opts.silent = true
	vim.keymap.set(mode, lhs, rhs, opts)
end

local augroup = vim.api.nvim_create_augroup("LspFormatting", { clear = false })
local on_attach = function(client, bufnr)
	if
		client.supports_method("textDocument/formatting")
		or vim.bo.filetype == "markdown"
		or vim.bo.filetype == "python"
	then
		vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
		vim.api.nvim_create_autocmd("BufWritePre", {
			group = augroup,
			buffer = bufnr,
			callback = function()
				local eslint_client = next(vim.lsp.get_clients({ bufnr = bufnr, name = "eslint" })) ~= nil
				if eslint_client then
					vim.cmd("EslintFixAll")
				else
					vim.lsp.buf.format({
						filter = function(c)
							return c.name == "null-ls"
						end,
						bufnr = bufnr,
						async = false,
					})
				end
			end,
		})
	end

	map("n", "K", vim.lsp.buf.hover, { buffer = bufnr, desc = "Show tooltip" })
	map("i", "<C-k>", vim.lsp.buf.signature_help, { buffer = bufnr, desc = "Show signature help" })
	map("n", "<F2>", vim.lsp.buf.rename, { buffer = bufnr, desc = "Rename" })
	map("n", "<F3>", function()
		local eslint_client = next(vim.lsp.get_clients({ bufnr = bufnr, name = "eslint" })) ~= nil
		if eslint_client then
			vim.cmd("EslintFixAll")
		else
			vim.lsp.buf.format({
				filter = function(c)
					return c.name == "null-ls"
				end,
				bufnr = bufnr,
			})
		end
	end, { buffer = bufnr, desc = "Format buffer" })
	map("n", "<F4>", vim.lsp.buf.code_action, { buffer = bufnr, desc = "Code Action" })
end

-- Copied from LazyVim
-- Utility function to extend or override a config table, similar to the way
-- that Plugin.opts works.
---@param config table
---@param custom function | table | nil
local function extend_or_override(config, custom, ...)
	if type(custom) == "function" then
		config = custom(config, ...) or config
	elseif custom then
		config = vim.tbl_deep_extend("force", config, custom) --[[@as table]]
	end
	return config
end

return {
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",
			"hrsh7th/nvim-cmp",
		},
	},
	{
		"williamboman/mason-lspconfig.nvim",
		dependencies = { "williamboman/mason.nvim" },
		opts = {
			ensure_installed = {
				"bashls",
				"clangd",
				"cssls",
				"dockerls",
				"docker_compose_language_service",
				"emmet_language_server",
				"eslint",
				"gopls",
				"html",
				"jdtls",
				"lemminx",
				"lua_ls",
				"pyright",
				"spectral",
				"sqlls",
				"tailwindcss",
				"templ",
				"ts_ls",
				"volar",
			},
			handlers = {
				function(server_name)
					require("lspconfig")[server_name].setup({
						on_attach = on_attach,
						capabilities = require("cmp_nvim_lsp").default_capabilities(),
					})
				end,
				cssls = function()
					require("lspconfig").cssls.setup({
						on_attach = on_attach,
						capabilities = require("cmp_nvim_lsp").default_capabilities(),
						settings = {
							css = {
								validate = true,
								lint = {
									unknownAtRules = "ignore",
								},
							},
							scss = {
								validate = true,
								lint = {
									unknownAtRules = "ignore",
								},
							},
							less = {
								validate = true,
								lint = {
									unknownAtRules = "ignore",
								},
							},
						},
					})
				end,
				jdtls = function() end,
				["lua_ls"] = function()
					require("lspconfig").lua_ls.setup({
						on_attach = on_attach,
						capabilities = require("cmp_nvim_lsp").default_capabilities(),
						settings = {
							Lua = {
								diagnostics = {
									globals = { "vim" },
								},
							},
						},
					})
				end,
				ts_ls = function()
					local mason_registry = require("mason-registry")
					local vue_language_server_path = mason_registry
						.get_package("vue-language-server")
						:get_install_path() .. "/node_modules/@vue/language-server"

					require("lspconfig").ts_ls.setup({
						on_attach = on_attach,
						capabilities = require("cmp_nvim_lsp").default_capabilities(),
						init_options = {
							plugins = {
								{
									name = "@vue/typescript-plugin",
									location = vue_language_server_path,
									languages = { "vue" },
								},
							},
						},
						filetypes = {
							"javascript",
							"typescript",
							"vue",
						},
					})
				end,
			},
		},
	},
	{
		"williamboman/mason.nvim",
		opts = {},
	},
	-- Copied from LazyVim
	{
		"mfussenegger/nvim-jdtls",
		dependencies = { "folke/which-key.nvim" },
		ft = "java",
		opts = function()
			return {
				-- How to find the root dir for a given filename. The default comes from
				-- lspconfig which provides a function specifically for java projects.
				root_dir = require("lspconfig.configs.jdtls").default_config.root_dir,

				-- How to find the project name for a given root dir.
				project_name = function(root_dir)
					return root_dir and vim.fs.basename(root_dir)
				end,

				-- Where are the config and workspace dirs for a project?
				jdtls_config_dir = function(project_name)
					return vim.fn.stdpath("cache") .. "/jdtls/" .. project_name .. "/config"
				end,
				jdtls_workspace_dir = function(project_name)
					return vim.fn.stdpath("cache") .. "/jdtls/" .. project_name .. "/workspace"
				end,

				-- How to run jdtls. This can be overridden to a full java command-line
				-- if the Python wrapper script doesn't suffice.
				cmd = { vim.fn.exepath("jdtls") },
				full_cmd = function(opts)
					local fname = vim.api.nvim_buf_get_name(0)
					local root_dir = opts.root_dir(fname)
					local project_name = opts.project_name(root_dir)
					local cmd = vim.deepcopy(opts.cmd)
					if project_name then
						vim.list_extend(cmd, {
							"-configuration",
							opts.jdtls_config_dir(project_name),
							"-data",
							opts.jdtls_workspace_dir(project_name),
						})
					end
					return cmd
				end,

				-- These depend on nvim-dap, but can additionally be disabled by setting false here.
				dap = { hotcodereplace = "auto", config_overrides = {} },
				dap_main = {},
				test = true,
				on_attach = function(_, bufnr)
					-- Codelens
					vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost" }, {
						group = vim.api.nvim_create_augroup("JdtlsCodelens", { clear = true }),
						buffer = bufnr,
						callback = function()
							vim.lsp.codelens.refresh()
						end,
					})
					-- Initial codelens refresh
					vim.lsp.codelens.refresh()

					-- Mappings
					map("n", "K", vim.lsp.buf.hover, { buffer = bufnr, desc = "Show tooltip" })
					map("i", "<C-k>", vim.lsp.buf.signature_help, { buffer = bufnr, desc = "Show signature help" })
					map("n", "<F2>", vim.lsp.buf.rename, { buffer = bufnr, desc = "Rename" })
					map("n", "<F3>", vim.lsp.buf.format, { buffer = bufnr, desc = "Format buffer" })
					map("n", "<F4>", vim.lsp.buf.code_action, { buffer = bufnr, desc = "Code Action" })
				end,
				setting = {
					java = {
						eclipse = {
							downloadSources = true,
						},
						configuration = {
							updateBuildConfiguration = "interactive",
							runtimes = {
								{
									name = "JavaSE-17",
									path = vim.fn.expand(
										"/Users/thxgg/Library/Java/JavaVirtualMachines/corretto-17.0.13/Contents/Home"
									),
								},
								{
									name = "JavaSE-21",
									path = vim.fn.expand(
										"/Users/thxgg/Library/Java/JavaVirtualMachines/corretto-21.0.5/Contents/Home"
									),
								},
								-- Java 23 is not supported by JDTLS yet
								-- {
								--   name = "JavaSE-23",
								--   path = vim.fn.expand("/Users/thxgg/Library/Java/JavaVirtualMachines/corretto-23.0.1/Contents/Home"),
								-- }
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
						extendedClientCapabilities = require("jdtls").extendedClientCapabilities,
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
				jdtls = function(opts)
					local install_path = require("mason-registry").get_package("jdtls"):get_install_path()
					local jvmArg = "-javaagent:" .. install_path .. "/lombok.jar"
					table.insert(opts.cmd, "--jvm-arg=" .. jvmArg)
					return opts
				end,
			}
		end,
		config = function(_, opts)
			-- Find the extra bundles that should be passed on the jdtls command-line
			-- if nvim-dap is enabled with java debug/test.
			local mason_registry = require("mason-registry")
			local bundles = {} ---@type string[]
			if opts.dap and mason_registry.is_installed("java-debug-adapter") then
				local java_dbg_pkg = mason_registry.get_package("java-debug-adapter")
				local java_dbg_path = java_dbg_pkg:get_install_path()
				local jar_patterns = {
					java_dbg_path .. "/extension/server/com.microsoft.java.debug.plugin-*.jar",
				}
				-- java-test also depends on java-debug-adapter.
				if opts.test and mason_registry.is_installed("java-test") then
					local java_test_pkg = mason_registry.get_package("java-test")
					local java_test_path = java_test_pkg:get_install_path()
					vim.list_extend(jar_patterns, {
						java_test_path .. "/extension/server/*.jar",
					})
				end
				for _, jar_pattern in ipairs(jar_patterns) do
					for _, bundle in ipairs(vim.split(vim.fn.glob(jar_pattern), "\n")) do
						table.insert(bundles, bundle)
					end
				end
			end

			local function attach_jdtls()
				local fname = vim.api.nvim_buf_get_name(0)

				-- Configuration can be augmented and overridden by opts.jdtls
				local config = extend_or_override({
					cmd = opts.full_cmd(opts),
					root_dir = opts.root_dir(fname),
					init_options = {
						bundles = bundles,
					},
					-- enable CMP capabilities
					capabilities = require("cmp_nvim_lsp").default_capabilities() or nil,
				}, opts.jdtls)

				-- Existing server will be reused if the root_dir matches.
				require("jdtls").start_or_attach(config)
				-- not need to require("jdtls.setup").add_commands(), start automatically adds commands
			end

			-- Attach the jdtls for each java buffer. HOWEVER, this plugin loads
			-- depending on filetype, so this autocmd doesn't run for the first file.
			-- For that, we call directly below.
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "java",
				callback = attach_jdtls,
			})

			-- Setup keymap and dap after the lsp is fully attached.
			-- https://github.com/mfussenegger/nvim-jdtls#nvim-dap-configuration
			-- https://neovim.io/doc/user/lsp.html#LspAttach
			vim.api.nvim_create_autocmd("LspAttach", {
				callback = function(args)
					local client = vim.lsp.get_client_by_id(args.data.client_id)
					if client and client.name == "jdtls" then
						local wk = require("which-key")
						wk.add({
							{ "<leader>rx", mode = "n", buffer = args.buf, group = "+extract" },
							{
								"<leader>rxv",
								function()
									require("jdtls").extract_variable_all()
								end,
								mode = "n",
								buffer = args.buf,
								desc = "E[x]tract [V]ariable",
							},
							{
								"<leader>rxc",
								function()
									require("jdtls").extract_constant()
								end,
								mode = "n",
								buffer = args.buf,
								desc = "E[x]tract [C]onstant",
							},
							{
								"<leader>roi",
								function()
									require("jdtls").organize_imports()
								end,
								mode = "n",
								buffer = args.buf,
								desc = "[O]rganize [I]mports",
							},
						})
						wk.add({
							{ "<leader>rx", mode = "v", buffer = args.buf, group = "+extract" },
							{
								"<leader>rxm",
								function()
									require("jdtls").extract_method(true)
								end,
								mode = "v",
								buffer = args.buf,
								desc = "E{x]tract [M]ethod",
							},
							{
								"<leader>rxv",
								function()
									require("jdtls").extract_variable_all(true)
								end,
								mode = "v",
								buffer = args.buf,
								desc = "E{x]tract [V]ariable",
							},
							{
								"<leader>rxc",
								function()
									require("jdtls").extract_constant(true)
								end,
								mode = "v",
								buffer = args.buf,
								desc = "E{x]tract [C]onstant",
							},
						})

						if opts.dap and mason_registry.is_installed("java-debug-adapter") then
							-- custom init for Java debugger
							require("jdtls").setup_dap(opts.dap)
							require("jdtls.dap").setup_dap_main_class_configs(opts.dap_main)

							-- Java Test require Java debugger to work
							if opts.test and mason_registry.is_installed("java-test") then
								-- custom keymaps for Java test runner (not yet compatible with neotest)
								wk.register({
									{ "<leader>t", mode = "n", buffer = args.buf, group = "+test" },
									{
										"<leader>tT",
										function()
											require("jdtls.dap").test_class()
										end,
										mode = "n",
										buffer = args.buf,
										desc = "Run All [T]est",
									},
									{
										"<leader>tn",
										function()
											require("jdtls.dap").test_nearest_method()
										end,
										mode = "n",
										buffer = args.buf,
										desc = "Run [N]earest [T]est",
									},
									{
										"<leader>tt",
										function()
											require("jdtls.dap").pick_test()
										end,
										mode = "n",
										buffer = args.buf,
										desc = "Run [T]est",
									},
								})
							end
						end

						-- User can set additional keymaps in opts.on_attach
						if opts.on_attach then
							opts.on_attach(args)
						end
					end
				end,
			})

			-- Avoid race condition by calling attach the first time, since the autocmd won't fire.
			attach_jdtls()
		end,
	},
	{
		"nvimtools/none-ls.nvim",
		dependencies = {
			"nvimtools/none-ls-extras.nvim",
			{
				"stsewd/isort.nvim",
				build = ":UpdateRemotePlugins",
			},
		},
		opts = function(_, opts)
			local nls = require("null-ls")
			opts.sources = {
				-- Diagnostics
				require("none-ls.diagnostics.eslint"),
				nls.builtins.diagnostics.commitlint,
				-- nls.builtins.diagnostics.editorconfig_checker,
				nls.builtins.diagnostics.markdownlint,
				nls.builtins.diagnostics.spectral,
				nls.builtins.diagnostics.sqlfluff.with({
					extra_args = { "--dialect", "postgres" }, -- change to your dialect
				}),

				-- Formatting
				require("none-ls.formatting.eslint"),
				nls.builtins.formatting.shfmt,
				nls.builtins.formatting.google_java_format,
				nls.builtins.formatting.markdownlint,
				nls.builtins.formatting.prettierd.with({
					filetypes = { "json", "jsonc", "yaml", "markdown", "markdown.mdx" },
				}),
				nls.builtins.formatting.stylua,
				nls.builtins.formatting.sqlfluff.with({
					extra_args = { "--dialect", "postgres" },
				}),
				nls.builtins.formatting.npm_groovy_lint.with({
					filetypes = { "groovy" },
				}),
				nls.builtins.formatting.isort,
				nls.builtins.formatting.black,

				-- Code Actions
				require("none-ls.code_actions.eslint"),
			}
		end,
	},
	{
		"laytan/tailwind-sorter.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-lua/plenary.nvim" },
		build = "cd formatter && npm ci && npm run build",
		opts = {
			on_save_enabled = true,
			on_save_pattern = { "*.html", "*.jsx", "*.tsx", "*.vue" },
			trim_spaces = true,
		},
	},
	{
		"https://gitlab.com/schrieveslaach/sonarlint.nvim.git",
		opts = {
			server = {
				cmd = {
					"sonarlint-language-server",
					"-stdio",
					"-analyzers",
					vim.fn.expand("~/.local/share/nvim/mason/share/sonarlint-analyzers/sonarjava.jar"),
				},
				settings = {
					sonarlint = {
						rules = {
							["typescript:S101"] = { level = "on", parameters = { format = "^[A-Z][a-zA-Z0-9]*$" } },
							["typescript:S103"] = { level = "on", parameters = { maximumLineLength = 180 } },
							["typescript:S106"] = { level = "on" },
							["typescript:S107"] = { level = "on", parameters = { maximumFunctionParameters = 7 } },
						},
					},
				},
			},
			filetypes = {
				"java",
				"typescript",
				"javascript",
				"vue",
			},
		},
	},
}
