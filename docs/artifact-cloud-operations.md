# Artifact Cloud Operations

## Daily operation

The service stores a portable SQLite database and immutable blobs. Machine-local configuration lives in `~/.config/artifact-cloud/config`; the publish token remains in `~/.env.secrets`.

```sh
artifact-cloud status
artifact-cloud report
artifact-cloud maintain
```

`maintain` creates an atomic online SQLite snapshot, copies immutable blobs, writes a versioned checksummed manifest, validates the completed backup, preserves the newest backup while removing older snapshots beyond `ARTIFACT_CLOUD_BACKUP_RETENTION_DAYS` (30 by default), runs live integrity checks, and fails when filesystem usage reaches `ARTIFACT_CLOUD_DISK_WARN_PERCENT` (85 by default) or the newest backup exceeds `ARTIFACT_CLOUD_BACKUP_STALE_HOURS` (26 by default).

Backups default to:

- macOS: `~/Library/Application Support/Artifact Cloud/backups`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/artifact-cloud/backups`

These local backups protect against application mistakes, not disk loss. Set `ARTIFACT_CLOUD_REPLICA_DIR` to a mounted encrypted volume or encrypted sync folder to copy and revalidate each successful backup there. The destination must be outside the laptop’s internal data volume to provide disaster recovery; that final property cannot be verified without external storage.

The recovery objectives are **RPO 24 hours** (daily maintenance) and **RTO 30 minutes** for this small personal dataset. Monthly restore drills verify the recovery path.

## Scheduled jobs and logs

macOS uses `com.thxgg.artifact-cloud-maintenance.plist` at 03:17 daily and `com.thxgg.artifact-cloud-drill.plist` on the first day of each month. Linux uses matching maintenance and drill user timers. The systemd journal bounds Linux logs. On macOS, launchd writes under `~/Library/Logs/Artifact Cloud`; maintenance keeps seven compressed 1 MB rotations without requiring elevated privileges. Maintenance reports persist under `~/.local/state/artifact-cloud/reports`, with `latest.log` pointing to the latest successful run.

```sh
# macOS
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.thxgg.artifact-cloud-maintenance.plist
launchctl kickstart -k "gui/$(id -u)/com.thxgg.artifact-cloud-maintenance"

# Linux
systemctl --user enable --now artifact-cloud.service artifact-cloud-maintenance.timer
journalctl --user -u artifact-cloud.service
```

## Restore and drills

A restore must not race a running writer. Stop the service, restore, inspect the reported integrity result, and restart it.

```sh
artifact-cloud export /path/to/new-export
artifact-cloud validate /path/to/new-export
artifact-cloud drill /path/to/backup
artifact-cloud stop                         # or stop launchd/systemd
artifact-cloud restore /path/to/backup
artifact-cloud integrity
artifact-cloud start                        # or start launchd/systemd
```

`restore` first copies into a staging directory and validates SQLite, every referenced blob, byte size, and SHA-256. It then atomically swaps data directories and retains the old directory as `.before-restore.*` for manual rollback. Delete that directory only after viewer and publish smoke tests pass.

A scheduled disposable restore drill runs monthly. Also run one after setup and before migration. The local drill validates data and cleans up its temporary restore; actual Linux execution and off-device recovery remain destination acceptance checks.

## Laptop-to-server migration

1. Run `artifact-cloud maintain` and `artifact-cloud drill` on the laptop.
2. Stop the laptop service to create a final quiescent backup.
3. Copy one complete backup directory to the server over the tailnet.
4. Install/stow the shared files and Linux user units on the server.
5. Copy machine-local configuration and create a new publish token; never copy secrets through Git.
6. Restore the transferred backup, run `artifact-cloud integrity`, then start the service.
7. Configure Tailscale Serve on the server and update `ARTIFACT_CLOUD_BASE_URL` and client `ARTIFACT_CLOUD_API_URL`.
8. Publish a test version, verify canonical and immutable URLs from laptop and phone, then disable the laptop service.
9. Keep the final laptop backup until the server has completed at least one scheduled backup and restore drill.

The current `*.ts.net` hostname is machine-specific. Existing laptop URLs will change unless a durable reverse-proxy hostname is introduced; decide that before migration if stable historical URLs matter.
