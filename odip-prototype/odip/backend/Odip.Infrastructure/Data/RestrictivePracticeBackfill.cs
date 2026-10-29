using Microsoft.Extensions.Logging;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Services;
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
            var alreadyBackfilled = await db.RestrictivePractices.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(
                rp => rp.ParticipantId == sp.ParticipantId
                      && rp.Type == RestrictivePracticeType.Unclassified
                      && rp.Description == sp.RestrictivePracticeDetails, ct);
            if (alreadyBackfilled) continue;

            var participant = await db.Participants.IgnoreQueryFilters([TenantFilter.Name])
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

        var chemicalRestraintMeds = await db.ParticipantMedications.IgnoreQueryFilters([TenantFilter.Name])
            .Where(m => m.IsChemicalRestraint)
            .ToListAsync(ct);

        foreach (var m in chemicalRestraintMeds)
        {
            var alreadyBackfilled = await db.RestrictivePractices.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(
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

    /// <summary>
    /// M16: brings every chemical-restraint medicine and its register entry in step once, at startup. Creates the missing entry of a ticked,
    /// not-ceased medicine; deactivates the entry of a ceased one; ticks an unticked, not-ceased medicine whose linked entry is active (the
    /// register wins: it is the record that was authorised). It never writes who authorised or when, and leaves unlinked hand-made entries alone.
    /// Idempotent: the second run changes nothing. Returns how many medicines it brought in step. The caller's context is one tenant's.
    /// </summary>
    public static async Task<int> RunRestraintMedicinesAsync(OdipDbContext db, RestraintRegisterSync sync, CancellationToken ct = default)
    {
        var entries = await db.RestrictivePractices.Where(rp => rp.RelatedMedicationId != null).ToListAsync(ct);
        var linkedIds = entries.Select(rp => rp.RelatedMedicationId!.Value).ToList();
        var meds = await db.ParticipantMedications.Include(m => m.Participant)
            .Where(m => m.IsChemicalRestraint || linkedIds.Contains(m.Id))
            .ToListAsync(ct);

        var changed = 0;
        foreach (var m in meds)
        {
            if (m.Participant == null) continue;
            var entry = entries.FirstOrDefault(rp => rp.RelatedMedicationId == m.Id);
            var ceased = m.Status == MedicationStatus.Ceased;

            if (!m.IsChemicalRestraint && !ceased && entry is { IsActive: true })
            {
                if (RestraintRegisterSync.ApplyEntryToMedication(entry, m)) changed++;
            }
            else if ((m.IsChemicalRestraint && !ceased && entry == null) || (ceased && entry is { IsActive: true }))
            {
                await sync.SyncFromMedicationAsync(m, m.Participant, null, ct);
                changed++;
            }
        }

        if (changed > 0) await db.SaveChangesAsync(ct);
        return changed;
    }

    /// <summary>
    /// Runs <see cref="RunRestraintMedicinesAsync"/> one tenant at a time, each in its own context scoped to that tenant, so the entry, the
    /// participant flag and the safety note all carry the right tenant. A tenant that throws is logged (exception type and tenant id only)
    /// and skipped: startup must not fail on it, and the next start tries it again. Returns (medicines changed, tenants that failed).
    /// <paramref name="runTenant"/> exists for tests to inject a failing tenant.
    /// </summary>
    public static async Task<(int Changed, int Failed)> RunRestraintMedicinesForAllTenantsAsync(
        DbContextOptions<OdipDbContext> options, ILogger? logger = null, CancellationToken ct = default,
        Func<OdipDbContext, CancellationToken, Task<int>>? runTenant = null)
    {
        List<Guid> tenants;
        try
        {
            await using var all = new OdipDbContext(options, new ScopedTenantOverride { IsSuperAdmin = true });
            tenants = await all.ParticipantMedications.IgnoreQueryFilters([TenantFilter.Name]).Where(m => m.IsChemicalRestraint).Select(m => m.TenantId)
                .Union(all.RestrictivePractices.IgnoreQueryFilters([TenantFilter.Name]).Where(rp => rp.RelatedMedicationId != null).Select(rp => rp.TenantId))
                .ToListAsync(ct);
        }
        catch (Exception ex)
        {
            // Listing the tenants failed: skip the whole backfill rather than fail startup; the next start tries again.
            logger?.LogWarning("Restraint register backfill could not list tenants: {ExceptionType}", ex.GetType().Name);
            return (0, 0);
        }

        int changed = 0, failed = 0;
        foreach (var tenantId in tenants)
        {
            try
            {
                await using var db = new OdipDbContext(options, new ScopedTenantOverride { TenantId = tenantId }) { AuditActorName = "Restraint register backfill" };
                changed += await (runTenant ?? DefaultRun)(db, ct);
            }
            catch (Exception ex)
            {
                failed++;
                logger?.LogWarning("Restraint register backfill failed for tenant {TenantId}: {ExceptionType}", tenantId, ex.GetType().Name);
            }
        }
        return (changed, failed);

        static Task<int> DefaultRun(OdipDbContext db, CancellationToken ct) =>
            RunRestraintMedicinesAsync(db, new RestraintRegisterSync(db, new SafetyNoteSyncService(db)), ct);
    }
}
