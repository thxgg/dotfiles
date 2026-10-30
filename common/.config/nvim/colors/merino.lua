-- Keep the installed highlight engine and its plugin integrations, not its palette.
local flavour = vim.o.background == "light" and "latte" or "mocha"
require("catppuccin").load(flavour)
vim.g.colors_name = "merino"
