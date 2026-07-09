function nvimrc
    pushd "$HOME/.config/nvim" >/dev/null; or return
    $EDITOR
    set -l edit_status $status
    popd >/dev/null
    return $edit_status
end
