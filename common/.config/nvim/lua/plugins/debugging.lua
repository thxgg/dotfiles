local map = function(mode, lhs, rhs, opts)
	opts = opts or {}
	opts.noremap = true
	opts.silent = true
	vim.keymap.set(mode, lhs, rhs, opts)
end

return {
	{
		"mfussenegger/nvim-dap",
		config = function()
			local dap = require("dap")
			map("n", "<F5>", dap.continue, { desc = "Continue" })
			map("n", "<F10>", dap.step_over, { desc = "Step over" })
			map("n", "<F11>", dap.step_into, { desc = "Step into" })
			map("n", "<F12>", dap.step_out, { desc = "Step out" })
			map("n", "<leader>db", dap.toggle_breakpoint, { desc = "Toggle breakpoint" })
			map("n", "<leader>dB", function()
				dap.set_breakpoint(vim.fn.input("Breakpoint condition: "))
			end, { desc = "Set conditional breakpoint" })
			map("n", "<leader>dl", function()
				dap.set_breakpoint(nil, nil, vim.fn.input("Log point message: "))
			end, { desc = "Log point" })
			map("n", "<leader>dr", dap.repl.open, { desc = "Open REPL" })
		end,
	},
	{
		"theHamsta/nvim-dap-virtual-text",
		dependencies = { "mfussenegger/nvim-dap" },
		opts = {},
	},
	{
		"rcarriga/nvim-dap-ui",
		dependencies = { "mfussenegger/nvim-dap", "nvim-neotest/nvim-nio" },
		config = function()
			local dap = require("dap")
			local dapui = require("dapui")

			dapui.setup({
				controls = {
					enable = false,
				},
				layouts = {
					{
						elements = {
							{
								id = "scopes",
								size = 0.25,
							},
							{
								id = "breakpoints",
								size = 0.25,
							},
							{
								id = "stacks",
								size = 0.25,
							},
							{
								id = "watches",
								size = 0.25,
							},
						},
						position = "left",
						size = 30,
					},
					{
						elements = {
							{
								id = "console",
								size = 1.0,
							},
						},
						position = "bottom",
						size = 15,
					},
				},
				icons = {
					expanded = "",
					collapsed = "",
					circular = "",
				},
			})

			-- Automatically open and close the UI windows
			dap.listeners.before.attach.dapui_config = function()
				dapui.open()
			end
			dap.listeners.before.launch.dapui_config = function()
				dapui.open()
			end
			dap.listeners.before.event_terminated.dapui_config = function()
				dapui.close()
			end
			dap.listeners.before.event_exited.dapui_config = function()
				dapui.close()
			end
		end,
	},
	{
		"leoluz/nvim-dap-go",
		config = function()
			map("n", "<leader>dt", require("dap-go").debug_test, { desc = "[D]ebug [T]est" })
		end,
	},
}
