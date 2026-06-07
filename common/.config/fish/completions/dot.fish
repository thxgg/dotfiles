# Fish shell completions for dot

complete -c dot -f
complete -c dot -n "__fish_use_subcommand" -a "init" -d "Run full machine setup"
complete -c dot -n "__fish_use_subcommand" -a "update" -d "Update repo, packages, Neovim, stow links, and pi"
complete -c dot -n "__fish_use_subcommand" -a "stow" -d "Apply stow links"
complete -c dot -n "__fish_use_subcommand" -a "unstow" -d "Remove stow links"
complete -c dot -n "__fish_use_subcommand" -a "doctor" -d "Validate dotfiles health"
complete -c dot -n "__fish_use_subcommand" -a "check-packages" -d "Check package manifest status"
complete -c dot -n "__fish_use_subcommand" -a "package" -d "Package manifest helpers"
complete -c dot -n "__fish_use_subcommand" -a "benchmark-shell" -d "Benchmark Fish startup"
complete -c dot -n "__fish_use_subcommand" -a "completions" -d "Generate Fish completions"
complete -c dot -n "__fish_use_subcommand" -a "edit" -d "Open dotfiles in editor"
complete -c dot -n "__fish_use_subcommand" -a "link" -d "Repair dot command symlink"
complete -c dot -n "__fish_use_subcommand" -a "unlink" -d "Remove dot command symlinks"
complete -c dot -n "__fish_use_subcommand" -a "help" -d "Show help"

complete -c dot -l version -d "Show version"
complete -c dot -s h -l help -d "Show help"

complete -c dot -n "__fish_seen_subcommand_from update" -l skip-packages -d "Skip package updates"
complete -c dot -n "__fish_seen_subcommand_from update" -l skip-stow -d "Skip re-stowing dotfiles"
complete -c dot -n "__fish_seen_subcommand_from update" -l skip-pi -d "Skip pi update"
complete -c dot -n "__fish_seen_subcommand_from update" -l skip-nvim -d "Skip Neovim Lazy/Mason/Tree-sitter updates"

complete -c dot -n "__fish_seen_subcommand_from stow unstow doctor" -l list-config -d "List available ~/.config components"
complete -c dot -n "__fish_seen_subcommand_from stow unstow doctor" -l only-config -d "Only operate on selected ~/.config components" -x

complete -c dot -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from list help" -a "list" -d "List manifests"
complete -c dot -n "__fish_seen_subcommand_from package; and __fish_seen_subcommand_from list" -a "all macos linux"

complete -c dot -n "__fish_seen_subcommand_from benchmark-shell" -s r -l runs -d "Number of benchmark runs" -x
complete -c dot -n "__fish_seen_subcommand_from benchmark-shell" -s v -l verbose -d "Print individual timings"
