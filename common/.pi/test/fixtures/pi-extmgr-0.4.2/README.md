# pi-extmgr patch fixtures

Pristine `src/index.ts` and `src/commands/registry.ts` from the published npm
package `pi-extmgr@0.4.2` (https://github.com/ayagmar/pi-extmgr).
The package's MIT license is retained here.

These are test data, not a deployed extension. The offline patch test checks
source hashes, repeat application, preflight failure, and deferred imports.
Keep them pristine when changing the patch. An upstream upgrade requires a
reviewed rebase of `scripts/patch-pi-extmgr.mjs` and these fixtures.
