# Merino Dark by default. Set this to light for a fixed light shell palette.
# This selects only Fish colors; it does not rewrite other applications.
set -l merino_variant dark
source (path dirname (status filename))/../colors/merino-$merino_variant.fish
