return {
	"saghen/blink.cmp",
	dependencies = {
		"saghen/blink.lib",
	},
	build = function()
		-- Lazy can rebuild after blink.cmp was already loaded in the current
		-- session. Reload it so the native helper targets the post-update commit.
		package.loaded["blink.cmp"] = nil
		require("blink.cmp").build({ force = true }):pwait()
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
