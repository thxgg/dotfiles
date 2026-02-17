return {
	"saghen/blink.cmp",
	build = "cargo build --release",
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
