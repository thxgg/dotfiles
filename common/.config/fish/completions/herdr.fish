# Load completions from the installed Herdr version on demand.
if command -q herdr
    command herdr completion fish | source
end
