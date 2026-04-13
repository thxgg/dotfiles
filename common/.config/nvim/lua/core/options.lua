local opt = vim.opt

opt.backup = false
opt.breakat = " \t!@*-+;:,./?"
opt.breakindent = true
opt.breakindentopt = "shift:2,sbr"
opt.clipboard = "unnamedplus"
opt.cursorline = true
opt.cursorlineopt = "both"
opt.expandtab = true
opt.guicursor = ""
opt.hlsearch = false
opt.ignorecase = true
opt.incsearch = true
opt.smartcase = true
opt.isfname:append("@-@")
opt.linebreak = true
opt.list = true
opt.listchars = "tab:⇥ ,trail:-"
opt.number = true
opt.relativenumber = false
opt.scrolloff = 8
opt.shiftwidth = 4
opt.showbreak = "↳"
opt.showmode = false
opt.signcolumn = "yes"
opt.smartindent = true
opt.softtabstop = 4
opt.splitbelow = true
opt.splitright = true
opt.swapfile = false
opt.tabstop = 4
opt.undofile = true
opt.wrap = false
opt.wrapmargin = 0

-- Right click mouse menu
vim.cmd.aunmenu({ "PopUp.How-to\\ disable\\ mouse" })
vim.cmd.aunmenu({ "PopUp.-1-" })

-- Netrw
vim.g.loaded_netrwPlugin = 1
vim.g.loaded_netrw = 1

-- Providers
vim.g.loaded_node_provider = 0
vim.g.loaded_perl_provider = 0
vim.g.loaded_ruby_provider = 0

-- fish 4.x terminal capability queries can leak raw escape-sequence responses
-- inside Neovim terminal buffers (for example after Ctrl-C). Disable them for
-- child shells spawned by Neovim without affecting the outer terminal session.
do
	local fish_features = vim.env.fish_features or ""
	local features = fish_features == "" and {} or vim.split(fish_features, "[,%s]+", { trimempty = true })

	if not vim.list_contains(features, "no-query-term") then
		table.insert(features, "no-query-term")
		vim.env.fish_features = table.concat(features, " ")
	end
end

-- Clipboard over SSH
local is_ssh = vim.env.SSH_CONNECTION ~= nil or vim.env.SSH_TTY ~= nil or vim.env.SSH_CLIENT ~= nil
if is_ssh then
	local ok, osc52 = pcall(require, "vim.ui.clipboard.osc52")
	if ok then
		vim.g.clipboard = {
			name = "OSC52",
			copy = {
				["+"] = osc52.copy("+"),
				["*"] = osc52.copy("*"),
			},
			paste = {
				-- Don't use OSC 52 for paste: tmux intercepts the read query
				-- and never forwards it to the outer terminal, causing a hang.
				-- Returning nil makes Neovim use its internal register cache.
				["+"] = function() end,
				["*"] = function() end,
			},
		}
	end
end
