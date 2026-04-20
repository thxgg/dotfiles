if [[ -f "$HOME/.cargo/env" ]]; then
  . "$HOME/.cargo/env"
elif [[ -d "$HOME/.cargo/bin" ]]; then
  path=("$HOME/.cargo/bin" $path)
fi

# Vite+ bin (https://viteplus.dev)
if [[ -f "$HOME/.vite-plus/env" ]]; then
  . "$HOME/.vite-plus/env"
fi
