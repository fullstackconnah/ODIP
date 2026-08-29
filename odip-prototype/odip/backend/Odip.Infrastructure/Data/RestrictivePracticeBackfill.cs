using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

/// <summary>
/// The backfill logic that seeds RestrictivePractice register rows from the legacy fragmented
/// representation: (a) one <see cref="RestrictivePracticeType.Unclassified"/> row per participant
/// whose <see cref="SupportProfile.RestrictivePracticeDetails"/> is non-empty, description set to
/// that legacy text; (b) one <see cref="RestrictivePracticeType.ChemicalRestraint"/> row per
/// <see cref="ParticipantMedication"/> with <c>IsChemicalRestraint == true</c>,
/// <see cref="RestrictivePractice.RelatedMedicationId"/> set, description from the medication name.
///
/// The <c>AddRestrictivePractices</c> EF migration runs the equivalent logic as raw SQL against
/// Postgres — migrations have no DbContext to run LINQ against, so that's the real backfill path
/// for an upgraded database. This C# copy exists so the backfill *algorithm* can be exercised via
/// EF Core InMemory in tests, since raw SQL cannot run against the InMemory provider. Idempotent
/// (checked via an existence query per candidate row) so it is safe to invoke more than once —
/// e.g. from a test, or as an out-of-band recovery run.
/// </summary>
public static class RestrictivePracticeBackfill
{
    public static async Task<int> RunAsync(OdipDbContext db, CancellationToken ct = default)
    {
        var created = new List<RestrictivePractice>();

        // Matches the migration's raw-SQL WHERE clause: trim(...) <> '' treats whitespace-only
        // text as blank, same as a genuinely empty string.
        var legacyProfiles = (await db.SupportProfiles.ToListAsync(ct))
            .Where(sp => !string.IsNullOrWhiteSpace(sp.RestrictivePracticeDetails))
            .ToList();

        foreach (var sp in legacyProfiles)
        {
            var alreadyBackfilled = await db.RestrictivePractices.IgnoreQueryFilters().AnyAsync(
                rp => rp.ParticipantId == sp.ParticipantId
                      && rp.Type == RestrictivePracticeType.Unclassified
                      && rp.Description == sp.RestrictivePracticeDetails, ct);
            if (alreadyBackfilled) continue;

            var participant = await db.Participants.IgnoreQueryFilters()
                .FirstOrDefaultAsync(p => p.Id == sp.ParticipantId, ct);
            if (participant == null) continue;

            created.Add(new RestrictivePractice
            {
                Id = Guid.NewGuid(),
                TenantId = participant.TenantId,
                ParticipantId = sp.ParticipantId,
                Type = RestrictivePracticeType.Unclassified,
                Description = sp.RestrictivePracticeDetails!,
                IsActive = true,
            });
        }

        var chemicalRestraintMeds = await db.ParticipantMedications.IgnoreQueryFilters()
            .Where(m => m.IsChemicalRestraint)
            .ToListAsync(ct);

        foreach (var m in chemicalRestraintMeds)
        {
            var alreadyBackfilled = await db.RestrictivePractices.IgnoreQueryFilters().AnyAsync(
                rp => rp.RelatedMedicationId == m.Id && rp.Type == RestrictivePracticeType.ChemicalRestraint, ct);
            if (alreadyBackfilled) continue;

            created.Add(new RestrictivePractice
            {
                Id = Guid.NewGuid(),
                TenantId = m.TenantId,
                ParticipantId = m.ParticipantId,
                Type = RestrictivePracticeType.ChemicalRestraint,
                Description = m.Name,
                RelatedMedicationId = m.Id,
                IsActive = true,
            });
        }

        if (created.Count > 0)
        {
            db.RestrictivePractices.AddRange(created);
            await db.SaveChangesAsync(ct);
        }

        return created.Count;
    }
}
