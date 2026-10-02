using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// Staff credentials (decision D1, plan 2.2). Every Demo user's credential dates were NULL, so every roster check on any worker fired
/// WSC_MISSING and the Qualifications screen showed every flagged credential as an issue. This fills only the columns that are NULL, on the
/// ten existing staff the plan names, once: offsets are days from the date of the first fill and the dates never move afterwards. Healthy
/// staff get dates one to two years out so the demo does not rot soon; the near ones age into "expired" on purpose (that is the story).
/// A flag that is not ticked gets no date, and Jade's worker screening stays empty on purpose (the WSC_MISSING story). Identity, email,
/// role and flags are never touched (the guard refuses it).
///
/// Afterwards the Qualifications tile shows 8 credentials on 6 staff: Rachel (manual handling), Brendan (driver licence), Emily (first
/// aid expired), Daniel (screening and medication), Priya (first aid due, medication expired), Lachlan (screening lapses in two days).
/// </summary>
public sealed class StaffCredentialsPack : IDemoPack
{
    public string Name => "staff-credentials";

    /// <summary>Offsets in days from the first-fill date. Null means "leave empty". The screening number is WS-DEMO-000n, in this order.</summary>
    private sealed record Plan(string Key, int? Screening, int? FirstAid, int? Driver, int? ManualHandling, int? Medication);

    private static readonly Plan[] Allocation =
    {
        new("james", 400, 200, 500, 180, 300),
        new("sarah", 250, 90, 400, 120, 365),
        new("marcus", 500, 300, 300, 300, 300),
        new("rachel", 90, 45, 300, 25, 200),
        new("brendan", 180, 120, 4, 200, 200),
        new("jade", null, 150, 350, 150, 250),
        new("emily", 200, -12, 150, 90, null),
        new("daniel", 20, 60, null, null, 10),
        new("priya", 365, 30, null, 100, -5),
        new("lachlan", 2, null, 60, 60, null),
    };

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var emails = Allocation.Select(p => DemoPeople.StaffEmails[p.Key]).ToList();
        var users = (await DemoQueries.UsersByEmail(run.Db, emails).ToListAsync(ct))
            .ToDictionary(u => u.Email, StringComparer.OrdinalIgnoreCase);

        var filled = 0;
        var number = 0;
        foreach (var plan in Allocation)
        {
            var screeningNumber = plan.Screening.HasValue ? $"WS-DEMO-{++number:D4}" : null;
            if (!users.TryGetValue(DemoPeople.StaffEmails[plan.Key], out var user) || !user.IsActive)
            {
                run.Skipped($"credentials for {plan.Key}", "not in the Demo tenant or inactive");
                continue;
            }

            var before = filled;
            if (plan.Screening is { } screening)
            {
                if (user.WorkerScreeningNumber is null) { user.WorkerScreeningNumber = screeningNumber; filled++; }
                if (user.WorkerScreeningExpiryDate is null) { user.WorkerScreeningExpiryDate = Date(run, screening); filled++; }
            }
            if (plan.FirstAid is { } firstAid && user.IsFirstAidQualified && user.FirstAidExpiryDate is null)
            {
                user.FirstAidExpiryDate = Date(run, firstAid);
                filled++;
            }
            if (plan.Driver is { } driver && user.IsDriverEligible && user.DriverLicenceExpiryDate is null)
            {
                user.DriverLicenceExpiryDate = Date(run, driver);
                filled++;
            }
            if (plan.ManualHandling is { } manualHandling && user.IsManualHandlingCompetent && user.ManualHandlingExpiryDate is null)
            {
                user.ManualHandlingExpiryDate = Date(run, manualHandling);
                filled++;
            }
            if (plan.Medication is { } medication && user.IsMedicationCompetent && user.MedicationCompetencyExpiryDate is null)
            {
                user.MedicationCompetencyExpiryDate = Date(run, medication);
                filled++;
            }
            if (filled > before) user.UpdatedAt = run.NowUtc;
        }

        if (filled == 0) return;
        await run.SaveAsync(ct);
        run.Changed("credential columns", filled);
    }

    /// <summary>Credential dates are calendar dates in the provider's own calendar: offset from provider-local today, never the UTC date.</summary>
    private static DateOnly Date(DemoRun run, int offsetDays) => run.Anchors.D0.AddDays(offsetDays);
}
