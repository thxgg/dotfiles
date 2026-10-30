local root = assert(vim.env.DOTFILES_TEST_ROOT)
vim.opt.rtp:prepend(root .. "/common/.config/nvim")
local palette = vim.json.decode(table.concat(vim.fn.readfile(root .. "/common/.local/share/merino/palette.json"), "\n"))
local engine = vim.env.MERINO_CATPPUCCIN_PATH
if engine then
  vim.opt.rtp:append(engine)
  local spec = require("plugins.colorscheme")[1]
  -- Avoid lazy.nvim discovery. This test must not bootstrap any plugins.
  spec.opts.auto_integrations = false
  spec.opts.integrations = {}
  spec.config(spec, spec.opts)
end
local theme = require("user.theme")
for _, mode in ipairs({ "dark", "light", "dark" }) do
  vim.o.background = mode
  local c = palette[mode]
  local mapped = theme.palette()
  assert(mapped.base == c.background)
  assert(mapped.text == c.foreground)
  assert(mapped.accent == c.accent)
  assert(theme.lualine().normal.a.bg == c.accent)
  if engine then
    -- Setting background must reload the colorscheme without an explicit :colorscheme.
    assert(vim.g.colors_name == "merino")
    local normal = vim.api.nvim_get_hl(0, { name = "Normal", link = false })
    assert(normal.bg == tonumber(c.background:sub(2), 16), vim.inspect(normal))
    assert(normal.fg == tonumber(c.foreground:sub(2), 16), vim.inspect(normal))
    local cursor = vim.api.nvim_get_hl(0, { name = "Cursor", link = false })
    assert(cursor.bg == tonumber(c.cursor:sub(2), 16))
    local visual = vim.api.nvim_get_hl(0, { name = "Visual", link = false })
    assert(visual.bg == tonumber(c.selectionBackground:sub(2), 16))
    assert(visual.fg == tonumber(c.selectionForeground:sub(2), 16))
    local comment = vim.api.nvim_get_hl(0, { name = "Comment", link = false })
    assert(comment.fg == tonumber(c.muted:sub(2), 16))
  end
end
print("Merino Neovim checks passed" .. (engine and " (real highlight engine)" or " (palette only)"))
