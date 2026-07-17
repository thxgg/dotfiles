return {
	"saghen/blink.cmp",
	dependencies = {
		"saghen/blink.lib",
	},
	build = function()
		-- `dot update` runs `:Lazy! update` while blink.cmp is already loaded,
		-- and blink caches the repo's git commit at module load. Without a
		-- reload, the post-update build hook sees the pre-update commit, finds
		-- lib/libblink_cmp_fuzzy.so.<old> and no-ops, so every later launch
		-- warns that the native library is missing. Reload so the build checks
		-- and stamps the freshly checked-out commit.
		for name in pairs(package.loaded) do
			if name == "blink.cmp" or vim.startswith(name, "blink.cmp.") then
				package.loaded[name] = nil
			end
		end
		require("blink.cmp").build():pwait()
	end,
	opts = {
		keymap = { preset = "default" },
		appearance = {
			use_nvim_cmp_as_default = true,
			nerd_font_variant = "mono",
		},
		completion = {
			menu = {
				draw = {
					-- Draw the entire selected item background with the kind color
					components = {
						kind_icon = {
							text = function(ctx) return ctx.kind_icon .. ctx.icon_gap end,
							highlight = function(ctx)
								return ctx.item_selected and 'BlinkCmpMenuSelection' or 'BlinkCmpKind' .. ctx.kind
							end,
						},
						label = {
							text = function(ctx) return ctx.label .. ctx.label_detail end,
							highlight = function(ctx)
								return ctx.item_selected and 'BlinkCmpMenuSelection' or 'BlinkCmpLabel'
							end,
						},
						label_description = {
							text = function(ctx) return ctx.label_description end,
							highlight = function(ctx)
								return ctx.item_selected and 'BlinkCmpMenuSelection' or 'BlinkCmpLabelDescription'
							end,
						},
						source = {
							text = function(ctx) return ctx.source_name end,
							highlight = function(ctx)
								return ctx.item_selected and 'BlinkCmpMenuSelection' or 'BlinkCmpSource'
							end,
						},
					},
				},
			},
		},
		sources = {
			default = { "lsp", "path", "snippets" },
			per_filetype = {
				sql = { 'snippets', 'dadbod', 'buffer' },
			},
			providers = {
				dadbod = { name = "Dadbod", module = "vim_dadbod_completion.blink" },
			},
		},
		-- Experimental signature help support
		signature = { enabled = true },
	},
}
