using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The thirteen weekly shift patterns (plan 3a): nine active, two ended (so the patterns list shows history), one switched off and one that
/// starts next month, with one Sunday-night active-night pattern and one Friday sleepover. Patterns are static: keyed by name only, created
/// once, never changed by the top-up, so an owner who edits a pattern keeps their edit and the shifts generated from it follow it.
/// Their dates are fixed on the row at the first run (active ones from 2026-09-01), so a later tick never moves them.
/// </summary>
public sealed class ShiftPatternsPack : IDemoPack
{
    public string Name => "shift-patterns";

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var expected = new List<ShiftPattern>();
        foreach (var spec in RosterCatalog.Patterns)
        {
            var staff = run.Directory.Staff(spec.Staff);
            var participant = run.Directory.Participant(spec.Participant);
            if (staff is null || participant is null)
            {
                run.Skipped($"pattern {spec.Key}", "staff member or participant missing");
                continue;
            }

            var (from, to, isActive) = RosterCatalog.Window(spec, run.Anchors);
            expected.Add(new ShiftPattern
            {
                Id = RosterCatalog.PatternId(spec.Key),
                TenantId = run.TenantId,
                ParticipantId = participant.Id,
                DefaultUserId = staff.Id,
                DayOfWeek = spec.Day,
                StartTime = spec.Start,
                EndTime = spec.End,
                EndsNextDay = spec.EndsNextDay,
                Ratio = spec.Ratio,
                NightType = spec.Night,
                EffectiveFrom = from,
                EffectiveTo = to,
                IsActive = isActive,
                Notes = spec.Notes,
            });
        }

        var existing = await run.ExistingIdsAsync<ShiftPattern>(expected.Select(p => p.Id), ct);
        var missing = expected.Where(p => !existing.Contains(p.Id)).ToList();
        if (missing.Count == 0) return;

        run.Db.ShiftPatterns.AddRange(missing);
        await run.SaveAsync(ct);
        run.Added("shift patterns", missing.Count);
    }
}
