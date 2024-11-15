#!/usr/bin/env zsh

docker run --rm -v ~/Downloads/berkeley-mono-typeface/berkeley-mono-variable/TTF:/in:Z -v ~/Downloads/berkeley-mono-typeface/berkeley-mono-variable-nerd:/out:Z nerdfonts/patcher --complete
