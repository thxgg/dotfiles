if test (uname) = Darwin
    function ghosttyrc
        pushd "$HOME/Library/Application Support/com.mitchellh.ghostty" >/dev/null; or return
        $EDITOR config
        set -l edit_status $status
        popd >/dev/null
        return $edit_status
    end
end
