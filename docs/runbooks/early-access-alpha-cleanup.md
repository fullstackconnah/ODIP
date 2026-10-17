# Alpha sign-ups: cleanup when the alpha ends

The landing page tells people: "We keep them until the alpha ends, for 12 months at most, or delete them sooner if you ask." This page is how that promise is kept. It belongs on the landing release checklist (`odip-prototype/odip/frontend/welcome/RELEASE-CHECKLIST.md`) as the "alpha-end cleanup" item; that file belongs to the landing-page work, so the steps live here.

## What the system does on its own

- `EarlyAccessPurgeBackgroundService` runs once when the API starts and then every hour. It deletes each sign-up whose first send (`CreatedAtUtc`) is 12 months ago or longer. The cutoff is one interval (1 hour) early, and it is computed as the inverse of `CreatedAtUtc.AddMonths(12)` (a 29 Feb sign-up is due 28 Feb the next year), so a row is gone at least an hour before its 12 months, never after, and about a day early around 28 Feb.
- A repeat sign-up does not restart the 12 months, and it never overwrites the stored answers. One whose answers differ is kept as a later submission (up to 10 per sign-up). After those 10, only the first further repeat is kept, in one over-limit row that no later repeat replaces; the others are only counted (with the time of the latest). All of it is deleted with the sign-up, by the purge and by a SuperAdmin's Delete.
- It writes no audit rows for the purge. The log line "Deleted N early-access sign-ups ..." gives a count only.

This is the 12-month backstop for the database. It is not the alpha-end cleanup, and it does not reach the operator's mailbox or backups (below).

## When the alpha ends

1. Get the owner's approval before any bulk deletion on live. Nothing here is run without it.
2. A SuperAdmin opens Settings, Alpha sign-ups, and deletes every sign-up (Delete on each row; each Delete writes one audit row that names who and when and holds none of the person's details). Later submissions go with their sign-up.
3. Reload the tab and check it shows "No one has signed up for the alpha yet."
4. Delete the operator's copies of the notification emails (next section). Archiving them is not enough.

## What deleting from the database does not remove

- **Operator notification emails.** When `EarlyAccess:NotifyEmail` is set, each new sign-up, and each repeat whose answers differ, is emailed to that address. The email carries the name, organisation, email address and the time it was sent. It does not carry the optional answers (role, phone, size, message): those are read in Settings, Alpha sign-ups. The subjects start "Bunya Support early-access" ("New Bunya Support early-access request", "Bunya Support early-access form sent again", "... (last one kept)", "... (over the limit)").
  - These copies hold personal data (a name and an email address) in the recipient's mailbox. **Archiving does not remove them**: an archived message is still stored. They must be **deleted**, including from Trash or Deleted Items, and from any shared mailbox, forwarding rule or mail client that holds a copy.
  - Search the mailbox for the subject prefix "Bunya Support early-access", delete every match, then empty the deleted-items folder. Do this when a person asks to be removed (for their messages) and for all of them when the alpha ends, and no later than 12 months after each email, like the database rows.
  - Mailbox retention is not recorded in this repository: it is an owner item.
- **Database backups.** The repository records no backup schedule or retention for the live database (the demo-data runbook only says to take a `pg_dump` before a change). Whatever backups the homelab keeps will still hold deleted sign-ups until they age out. Their retention is an open owner item: record it here once it is known, and say it in the privacy notice if backups are kept longer than 12 months.

No live purge or mailbox deletion is part of shipping this page; both are run by the owner or a SuperAdmin at alpha end.
