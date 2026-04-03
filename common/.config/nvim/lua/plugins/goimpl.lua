return {
	"edolphin-ydf/goimpl.nvim",
	dependencies = {
		{ "nvim-lua/plenary.nvim" },
		{ "nvim-lua/popup.nvim" },
		{ "nvim-telescope/telescope.nvim" },
		{ "nvim-treesitter/nvim-treesitter" },
	},
	opts = {},
	init = function()
		pcall(require("telescope").load_extension, "goimpl")
	end,
}
