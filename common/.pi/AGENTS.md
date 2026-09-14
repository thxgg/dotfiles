# Pi Workspace

Repository instructions for `common/.pi/`. These instructions are not global Pi
prompt additions. Keep global prompt additions in `agent/APPEND_SYSTEM.md`.

## Workspace Lockfile

- When adding, removing, moving, or renaming an extension workspace, or changing
  the root or workspace package manifests, regenerate `package-lock.json` from
  `common/.pi` with `vp install --lockfile-only`. This includes package-name changes
  with no dependency changes. Review the diff and include the lockfile in the same
  commit as the manifest or directory change.
- Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/pi-bootstrap.test.py` from the
  repository root. Its offline check compares workspace manifests and lockfile links.
- Before committing workspace changes, verify `vp install --frozen-lockfile` in a
  temporary copy of the workspace without existing `node_modules`. Do not change
  live dependencies merely to validate the lockfile. Report if this check cannot run.
- Existing `node_modules`, extension tests, and `pi update --extensions` do not
  verify lockfile consistency. Keep frozen installs in bootstrap and update scripts;
  do not replace them with an automatic non-frozen fallback.
- `agent/npm/package.json` declares external packages managed separately by Pi.
  It is not a member of this workspace. Do not add its dependencies to this lockfile.

## Related Documentation

- [Workspace setup and validation](README.md)
- [Global prompt notes](agent/AGENTS.md)
- [Common home contracts](../AGENTS.md)
