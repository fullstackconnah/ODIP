using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// Staff credentials (decision D1, plan 2.2). Every Demo user's credential dates were NULL, so every roster check on any worker fired
/// WSC_MISSING and the Qualifications screen showed every flagged credential as an issue. This fills the ten existing staff the plan names
/// ONCE (review decision M1): a person is filled only while EVERY column the plan covers for them is NULL, and then all of those columns
/// are filled together (a flagged one only if its flag is ticked), with offsets in days from the date of that fill. From then on the person
/// is left alone, so a date an owner edits is never overwritten and a credential a presenter clears, to show a missing-credential finding,
/// stays cleared: the columns are never refilled one by one, and the dates never move afterwards. Healthy staff get dates one to two years
/// out so the demo does not rot soon; the near ones age into "expired" on purpose (that is the story). A flag that is not ticked gets no
/// date. Identity, email, role and flags are never touched (the guard refuses it).
///
/// Jade has no worker screening planned (the WSC_MISSING story: her screening stays empty on purpose), so the columns that decide whether
/// she is untouched are her other four; a screening somebody gives her does not count as started. The edge of "all NULL": no marker is
/// kept, so a person whose every covered column is cleared at once looks untouched and is filled again on the next tick. To keep a gap
/// in a person's credentials, leave one covered column of theirs set. The runbook must say this and not "empty columns are refilled".
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

            // Filled once: a person who already has any column the plan covers (filled by an earlier tick, or typed or kept by an owner)
            // is left exactly as they are, so a credential cleared on purpose stays cleared.
            if (!IsUntouched(plan, user)) continue;

            var before = filled;
            if (plan.Screening is { } screening)
            {
                user.WorkerScreeningNumber = screeningNumber;
                user.WorkerScreeningExpiryDate = Date(run, screening);
                filled += 2;
            }
            if (plan.FirstAid is { } firstAid && user.IsFirstAidQualified)
            {
                user.FirstAidExpiryDate = Date(run, firstAid);
                filled++;
            }
            if (plan.Driver is { } driver && user.IsDriverEligible)
            {
                user.DriverLicenceExpiryDate = Date(run, driver);
                filled++;
            }
            if (plan.ManualHandling is { } manualHandling && user.IsManualHandlingCompetent)
            {
                user.ManualHandlingExpiryDate = Date(run, manualHandling);
                filled++;
            }
            if (plan.Medication is { } medication && user.IsMedicationCompetent)
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

    /// <summary>
    /// True while every column the plan covers for this person is NULL. A column counts whether or not its flag is ticked (a date typed under
    /// an un-ticked flag is somebody's), and a column the plan does not cover (Jade's screening) never counts.
    /// </summary>
    private static bool IsUntouched(Plan plan, User user) =>
        (plan.Screening is null || (user.WorkerScreeningNumber is null && user.WorkerScreeningExpiryDate is null))
        && (plan.FirstAid is null || user.FirstAidExpiryDate is null)
        && (plan.Driver is null || user.DriverLicenceExpiryDate is null)
        && (plan.ManualHandling is null || user.ManualHandlingExpiryDate is null)
        && (plan.Medication is null || user.MedicationCompetencyExpiryDate is null);

    /// <summary>Credential dates are calendar dates in the provider's own calendar: offset from provider-local today, never the UTC date.</summary>
    private static DateOnly Date(DemoRun run, int offsetDays) => run.Anchors.D0.AddDays(offsetDays);
}
