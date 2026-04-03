if [[ -f "$HOME/.cargo/env" ]]; then
  . "$HOME/.cargo/env"
elif [[ -d "$HOME/.cargo/bin" ]]; then
  path=("$HOME/.cargo/bin" $path)
fi

# Vite+ bin (https://viteplus.dev)
. "$HOME/.vite-plus/env"
