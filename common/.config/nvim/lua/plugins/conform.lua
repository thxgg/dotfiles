local vp_supported_filetypes = {
	javascript = true,
	typescript = true,
	javascriptreact = true,
	typescriptreact = true,
	vue = true,
	css = true,
	json = true,
	jsonc = true,
}

local vp_package_cache = {}

local function read_json_file(path)
	local ok, lines = pcall(vim.fn.readfile, path)
	if not ok then
		return nil
	end

	local ok_json, data = pcall(vim.json.decode, table.concat(lines, "\n"))
	if not ok_json or type(data) ~= "table" then
		return nil
	end

	return data
end

local function has_vite_plus_dependency(section)
	return type(section) == "table" and section["vite-plus"] ~= nil
end

local function has_vp_scripts(scripts)
	if type(scripts) ~= "table" then
		return false
	end

	for _, script in pairs(scripts) do
		if type(script) == "string" and script:find("vp ", 1, true) ~= nil then
			return true
		end
	end

	return false
end

local function is_vp_package_json(package_json)
	if vp_package_cache[package_json] ~= nil then
		return vp_package_cache[package_json]
	end

	local data = read_json_file(package_json)
	local is_vp = false

	if data then
		is_vp = has_vite_plus_dependency(data.dependencies)
			or has_vite_plus_dependency(data.devDependencies)
			or has_vite_plus_dependency(data.optionalDependencies)
			or has_vp_scripts(data.scripts)

		local pnpm = data.pnpm
		if not is_vp and type(pnpm) == "table" and type(pnpm.overrides) == "table" then
			local override_vite = pnpm.overrides.vite
			local override_vitest = pnpm.overrides.vitest
			is_vp = (type(override_vite) == "string" and override_vite:find("vite-plus", 1, true) ~= nil)
				or (type(override_vitest) == "string" and override_vitest:find("vite-plus", 1, true) ~= nil)
		end
	end

	vp_package_cache[package_json] = is_vp
	return is_vp
end

local function find_vp_root(path)
	local current = vim.fs.dirname(path)
	if not current or current == "" then
		return nil
	end

	local home = vim.uv.os_homedir()
	while current and current ~= "" do
		local package_json = current .. "/package.json"
		if vim.fn.filereadable(package_json) == 1 and is_vp_package_json(package_json) then
			return current
		end

		if current == home or current == "/" then
			break
		end

		local parent = vim.fs.dirname(current)
		if not parent or parent == current then
			break
		end
		current = parent
	end

	return nil
end

local function should_use_vp(bufnr)
	if vim.fn.executable("vp") ~= 1 then
		return false
	end

	if not vp_supported_filetypes[vim.bo[bufnr].filetype] then
		return false
	end

	local filename = vim.api.nvim_buf_get_name(bufnr)
	if filename == "" then
		return false
	end

	return find_vp_root(filename) ~= nil
end

return {
	{
		"stevearc/conform.nvim",
		event = { "BufWritePre" },
		cmd = { "ConformInfo" },
		keys = {
			{
				"<F3>",
				function()
					local bufnr = vim.api.nvim_get_current_buf()
					local opts = { async = true, lsp_format = "fallback" }
					if should_use_vp(bufnr) then
						local filename = vim.api.nvim_buf_get_name(bufnr)
						local vp_root = find_vp_root(filename)
						vim.cmd("silent write")
						vim.system({ "vp", "lint", "--fix", filename }, { cwd = vp_root }):wait()
						vim.cmd("edit")
						opts.formatters = { "vp_fmt" }
					end
					require("conform").format(opts)
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

				local opts = {
					timeout_ms = 500,
					lsp_format = "fallback",
				}

				if should_use_vp(bufnr) then
					opts.formatters = { "vp_fmt" }
				end

				return opts
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
				vp_fmt = {
					inherit = false,
					command = "vp",
					args = { "fmt", "--write", "$FILENAME" },
					stdin = false,
					cwd = function(_, ctx)
						return find_vp_root(ctx.filename)
					end,
					require_cwd = true,
					condition = function(_, ctx)
						return vim.fn.executable("vp") == 1 and find_vp_root(ctx.filename) ~= nil
					end,
				},
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
