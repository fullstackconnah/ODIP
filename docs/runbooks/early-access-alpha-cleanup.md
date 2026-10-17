# Alpha sign-ups: cleanup when the alpha ends

The landing page tells people: "We keep them until the alpha ends, for 12 months at most, or delete them sooner if you ask." This page is how that promise is kept. It belongs on the landing release checklist (`odip-prototype/odip/frontend/welcome/RELEASE-CHECKLIST.md`) as the "alpha-end cleanup" item; that file belongs to the landing-page work, so the steps live here.

## What the system does on its own

- `EarlyAccessPurgeBackgroundService` runs once when the API starts and then every hour. It deletes each sign-up whose first send (`CreatedAtUtc`) is 12 months ago or longer, using a cutoff one interval (1 hour) early, so a row is gone at least an hour before its 12 months and never after.
- A repeat sign-up does not restart the 12 months, and it never overwrites the stored answers (it is kept as a later submission, up to 10 per sign-up, and deleted with the sign-up).
- It writes no audit rows. The log line "Deleted N early-access sign-ups ..." gives a count only.

This is the 12-month backstop. It is not the alpha-end cleanup.

## When the alpha ends

1. Get the owner's approval before any bulk deletion on live. Nothing here is run without it.
2. A SuperAdmin opens Settings, Alpha sign-ups, and deletes every sign-up (Delete on each row; each Delete writes one audit row that names who and when and holds none of the person's details). Later submissions go with their sign-up.
3. Reload the tab and check it shows "No one has signed up for the alpha yet."

## What deleting from the database does not remove

- **Staff notification emails.** When `EarlyAccess:NotifyEmail` is set, each new sign-up is emailed to that address (name, organisation, email, and the optional answers). Those copies sit in the recipient's mailbox. Retention for that mailbox is not recorded in this repository: it is an owner item. Delete or archive the "New Odip early-access request" emails when the alpha ends.
- **Database backups.** The repository records no backup schedule or retention for the live database (the demo-data runbook only says to take a `pg_dump` before a change). Whatever backups the homelab keeps will still hold deleted sign-ups until they age out. Their retention is an owner item: record it here once it is known, and say it in the privacy notice if backups are kept longer than 12 months.
