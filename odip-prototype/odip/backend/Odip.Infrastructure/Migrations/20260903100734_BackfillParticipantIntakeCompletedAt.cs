using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class BackfillParticipantIntakeCompletedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // PF-10.7 (SPEC-05, "PF-10.7 — Existing-participant migration & old-wizard retirement"):
            // existing participants predate IntakeCompletedAt (added by the earlier
            // AddParticipantIntakeCompletedAt migration). A completed (IsDraft = false) row, by
            // definition, went all the way through the old single wizard's Review step — a
            // superset of both new wizards' required fields — so it is immediately both
            // intake-complete and profile-complete; backfill IntakeCompletedAt to CreatedAt (the
            // closest available proxy, since the old wizard had no per-step timestamp). An
            // in-progress draft (IsDraft = true) is left NULL so the PF-10.5 resume banner routes
            // it to a fresh Intake start pre-filled from this same row — no data is lost or
            // re-asked, since the new Intake wizard reads the identical underlying fields.
            //
            // IDEMPOTENCY: the "IntakeCompletedAt" IS NULL guard means an already-set value (e.g.
            // a participant created under the NEW Intake wizard, which sets this server-side on
            // completion, or a second run of this same migration/backfill) is never overwritten —
            // required because this runs against the live production database on merge and must
            // be safe to re-run. See ParticipantIntakeCompletedAtBackfill (Odip.Infrastructure/Data)
            // for the unit-tested C# mirror of this exact rule (both branches).
            migrationBuilder.Sql(
                """
                UPDATE "Participants"
                SET "IntakeCompletedAt" = "CreatedAt"
                WHERE "IsDraft" = false AND "IntakeCompletedAt" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately a no-op. This is a pure data backfill with no schema change to revert,
            // and reversing it by nulling every non-draft IntakeCompletedAt back out would be
            // actively wrong: it cannot distinguish a row this migration backfilled from CreatedAt
            // from a row whose IntakeCompletedAt was later legitimately set by the new Intake
            // wizard after this migration ran — the latter would be incorrectly wiped, silently
            // routing an already-intake-complete participant back through "Resume intake".
            // Rolling back to pre-migration state for this column is therefore not achievable
            // (or desirable) via Down(); the safe rollback path is restoring from a backup taken
            // before this migration ran, same as any other one-way data backfill in this codebase.
        }
    }
}
