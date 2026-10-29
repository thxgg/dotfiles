# Rex navigation

`init.lua` keeps the Herdr navigation layout with `Ctrl+x` as the prefix.
It does not change appearance, shell settings, or agent integrations.
Pi reports program status natively through OSC 7501.

| Keys after Ctrl+x | Action |
| --- | --- |
| Ctrl+x | Send literal Ctrl+x |
| ? | Command palette |
| Shift+s | Settings |
| r | Reload config |
| s or w | Session picker |
| Shift+n / Shift+w / Shift+d | New / rename / close session |
| ( / ) | Previous / next session (Shift+9 / Shift+0 on a US layout) |
| c | New tab |
| p / n / 1–9 | Previous / next / numbered tab |
| , / Shift+x | Rename / close tab |
| Backslash / Enter | Split right / down |
| x / m | Close / zoom pane |
| Tab / Shift+Tab | Next / previous pane |
| b | Toggle sidebar |
| Shift+r | Resize mode |

`Ctrl+h/j/k/l` focus panes directly. These chords do not reach terminal programs.
Resize mode accepts arrows or `h/j/k/l`, `=` to balance, and Enter or Escape to
exit. Other keys do nothing while this mode is active.

Herdr detach, copy mode, goto, and numbered agent focus have no bindings here.
Closing a Rex session terminates its programs; it is not a detach operation.
Client-level shortcut overrides take precedence over `init.lua`.

Fish completion lives in `../fish/completions/rex.fish` and loads from the
installed CLI. Keep Herdr configuration available independently.

See `tests/README.md` in the repository root for validation. Deployment and
reload are separate, explicit operations; editing these files does neither.
