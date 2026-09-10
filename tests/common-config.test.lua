local root = assert(vim.env.DOTFILES_TEST_ROOT)
local lua_root = root .. "/common/.config/nvim/lua/"
local configs = {}
vim.lsp.config = function(name, config) configs[name] = config end
vim.lsp.enable = function() end
vim.lsp.rpc.start = function(cmd, _, options) return { cmd = cmd, options = options } end
vim.env.JAVA_HOME = nil
vim.fn.executable = function() return 0 end

dofile(lua_root .. "plugins/lsp.lua")
local java = assert(configs.jdtls)
local a = java.cmd({}, { root_dir = "/project/a" })
local b = java.cmd({}, { root_dir = "/project/b" })
local again = java.cmd({}, { root_dir = "/project/a" })
assert(a.cmd[#a.cmd] ~= b.cmd[#b.cmd], "Projects must have separate Java workspaces")
assert(a.cmd[#a.cmd] == again.cmd[#again.cmd], "Workspace paths must be stable")
assert(a.cmd[#a.cmd - 1] == "-data")
assert(a.options.cwd == "/project/a")
local standalone = java.cmd({}, {})
assert(standalone.options.cwd == vim.uv.cwd(), "Standalone Java files use the current directory")
assert(vim.fn.isdirectory(a.cmd[#a.cmd]) == 1)
assert(java.settings.java.inlayHints.parameterNames.enabled == "all")

local setup_called = false
package.loaded["dap-go"] = {
  setup = function() setup_called = true end,
  debug_test = function() end,
}
for _, plugin in ipairs(dofile(lua_root .. "plugins/debugging.lua")) do
  if plugin[1] == "leoluz/nvim-dap-go" then
    assert(vim.tbl_contains(plugin.dependencies, "mfussenegger/nvim-dap"))
    plugin.config()
  end
end
assert(setup_called, "Go debugging setup must run")

dofile(lua_root .. "core/mappings.lua")
assert(vim.fn.maparg("Wq", "n") == ":wq<CR>")
assert(vim.fn.maparg("Wqa", "n") == ":wqa<CR>")
local theme = dofile(lua_root .. "user/theme.lua")
assert(theme.background() == "light")
assert(theme.catppuccin_flavour() == "latte")
print("Shared editor checks passed")
