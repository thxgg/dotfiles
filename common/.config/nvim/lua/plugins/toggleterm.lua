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

			local function repair_terminal_modes(bufnr)
				if not vim.api.nvim_buf_is_valid(bufnr) then
					return
				end

				local tty = terminal_tty(bufnr)
				if not tty then
					return
				end

				-- Node package runners can let grandchildren reset the PTY after fish has
				-- already returned to its prompt, leaving kernel echo/canonical input on.
				-- That makes keys show up as ^C/^[[A and breaks live completions until the
				-- next prompt. Restore the modes fish/readline expect after Ctrl-C.
				local sysname = (vim.uv or vim.loop).os_uname().sysname
				local tty_flag = sysname == "Darwin" and "-f" or "-F"
				vim.system({ "stty", tty_flag, tty, "-icanon", "-echo", "min", "1", "time", "0" }, { detach = true })
			end

			local function interrupt_and_repair_terminal()
				local bufnr = vim.api.nvim_get_current_buf()
				local job_id = vim.b[bufnr].terminal_job_id
				if not job_id then
					return
				end

				vim.api.nvim_chan_send(job_id, "\003")
				for _, delay in ipairs({ 100, 300, 700 }) do
					vim.defer_fn(function()
						repair_terminal_modes(bufnr)
					end, delay)
				end
			end

			opts.on_open = function(term)
				vim.keymap.set("t", "<C-c>", interrupt_and_repair_terminal, {
					buffer = term.bufnr,
					desc = "Interrupt terminal and repair PTY modes",
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
