# Load completions from the installed Rex version on demand.
if command -q rex
    command rex completion fish | source
end
