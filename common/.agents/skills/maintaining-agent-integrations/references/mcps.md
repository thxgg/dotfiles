# MCP locations and pinned updates

## Local configuration map

Paths below use `~` for the current user's home and `<project>` for the actual monorepo checkout. Never copy another machine's absolute paths into a new configuration.

| Client/source | Inspect |
| --- | --- |
| Pi Ephemeral catalog | `~/.pi/ephemeral/mcp/mcp.json`; available choices, not active connections |
| Pi database launcher | `~/.pi/ephemeral/mcp/database-mcp.py`; shared by Pi and Codex by owner choice |
| Pi installed project definitions | `<project>/.pi/mcp-adapter.json` |
| Pi installation metadata | `<project>/.pi/ephemeral.json`; compare `targetPaths`, selected server names, and catalog fingerprints with actual files |
| Pi other possible sources | `~/.config/mcp/mcp.json`, `~/.agents/mcp.json`, `~/.agents/mcp/mcp.json`, `~/.pi/agent/mcp-adapter.json`, project `.mcp.json`, package definitions, and explicit host imports |
| Pi loader/installer truth | `~/.pi/agent/extensions/pi-mcp-adapter-local/config.ts` and `pi-ephemeral/src/{catalog,util,apply,project-state}.ts`; recheck current precedence and fingerprint algorithm |
| Codex | `~/.codex/config.toml`, `<project>/.codex/config.toml`, enabled plugin manifests and their MCP declarations |
| Claude Code | Global `mcpServers` and the relevant project entry in `~/.claude.json`; project `.mcp.json`, `.claude/settings.local.json`, and enabled plugin declarations |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json`, `extensions-installations.json`, extension manifests and enablement settings |
| OpenCode | `~/.config/opencode/opencode.jsonc` and any project configuration |
| Cursor / VS Code | Their user/project `mcp.json` files, including `.cursor/mcp.json` and `.vscode/mcp.json`; absence here does not establish absence of app-managed integrations |

Inspect credentials by **source type and variable name**, not value. Do not read auth stores, session histories, or unrelated Claude project entries for an inventory. Avoid CLI status/list commands that launch configured MCP servers.

At the recorded baseline, Pi's adapter had host discovery off, no Claude/Codex imports, and project `loadSharedProjectConfig: false`. Legacy `.pi/mcp.json` was absent. Do not reintroduce it; inspect current loader behavior if the adapter changes.

Ephemeral's manifest is machine-local installation state: absolute paths, timestamps, and fingerprints. The catalog also contains local launcher paths and app/environment choices. The database launcher has infrastructure defaults. **Keep these files untracked as-is.** A portable template is a separate requested change. Codex's global file may resolve into dotfiles but is Git-ignored; a symlink does not make it version-controlled.

## Decisions to retain

- Keep the project Codex Linear MCP. Its duplicate global Linear plugin was removed. Do not reinstall that plugin during a general update.
- Use `database-production`, including Claude tool permission names such as `mcp__database-production__execute_sql`. A rename must preserve the same permission scope and update relevant references.
- Keep Codex's dependency on Pi's database launcher. The owner explicitly accepted this layout.
- Keep Ephemeral's generic `stripe` name: the remote MCP supports multiple accounts. Do not split it solely because the name lacks an environment. Existing separately authenticated Stripe connections elsewhere are not permission to change accounts.
- Preserve staging/production database access modes. They are deliberate; version maintenance is not a new safety-policy migration.
- Cache/marketplace duplicates do not prove duplicate enabled MCPs. App-managed computer-use bridges can have different roles; do not remove them merely because both use Node.

## Version sources and update targets

These are the pins selected in September 2026, not mandatory versions forever. Read current configuration before choosing an update.

| Dependency | Recorded pin | Authoritative update source | Local definitions to check |
| --- | --- | --- | --- |
| PostgreSQL MCP image | `crystaldba/postgres-mcp@sha256:dbbd346860d29f1543e991f30f3284bf4ab5f096d049ecc3426528f20b1b6e6b` | Docker registry `crystaldba/postgres-mcp`; [crystaldba/postgres-mcp](https://github.com/crystaldba/postgres-mcp) release/source history | Pi launcher constant `POSTGRES_IMAGE`; Claude global database args. Codex references the same Pi launcher. |
| AWS MCP proxy | `mcp-proxy-for-aws==1.7.0` | [PyPI](https://pypi.org/project/mcp-proxy-for-aws/); follow its project links for source/release notes | Ephemeral catalog `aws.args[0]` and selected project adapter definition |
| HubSpot MCP | `@hubspot/mcp-server@0.4.0` | [npm](https://www.npmjs.com/package/@hubspot/mcp-server); verify its current repository metadata | Both Ephemeral HubSpot entries, Codex project shell commands, Claude global HubSpot args |
| Other local launchers | Inspect current args | npm metadata for `opensrc-mcp` and `@thxgg/steward`; official GitHub MCP image/source | Claude globals; these were not included in the database/AWS/HubSpot pinning request |
| Remote MCP endpoints | No local server version pin | Provider documentation and tool discovery | Linear, Stripe, Slack, Shortcut, Exa, SonarCloud; changing a client pin does not pin these services |

Installed-source evidence: `docker image inspect` for repository digests; npm's cached package manifests under `~/.npm/_npx/`; uv package metadata under `~/.cache/uv/`. A cache proves availability of a version, not that a running process uses it. Do not execute an MCP binary simply to learn its version.

### Safe pinned upgrade

1. Capture the current definitions and selected versions without exposing secret values. For pin-only work, use the installed identity where possible; do not silently upgrade to latest.
2. Resolve exact package versions from registry metadata. For example, PyPI `/pypi/mcp-proxy-for-aws/<version>/json` and npm `/@hubspot%2fmcp-server/<version>` verify existence without starting a server.
3. For the database image, resolve the selected release to a repository digest. Distinguish an image/config ID from a pullable repository digest. Inspect supported architectures; the recorded Mac installation was arm64. Do not copy an architecture-specific digest to a different machine without checking compatibility.
4. Read release notes for tool names, argument changes, authentication, database access-mode behavior, and dependencies. Preserve the existing restricted production and unrestricted staging modes unless the user changes that decision.
5. Patch in-scope effective definitions and the catalog together. Use exact npm `@version`, uv `==version`, and Docker `@sha256:...` syntax. Keep credentials outside tracked files.
6. For Pi, verify each selected server's effective definition matches its intended catalog entry. If updating a managed entry, maintain its manifest fingerprint using the current installer's algorithm. The recorded implementation hashes the **whole catalog file**, prefixed with `file:<basename>:<byte-length>\n`; it is not a plain file SHA-256. Do not refresh unrelated installation history to hide differences, or invent new install timestamps.
7. Check JSON/TOML parsing, shell argument structure, and Python syntax without launching tunnels or servers. Confirm the image digest resolves locally or in the registry. Validate credential-free configuration changes against a before-state comparison.
8. If live verification is authorized, test startup and a read-only operation in the intended environment. State separately whether you checked configuration, startup, or a real integration. Let running clients reload/reconnect at an agreed time; do not restart unrelated services.

## Amp is a separate maintenance scope

Only inspect or change Amp when included in the request. Use `manage_amp` for remote personal/workspace/project connections; call its help first. Do not confuse account remote connections with MCPs bundled in skills.

Inspect local Amp settings, repository skills, and canonical account skill sources. Read inline `mcpServers` and sibling `mcp.json`; inline configuration takes precedence. Preserve `includeTools` filters and environment-placeholder credentials. Never edit `~/.cache/amp/global-skills/` or credential caches.

The account integration skills are `database-staging`, `hubspot-staging`, `inspecting-sonarcloud`, `stripe-business-staging`, and `stripe-memberships-staging`. Project `managing-linear` has also contained a connection declaration. Check both it and stored workspace OAuth before claiming Linear was consolidated; account and project state can change independently.

Amp's database implementation differs from the local Pi launcher. At the baseline it used SSH port `15432`, `uv==0.12.4`, Python 3.13, `mcp[cli]==1.29.0`, and `postgres-mcp==0.3.0` in the `database-staging` bundle. Update its dependency combination and tunnel behavior as a separate scoped change, not as part of pinning Pi's Docker image. Preserve SSH host verification, cleanup, and access mode. A fixed-port collision is a separate behavior change, not a package update.

Personal Linear access outside the workspace is an owner requirement. If connection organization is requested, establish whether personal, workspace, or project scope meets that requirement before removing a definition. A pending recommendation from an earlier review is not authorization to apply it.
