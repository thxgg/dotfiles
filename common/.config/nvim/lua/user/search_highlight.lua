-- Create an augroup specifically for incsearch-highlight
vim.api.nvim_create_augroup("vimrc-incsearch-highlight", { clear = true })

-- Autocmd for CmdlineEnter when searching (starts with / or ?)
vim.api.nvim_create_autocmd("CmdlineEnter", {
  pattern = "[/?]",
  callback = function()
    vim.opt.hlsearch = true
  end,
  group = "vimrc-incsearch-highlight",
})

-- Autocmd for CmdlineLeave when searching (starts with / or ?)
vim.api.nvim_create_autocmd("CmdlineLeave", {
  pattern = "[/?]",
  callback = function()
    vim.opt.hlsearch = false
  end,
  group = "vimrc-incsearch-highlight",
})
