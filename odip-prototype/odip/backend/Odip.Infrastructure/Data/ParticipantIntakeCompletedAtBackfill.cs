using Microsoft.EntityFrameworkCore;

namespace Odip.Infrastructure.Data;

/// <summary>
/// C# mirror of the raw SQL the <c>BackfillParticipantIntakeCompletedAt</c> EF migration runs
/// against Postgres (PF-10.7, SPEC-05 `docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md`):
/// existing participants predate <see cref="Odip.Domain.Entities.Participant.IntakeCompletedAt"/>,
/// so a fully-completed (<c>IsDraft = false</c>) row is backfilled to treat its creation time as
/// the closest available proxy for "when intake-equivalent data was captured" — the old single
/// wizard's Review step required a superset of both new wizards' fields, so completing it implies
/// intake-completeness. An in-progress draft (<c>IsDraft = true</c>) is left with a null
/// <see cref="Odip.Domain.Entities.Participant.IntakeCompletedAt"/> so PF-10.5's resume banner
/// routes it to a fresh Intake start pre-filled from the row — no data is lost or re-asked, since
/// the new Intake wizard reads from the same underlying fields.
///
/// Migrations have no DbContext to run LINQ against, so the real backfill path for an upgraded
/// database is the migration's raw SQL. This class exists purely so the same rule can be exercised
/// via EF Core InMemory in tests — same "C# mirror of a raw-SQL migration" shape as
/// <see cref="ParticipantFundingSourceBackfill"/>. Idempotent: an already-set
/// <see cref="Odip.Domain.Entities.Participant.IntakeCompletedAt"/> (e.g. a participant created
/// under the NEW Intake wizard, which sets it server-side on completion) is never overwritten, so
/// this is safe to invoke more than once — e.g. from a test, or as an out-of-band recovery run.
/// </summary>
public static class ParticipantIntakeCompletedAtBackfill
{
    /// <summary>Returns how many participant rows the backfill actually changed.</summary>
    public static async Task<int> RunAsync(OdipDbContext db, CancellationToken ct = default)
    {
        var participants = await db.Participants.IgnoreQueryFilters().ToListAsync(ct);
        var changed = 0;

        foreach (var p in participants)
        {
            if (p.IntakeCompletedAt is not null) continue; // idempotency guard — never overwrite an already-set value
            if (p.IsDraft) continue; // leave drafts null — PF-10.5's resume banner routes these to a fresh Intake start

            p.IntakeCompletedAt = p.CreatedAt;
            changed++;
        }

        if (changed > 0) await db.SaveChangesAsync(ct);
        return changed;
    }
}
