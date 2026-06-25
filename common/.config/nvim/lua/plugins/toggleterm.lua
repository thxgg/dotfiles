return {
	{
		"akinsho/toggleterm.nvim",
		lazy = false,
		opts = {
			open_mapping = [[<C-`>]],
			direction = "float",
			size = 80,
		},
		config = function(_, opts)
			local sysname = (vim.uv or vim.loop).os_uname().sysname
			local tty_flag = sysname == "Darwin" and "-f" or "-F"

			local function terminal_tty(bufnr)
				local pid = vim.b[bufnr].terminal_job_pid
				if not pid then
					return nil
				end

				local tty = vim.trim(vim.fn.system({ "ps", "-o", "tty=", "-p", tostring(pid) }))
				if vim.v.shell_error ~= 0 or tty == "" or tty == "?" or tty == "??" then
					return nil
				end

				if vim.startswith(tty, "/") then
					return tty
				end

				return "/dev/" .. tty
			end

			local function capture_terminal_modes(bufnr)
				if not vim.api.nvim_buf_is_valid(bufnr) then
					return
				end

				local tty = terminal_tty(bufnr)
				if not tty then
					return
				end

				vim.system({ "stty", tty_flag, tty, "-g" }, { text = true }, function(result)
					if result.code ~= 0 or not result.stdout then
						return
					end

					local state = vim.trim(result.stdout)
					if state == "" then
						return
					end

					vim.schedule(function()
						if vim.api.nvim_buf_is_valid(bufnr) then
							vim.b[bufnr].toggleterm_stty_state = state
						end
					end)
				end)
			end

			local function restore_terminal_modes(bufnr)
				if not vim.api.nvim_buf_is_valid(bufnr) then
					return
				end

				local tty = terminal_tty(bufnr)
				if not tty then
					return
				end

				local saved_state = vim.b[bufnr].toggleterm_stty_state
				local args
				if saved_state and saved_state ~= "" then
					args = { "stty", tty_flag, tty, saved_state }
				else
					args = { "stty", tty_flag, tty, "-icanon", "-echo", "min", "1", "time", "0" }
				end

				vim.system(args, { detach = true })
			end

			local function interrupt_and_repair_terminal()
				local bufnr = vim.api.nvim_get_current_buf()
				local job_id = vim.b[bufnr].terminal_job_id
				if not job_id then
					return
				end

				vim.api.nvim_chan_send(job_id, "\003")

				-- Node process runners can exit before their grandchildren finish cleaning
				-- up. The late grandchild can restore cooked terminal modes after fish has
				-- already repainted its prompt, leaving completion and keybindings inert.
				for _, delay in ipairs({ 100, 300, 700, 1500, 3000 }) do
					vim.defer_fn(function()
						restore_terminal_modes(bufnr)
					end, delay)
				end
			end

			opts.on_open = function(term)
				for _, delay in ipairs({ 100, 500, 1000 }) do
					vim.defer_fn(function()
						capture_terminal_modes(term.bufnr)
					end, delay)
				end

				vim.keymap.set("t", "<C-c>", interrupt_and_repair_terminal, {
					buffer = term.bufnr,
					desc = "Interrupt terminal and restore shell TTY modes",
					silent = true,
				})
			end

			local toggleterm = require("toggleterm")
			toggleterm.setup(opts)

			local Terminal = require("toggleterm.terminal").Terminal
			local lazygit = Terminal:new({ cmd = "lazygit", hidden = true, direction = "float" })

			vim.keymap.set("n", "<leader>lg", function()
				lazygit:toggle()
			end, { desc = "Toggle [L]azy[G]it" })
		end,
	},
}
