using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The staff-participant compatibility matrix (plan 3a): ten cells, seven Preferred (one of them carrying the AutoLinked marker, the way
/// a cell created from a participant's preferred-staff pick does) and three Excluded, each with a reason a coordinator would write. The
/// Emily/Ryan exclusion is the COMPATIBILITY_EXCLUDED roster story (check 10); the other two exclusions are never rostered together, so they
/// only show in the matrix. Absence of a cell means Allowed.
///
/// A cell the owner already has for a pair (the table is unique on tenant, user and participant) is left exactly as it is, even when it
/// disagrees with the one here: a human's explicit judgement, "Excluded" most of all, is never overwritten.
/// </summary>
public sealed class CompatibilityPack : IDemoPack
{
    public string Name => "compatibility";

    private const string AutoLinkReason = "Auto-linked from the participant's preferred-staff selection.";

    private sealed record Cell(string Staff, string Participant, CompatibilityLevel Level, string Reason, bool AutoLinked = false);

    private static readonly Cell[] Cells =
    {
        new("james", "sophie", CompatibilityLevel.Preferred, "Settled routine: has supported Sophie for two years."),
        new("james", "harrison", CompatibilityLevel.Preferred, "Knows the insulin routine and the signs of a low."),
        new("james", "liam", CompatibilityLevel.Preferred, AutoLinkReason, AutoLinked: true),
        new("marcus", "olivia", CompatibilityLevel.Preferred, "Experienced with hoist transfers."),
        new("daniel", "ethan", CompatibilityLevel.Preferred, "Shared interests; easy rapport."),
        new("priya", "thomas", CompatibilityLevel.Preferred, "Thomas asked for Priya."),
        new("emily", "grace", CompatibilityLevel.Preferred, "Long-standing arrangement that works well."),
        new("emily", "ryan", CompatibilityLevel.Excluded, "Escalation on 12 Sep; see the behaviour support plan before any roster."),
        new("lachlan", "charlotte", CompatibilityLevel.Excluded, "Incident in August; do not roster together until it has been reviewed."),
        new("daniel", "isabella", CompatibilityLevel.Excluded, "Isabella's family asked for a change; review at the next plan meeting."),
    };

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var expected = new List<StaffParticipantCompatibility>();
        foreach (var cell in Cells)
        {
            var staff = run.Directory.Staff(cell.Staff);
            var participant = run.Directory.Participant(cell.Participant);
            if (staff is null || participant is null)
            {
                run.Skipped($"compatibility {cell.Staff}/{cell.Participant}", "staff member or participant missing");
                continue;
            }

            expected.Add(new StaffParticipantCompatibility
            {
                Id = DemoIds.For("compatibility", cell.Staff, cell.Participant),
                TenantId = run.TenantId,
                UserId = staff.Id,
                ParticipantId = participant.Id,
                Level = cell.Level,
                Reason = cell.Reason,
                AutoLinked = cell.AutoLinked,
                UpdatedAt = run.NowUtc,
            });
        }

        // Missing by id AND by the unique natural key (user, participant): the owner's cell for a pair wins.
        var userIds = expected.Select(e => e.UserId).Distinct().ToList();
        var taken = (await run.Db.StaffParticipantCompatibilities
                .Where(c => userIds.Contains(c.UserId))
                .Select(c => new { c.Id, c.UserId, c.ParticipantId })
                .ToListAsync(ct))
            .ToList();
        var takenIds = taken.Select(t => t.Id).ToHashSet();
        var takenPairs = taken.Select(t => (t.UserId, t.ParticipantId)).ToHashSet();

        var missing = expected.Where(e => !takenIds.Contains(e.Id) && !takenPairs.Contains((e.UserId, e.ParticipantId))).ToList();
        if (missing.Count == 0) return;

        run.Db.StaffParticipantCompatibilities.AddRange(missing);
        await run.SaveAsync(ct);
        run.Added("compatibility cells", missing.Count);
    }
}
