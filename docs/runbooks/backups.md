# Backups runbook

Two backup systems exist. The older one keeps running.

| | Old nightly (since 2026-10-14) | New encrypted sets (this runbook) |
|---|---|---|
| What it covers | The database only | The database, the `documents` volume and the `odip-dp-keys` volume |
| Where | Root cron on the server, folder `/mnt/docker/backups/odip/` (7 daily, 4 weekly, 6 monthly), a Sunday restore test and a 09:00 age check | `~/odip-backup/staged/` on the server (newest 7 sets), then copied to the owner's PC |
| Encryption | `openssl` AES-256, key kept on the server | `age` public-key: the server holds only the public key, the private key stays with the owner |
| How to restore | `F:/Projects/.claude/tools/odip-backup/README.md` (its commands are not copied here) | The live restore section below |

The old job stays until the new sets have passed a restore drill. Retiring it is an owner step (removing its three root crontab lines), never automatic. The new job shares no file, lock, folder or container name with it. Its cron line is at 03:15 server time (UTC), clear of the old jobs at 15:30, 16:30, 22:00 and 23:00 UTC.

## What works today

- **Works now (PR A):** the server nightly, `deploy/backup-nightly.sh`. It leaves one set per night in `~/odip-backup/staged/`. A set is three files: `<stem>.db.age`, `<stem>.files.age` and `<stem>.manifest` (written last; its presence means the set is complete).
- **Arrives with the PC pull:** copying sets to `F:\Backups\ODIP\sets\`, retention there and the Slack alerts.
- **Arrives with the drill:** the restore drill. Until it passes once, treat the new sets as unproven.

The stack's `.env` (database password, integration secrets) is not in any backup. It stays in the password manager.

## Owner's one-time steps (no agent ever holds the private key)

**PowerShell**, install age without admin (check the zip's checksum against the release page before unpacking):
```
$d="$env:LOCALAPPDATA\Programs\age"; New-Item -ItemType Directory -Force $d | Out-Null
Invoke-WebRequest https://github.com/FiloSottile/age/releases/download/v1.2.1/age-v1.2.1-windows-amd64.zip -OutFile "$env:TEMP\age.zip"
Expand-Archive "$env:TEMP\age.zip" "$env:TEMP\age-x" -Force; Copy-Item "$env:TEMP\age-x\age\*.exe" $d; Remove-Item "$env:TEMP\age.zip","$env:TEMP\age-x" -Recurse
```
**Git Bash**, make the key pair. If the key file already exists, stop: a key already exists.
```
mkdir -p "$USERPROFILE/.odip-backup"
"$LOCALAPPDATA/Programs/age/age-keygen.exe" -o "$USERPROFILE/.odip-backup/odip-backup.key"
"$LOCALAPPDATA/Programs/age/age-keygen.exe" -y "$USERPROFILE/.odip-backup/odip-backup.key" > "$USERPROFILE/.odip-backup/odip-backup.pub"
```
**PowerShell**, lock the private key to your account only:
```
icacls "$env:USERPROFILE\.odip-backup\odip-backup.key" /inheritance:r /grant:r "${env:USERNAME}:R"
```
**Password manager:** open the `.key` file in Notepad, copy all three lines into a secure note named "Bunya Support backup key", and close without saving. Never paste it into chat or an agent.

**Git Bash**, send the PUBLIC key to the server and check it:
```
ssh connah@192.168.4.70 'mkdir -p ~/odip-backup && chmod 700 ~/odip-backup && cat > ~/odip-backup/recipient.txt' < "$USERPROFILE/.odip-backup/odip-backup.pub"
ssh connah@192.168.4.70 'grep -c "^age1" ~/odip-backup/recipient.txt'    # prints 1
```
**After this PR deploys** (the deploy copies the scripts into `~/odip-backup/bin/`), install the cron line and run it once (Git Bash). The cron line is a user crontab line for `connah`; it does not touch the old root jobs.
```
ssh connah@192.168.4.70 '(crontab -l 2>/dev/null | grep -v odip-backup/bin/backup-nightly.sh; echo "15 3 * * * bash \$HOME/odip-backup/bin/backup-nightly.sh >> \$HOME/odip-backup/nightly.log 2>&1") | crontab -'
ssh connah@192.168.4.70 'bash ~/odip-backup/bin/backup-nightly.sh'
```
The second command prints `nightly backup staged: odip-<time> (db N bytes, files N bytes, T tables, R rows)`. A failure prints the reason and is also written to `~/odip-backup/staged/last-failure.txt`. Exit 75 means another run holds the lock.

**After the PC pull merges**, create the pull task (PowerShell, current user, no admin):
```
New-Item -ItemType Directory -Force F:\Backups\ODIP\sets | Out-Null
$node=(Get-Command node).Source
$a=New-ScheduledTaskAction -Execute $node -Argument "F:\Projects\.claude\tools\odip-backup\backup-pull.js"
$t=New-ScheduledTaskTrigger -Once -At 6:00am -RepetitionInterval (New-TimeSpan -Hours 3)
$s=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName "ODIP Backup Pull" -Action $a -Trigger $t -Settings $s
(Get-ScheduledTask "ODIP Backup Pull").Triggers.Repetition    # Interval PT3H; check Duration is empty (indefinite)
Start-ScheduledTask "ODIP Backup Pull"; Start-Sleep 60; Get-Content F:\Backups\ODIP\pull.log -Tail 1   # must show a fetched or up-to-date stem, not "unreachable"
```
**After the drill merges**, create the drill task, then run the first drill yourself:
```
$a=New-ScheduledTaskAction -Execute $node -Argument "F:\Projects\.claude\tools\odip-backup\backup-drill.js"
$t=New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Sunday -At 11:00am
Register-ScheduledTask -TaskName "ODIP Backup Drill" -Action $a -Trigger $t -Settings $s
Start-ScheduledTask "ODIP Backup Drill"; Get-Content F:\Backups\ODIP\drills.log -Tail 1   # "... OK ..." is done
```

## Key rotation

Make a new pair (the key steps above, with a new file name), replace `~/odip-backup/recipient.txt` on the server with the new public key, and keep the old `.key` until every set made with it has aged out (about 12 months). Sets already made stay readable only with the key that made them.

## Drill

`node F:/Projects/.claude/tools/odip-backup/backup-drill.js [stem]` (arrives with the drill PR). It never touches the live stack.

## Live restore (owner only)

Plaintext is streamed over ssh and never written to disk. Run in Git Bash with `K="$USERPROFILE/.odip-backup/odip-backup.key"`, `AGE="$LOCALAPPDATA/Programs/age/age.exe"`, `S=F:/Backups/ODIP/sets/<stem>`, `H=connah@192.168.4.70`:

1. Pick the stem: `status.json` `lastGood`, or the newest set whose drill passed.
2. Safety dump of the current state: `ssh $H 'cd /mnt/docker/stacks/odip && DUMP_DIR=$HOME/odip-backup/pre-restore KEEP=3 GIT_SHA=prerestore bash ~/odip-backup/bin/predeploy-dump.sh'`.
3. Stop the API: `ssh $H 'cd /mnt/docker/stacks/odip && docker compose stop api'`.
4. Fresh database: `ssh $H 'docker exec odip-db sh -c "dropdb -U \$POSTGRES_USER \$POSTGRES_DB && createdb -U \$POSTGRES_USER \$POSTGRES_DB"'`.
5. Restore: `"$AGE" -d -i "$K" "$S.db.age" | ssh $H 'docker exec -i odip-db sh -c "pg_restore --no-owner --exit-on-error -U \$POSTGRES_USER -d \$POSTGRES_DB"'`.
6. Files, only if the volumes are lost or damaged: `"$AGE" -d -i "$K" "$S.files.age" | ssh $H 'docker run --rm -i --volumes-from odip-api postgres:16-alpine tar -C / -xf -'`.
7. Start the API: `ssh $H 'cd /mnt/docker/stacks/odip && docker compose start api'`, then check the deploy health URL. Spot-check two `rows` lines from `$S.manifest` with `docker exec odip-db psql -U postgres -d odip -Atc 'select count(*) from public."<Table>"'`.
