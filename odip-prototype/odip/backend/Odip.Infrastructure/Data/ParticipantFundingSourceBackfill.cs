using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

/// <summary>
/// C# mirror of the raw SQL the <c>AddParticipantFundingSource</c> EF migration runs against
/// Postgres to backfill <see cref="Odip.Domain.Entities.Participant.FundingSource"/> on upgrade:
/// rows with a non-empty (post-trim) <see cref="Odip.Domain.Entities.Participant.FundingOrganisation"/>
/// become <see cref="ParticipantFundingSource.Other"/>; everything else stays at the column's
/// <see cref="ParticipantFundingSource.Ndis"/> default (the <c>AddColumn</c> default value already
/// covers the empty/null case, so only the non-empty rows actually need flipping).
///
/// Migrations have no DbContext to run LINQ against, so the real backfill path for an upgraded
/// database is the migration's raw SQL. This class exists purely so that same rule can be
/// exercised via EF Core InMemory in tests — same "C# mirror of a raw-SQL migration" shape as
/// <see cref="RestrictivePracticeBackfill"/> and <see cref="StaffUserUnificationMapping"/> use for
/// their own migrations. Idempotent (a no-op re-run touches nothing), so it is safe to invoke more
/// than once — e.g. from a test, or as an out-of-band recovery run.
/// </summary>
public static class ParticipantFundingSourceBackfill
{
    /// <summary>Returns how many participant rows the backfill actually changed.</summary>
    public static async Task<int> RunAsync(OdipDbContext db, CancellationToken ct = default)
    {
        var participants = await db.Participants.IgnoreQueryFilters().ToListAsync(ct);
        var changed = 0;

        foreach (var p in participants)
        {
            // Matches the migration's raw-SQL WHERE clause: btrim(...) <> '' treats
            // whitespace-only text as blank, same as a genuinely empty string.
            var expected = string.IsNullOrWhiteSpace(p.FundingOrganisation)
                ? ParticipantFundingSource.Ndis
                : ParticipantFundingSource.Other;
            if (p.FundingSource == expected) continue;
            p.FundingSource = expected;
            changed++;
        }

        if (changed > 0) await db.SaveChangesAsync(ct);
        return changed;
    }
}
