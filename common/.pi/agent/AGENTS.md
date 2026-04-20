# Pi Global Prompt Notes

This file is documentation only.

`safe-stow.sh` intentionally excludes `AGENTS.md`, so `common/.pi/agent/AGENTS.md` is not deployed to `~/.pi/agent/AGENTS.md` and is not loaded by Pi as a global context file.

Keep real global prompt additions in `common/.pi/agent/APPEND_SYSTEM.md` so they stow to `~/.pi/agent/APPEND_SYSTEM.md` and are appended to Pi's system prompt.
