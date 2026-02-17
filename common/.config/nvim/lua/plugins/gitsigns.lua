return {
	"lewis6991/gitsigns.nvim",
	opts = {
		signs = {
			add = { text = "+" },
			change = { text = "~" },
			delete = { text = "-" },
			topdelete = { text = "-" },
			changedelete = { text = "~" },
			untracked = { text = "┆" },
		},
		current_line_blame = true,
		current_line_blame_opts = {
			virt_text_priority = 9999,
		},
		on_attach = function(bufnr)
			local gs = package.loaded.gitsigns

			local function map(mode, l, r, opts)
				opts = opts or {}
				opts.buffer = bufnr
				vim.keymap.set(mode, l, r, opts)
			end

			-- Navigation
			map("n", "]g", function()
				if vim.wo.diff then
					return "]g"
				end
				vim.schedule(function()
					gs.next_hunk()
				end)
				return "<Ignore>"
			end, { expr = true })

			map("n", "[g", function()
				if vim.wo.diff then
					return "[g"
				end
				vim.schedule(function()
					gs.prev_hunk()
				end)
				return "<Ignore>"
			end, { expr = true })

			-- Actions
			map("n", "<leader>gb", gs.toggle_current_line_blame, { desc = "[G]it [B]lame Line" })
			map("n", "<leader>gB", gs.blame, { desc = "[G]it [B]lame" })
			map("n", "<leader>gD", gs.diffthis, { desc = "[G]it [D]iff" })
			map("n", "<leader>gp", gs.preview_hunk, { desc = "[G]it [P]review" })
			map("n", "<leader>gP", gs.preview_hunk_inline, { desc = "[G]it [P]review Inline" })
			map("n", "<leader>gsh", gs.stage_hunk, { desc = "[G]it [S]tage [H]unk" })
			map("n", "<leader>gsb", gs.stage_buffer, { desc = "[G]it [S]tage [B]uffer" })
			map("n", "<leader>guh", gs.undo_stage_hunk, { desc = "[G]it [U]nstage [H]unk" })
			map("n", "<leader>ghr", gs.reset_hunk, { desc = "[G]it [H]unk [R]eset" })
			map("n", "<leader>gbr", gs.reset_buffer, { desc = "[G]it [B]uffer [R]eset" })
		end,
	},
}
