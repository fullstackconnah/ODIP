using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>A participant's newest approved revision that ends within <see cref="AgreementEnding.WarningDays"/> days or has ended. <see cref="DaysLeft"/> is below 0 once it has ended; <see cref="RenewalVersion"/> is the renewal waiting after it.</summary>
public sealed record AgreementEndingRow(Guid ParticipantId, Guid DraftId, int Version, DateOnly AgreementEndDate, int DaysLeft, int? RenewalVersion, bool IsOngoing = false);

/// <summary>
/// Agreement PR 2: the one rule for "ending soon" and "ended" (spec Part B, D5), read by the participant alerts and the Agreements ending list.
/// A renewal is a newer revision starting after the approved one's end (D4). While one waits, an agreement still running is not "ending"; one that has ended stays flagged until a successor is approved, because its shifts have stopped.
/// </summary>
public static class AgreementEnding
{
    public const int WarningDays = 60;

    public static async Task<List<AgreementEndingRow>> FindAsync(OdipDbContext db, IReadOnlyCollection<Guid> participantIds, DateOnly today, CancellationToken ct)
    {
        if (participantIds.Count == 0) return new List<AgreementEndingRow>();
        var ids = participantIds.ToList();
        var revisions = await db.ServiceAgreementDrafts.AsNoTracking()
            .Where(d => ids.Contains(d.ParticipantId))
            .Select(d => new { d.ParticipantId, d.Id, d.Version, d.AgreementStartDate, d.AgreementEndDate, d.OriginalAgreementEndDate, d.IsOngoing, Approved = db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == d.Id) })
            .ToListAsync(ct);

        var rows = new List<AgreementEndingRow>();
        foreach (var revisionsOfOne in revisions.GroupBy(r => r.ParticipantId))
        {
            var approved = revisionsOfOne.Where(r => r.Approved).MaxBy(r => r.Version);
            if (approved is null) continue;
            // An agreement ended early was ended on purpose: it is neither ending soon nor ended, so it raises no alert (D15). It is the newest approved revision that decides, not any earlier one.
            if (approved.OriginalAgreementEndDate != null) continue;
            var daysLeft = approved.AgreementEndDate.DayNumber - today.DayNumber;
            if (daysLeft > WarningDays) continue;
            var renewal = revisionsOfOne.Where(r => r.Version > approved.Version && r.AgreementStartDate > approved.AgreementEndDate).MaxBy(r => r.Version);
            if (renewal is not null && daysLeft >= 0) continue;
            rows.Add(new AgreementEndingRow(revisionsOfOne.Key, approved.Id, approved.Version, approved.AgreementEndDate, daysLeft, renewal?.Version, approved.IsOngoing));
        }

        return rows.OrderBy(r => r.AgreementEndDate).ThenBy(r => r.ParticipantId).ToList();
    }

    /// <summary>The words the alert and the Agreements ending list share (the agreement page says the same as a sentence). No full stop, like every other alert message.</summary>
    public static string Describe(AgreementEndingRow row)
    {
        // An Ongoing agreement stores the plan end as its end (OPEN-1): it is the plan that ends, and the next plan is what it waits for.
        var words = row.IsOngoing ? (row.DaysLeft < 0
            ? string.Create(CultureInfo.InvariantCulture, $"NDIS plan ended {row.AgreementEndDate:yyyy-MM-dd}: shifts stop after it. Renew with the new plan")
            : string.Create(CultureInfo.InvariantCulture, $"NDIS plan ends {row.AgreementEndDate:yyyy-MM-dd}: renew with the new plan")) : row.DaysLeft switch
        {
            < 0 => string.Create(CultureInfo.InvariantCulture, $"Agreement ended {row.AgreementEndDate:yyyy-MM-dd}: shifts stop after it"),
            0 => "Agreement ends today",
            1 => "Agreement ends in 1 day",
            _ => string.Create(CultureInfo.InvariantCulture, $"Agreement ends in {row.DaysLeft} days"),
        };
        return row.RenewalVersion is int version ? string.Create(CultureInfo.InvariantCulture, $"{words}. Renewal v{version} is waiting for approval") : words;
    }
}
