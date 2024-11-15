local map = function(mode, lhs, rhs, opts)
	opts = opts or {}
	opts.noremap = mode ~= "t"
	opts.silent = true
	vim.keymap.set(mode, lhs, rhs, opts)
end

local create_user_cmd = vim.api.nvim_create_user_command

vim.g.mapleader = " "

-- Human error correction
map("n", "W", ":w<CR>", { desc = "[W]rite Buffer" })
map("n", "Q", ":q<CR>", { desc = "[Q]uit Buffer" })
map("n", "Qa", ":qa<CR>", { desc = "[Q]uit [A]ll Buffers" })
create_user_cmd("W", "w", {})
create_user_cmd("Wq", "wq", {})
create_user_cmd("Wqa", "wqa", {})
create_user_cmd("Q", "q", {})
create_user_cmd("Qa", "qa", {})
create_user_cmd("Bd", "bd", {})

-- Resize with arrows
map("n", "<C-Up>", ":resize -2<CR>", { desc = "Decrease size by 2" })
map("n", "<C-Down>", ":resize +2<CR>", { desc = "Increase size by 2" })
map("n", "<C-Left>", ":vertical resize -2<CR>", { desc = "Decrease vertical size by 2" })
map("n", "<C-Right>", ":vertical resize +2<CR>", { desc = "Increase vertical size by 2" })

-- Navigation
map("n", "H", ":bprevious<CR>", { desc = "Previous buffer" })
map("n", "L", ":bnext<CR>", { desc = "Next buffer" })
map("n", "<C-d>", "<C-d>zz", { desc = "Recenter cursor after half-page jumping down" })
map("n", "<C-u>", "<C-u>zz", { desc = "Recenter cursor after half-page jumping up" })
map("n", "<C-h>", "<C-w>h", { desc = "[W]indow to the left" })
map("n", "<C-j>", "<C-w>j", { desc = "[W]indow below" })
map("n", "<C-k>", "<C-w>k", { desc = "[W]indow above" })
map("n", "<C-l>", "<C-w>l", { desc = "[W]indow to the right" })
map("t", "<C-h>", "<C-\\><C-N><C-w>h", { desc = "Terminal [W]indow to the left" })
map("t", "<C-j>", "<C-\\><C-N><C-w>j", { desc = "Terminal [W]indow below" })
map("t", "<C-k>", "<C-\\><C-N><C-w>k", { desc = "Terminal [W]indow above" })
map("t", "<C-l>", "<C-\\><C-N><C-w>l", { desc = "Terminal [W]indow to the right" })
map("n", "[q", ":cprevious<CR>", { desc = "Previous [Q]uickfix item" })
map("n", "]q", ":cnext<CR>", { desc = "Next [Q]uickfix item" })

-- Selection manipulation
map("v", "<", "<gv", { desc = "Outdent selection" })
map("v", ">", ">gv", { desc = "Indent selection" })
map("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move selection down" })
map("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move selection up" })

-- Line manipulation
map("n", "J", "mzJ`z", { desc = "[J]oin line below with a space without moving cursor" })

-- Search
map("n", "n", "nzzzv", { desc = "Recenter cursor after next lookup" })
map("n", "N", "Nzzzv", { desc = "Recenter cursor after previous lookup" })
