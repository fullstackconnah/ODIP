using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// T6 (plan 6): the app's own rules, applied to every row the top-up wrote, at clocks across the day, a week, both clock changes and three zones:
/// the Shift and ShiftCompletion state machine, the break rules, that every dose is a slot of its medication, and that the reporting label of every
/// incident is the one the rule would have set. A row a validator would reject is a row a presenter could not have made, and one a screen would show
/// in a state it never reaches.
/// </summary>
public class DemoDomainConformanceTests
{
    public static IEnumerable<object[]> Clocks()
    {
        // state, local date, local hour and minute: the worked example, the end of its day, the day the clocks go forward at noon and the morning after,
        // a fortnight later, and the day they go back at noon and the morning after.
        foreach (var state in new[] { "NSW", "QLD", "SA" })
        {
            yield return new object[] { state, "2026-10-02", 10, 35 };
            yield return new object[] { state, "2026-10-02", 22, 55 };
            yield return new object[] { state, "2026-10-04", 12, 0 };
            yield return new object[] { state, "2026-10-05", 10, 30 };
            yield return new object[] { state, "2026-10-16", 10, 30 };
            yield return new object[] { state, "2027-04-04", 12, 0 };
            yield return new object[] { state, "2027-04-05", 10, 30 };
        }
    }

    private static async Task<(DemoTestEnv Env, DateTime NowUtc)> RunAtAsync(string state, string date, int hour, int minute)
    {
        var day = DateOnly.ParseExact(date, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var utc = new DateTimeOffset(ProviderLocalTime.LocalToUtc(At(day, hour, minute), Zone(state)), TimeSpan.Zero);
        // A demo that has been running for a few days before the clock, so there is history as well as today.
        var env = new DemoTestEnv(utc.AddDays(-3));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync(state);
        foreach (var step in new[] { utc.AddDays(-3), utc.AddDays(-2), utc.AddDays(-1), utc }) await RunAsync(env, step);
        return (env, utc.UtcDateTime);
    }

    [Theory]
    [MemberData(nameof(Clocks))]
    public async Task EveryShiftAndCompletion_IsInAStateTheAppCanReach(string state, string date, int hour, int minute)
    {
        var (env, now) = await RunAtAsync(state, date, hour, minute);
        await using var db = env.AdminDb();
        var shifts = await db.Shifts.ToListAsync();
        var completions = await db.ShiftCompletions.ToListAsync();
        var notes = await db.ShiftNotes.ToListAsync();
        var observed = new Dictionary<ShiftStatus, int>();

        foreach (var shift in shifts)
        {
            var mine = completions.Where(c => c.ShiftId == shift.Id).ToList();
            var active = mine.Where(c => c.IsActive).ToList();
            var where = $"{shift.Status} shift {shift.Id} on {shift.ServiceDate}";
            observed[shift.Status] = observed.GetValueOrDefault(shift.Status) + 1;

            switch (shift.Status)
            {
                case ShiftStatus.InProgress:
                    var running = Assert.Single(active);
                    Assert.Null(running.SubmittedAt);
                    Assert.Null(running.ActualEnd);
                    Assert.True(running.StartedAt <= now, $"{where}: started in the future");
                    break;
                case ShiftStatus.PendingReview:
                case ShiftStatus.Completed:
                    var done = Assert.Single(active);
                    Assert.NotNull(done.SubmittedAt);
                    Assert.NotNull(done.ActualEnd);
                    Assert.True(done.SubmittedAt <= now, $"{where}: submitted in the future");
                    Assert.True(string.IsNullOrWhiteSpace(done.HandoverText) ? done.NothingToHandOver : !done.NothingToHandOver,
                        $"{where}: a handover is text or 'nothing to hand over', never both and never neither");
                    // The completion says there is a note exactly when there is one.
                    Assert.Equal(!notes.Any(n => n.ShiftId == shift.Id), done.NothingToNoteConfirmed);
                    if (shift.Status == ShiftStatus.PendingReview)
                    {
                        Assert.Null(done.ReviewOutcome);
                        Assert.Null(done.ReviewedByUserId);
                    }
                    else
                    {
                        Assert.Equal(ReviewOutcome.Approved, done.ReviewOutcome);
                        Assert.NotNull(done.ReviewedByUserId);
                        Assert.True(done.ReviewedAt >= done.SubmittedAt && done.ReviewedAt <= now, $"{where}: reviewed outside its own span");
                    }
                    break;
                default:
                    Assert.True(active.Count == 0, $"{where}: has an active completion");
                    break;
            }
        }

        Assert.True(observed.ContainsKey(ShiftStatus.Published) && observed.ContainsKey(ShiftStatus.PendingReview) && observed.ContainsKey(ShiftStatus.Completed),
            "the clock shows shifts in the future, waiting for review and approved: " + string.Join(", ", observed.Select(o => $"{o.Key}={o.Value}")));
    }

    [Theory]
    [MemberData(nameof(Clocks))]
    public async Task EveryBreak_IsOneTheAppWouldHaveAccepted_AndNetWorkedTimeAddsUp(string state, string date, int hour, int minute)
    {
        var (env, now) = await RunAtAsync(state, date, hour, minute);
        await using var db = env.AdminDb();
        var completions = (await db.ShiftCompletions.Where(c => c.IsActive).ToListAsync()).ToDictionary(c => c.Id);
        var breaks = await db.ShiftBreaks.ToListAsync();

        Assert.NotEmpty(breaks);
        foreach (var brk in breaks)
        {
            var completion = completions[brk.ShiftCompletionId];
            var others = breaks.Where(b => b.ShiftCompletionId == brk.ShiftCompletionId && b.Id != brk.Id).ToList();
            Assert.Equal(ShiftBreakViolation.None, ShiftBreakRules.Validate(brk.StartedAt, brk.EndedAt, completion.ActualStart, now, others));
            if (brk.EndedAt is { } ended && completion.ActualEnd is { } actualEnd) Assert.True(ended <= actualEnd, "a break ends before the shift does");
        }
        foreach (var group in breaks.GroupBy(b => b.ShiftCompletionId))
        {
            var completion = completions[group.Key];
            var (gross, brk, net) = ShiftBreakRules.NetWorked(completion.ActualStart, completion.ActualEnd, now, group);
            Assert.Equal(gross - brk, net);
            Assert.True(brk > 0 && net > 0);
        }
        Assert.True(breaks.Count(b => b.EndedAt is null) <= completions.Values.Count(c => c.SubmittedAt is null), "a running break only on a shift still in progress");
    }

    [Theory]
    [MemberData(nameof(Clocks))]
    public async Task EveryDose_IsASlotOfItsMedication_AndAnAsNeededOneIsWithinItsLimits(string state, string date, int hour, int minute)
    {
        var (env, now) = await RunAtAsync(state, date, hour, minute);
        await using var db = env.AdminDb();
        var meds = await db.ParticipantMedications.ToDictionaryAsync(m => m.Id);
        var records = (await db.MedicationAdministrations.ToListAsync()).Where(a => a.IdempotencyKey is { } key && key.StartsWith("demo-v1:", StringComparison.Ordinal)).ToList();

        Assert.True(records.Count > 80, $"only {records.Count} doses");
        foreach (var record in records)
        {
            var med = meds[record.ParticipantMedicationId];
            Assert.True(record.CreatedAt <= now, "a dose is never written down in the future");
            if (record.ScheduledAt is { } slot)
            {
                Assert.Equal(MedicationType.Regular, med.Type);
                var day = slot.Date;
                Assert.Contains(slot, MedicationSlotCalculator.EnumerateSlots(med, day, day.AddDays(1)));
                if (record.AdministeredAt is { } given) Assert.True(ProviderLocalTime.AsUtc(given) <= now);
            }
            else
            {
                Assert.Equal(MedicationType.Prn, med.Type);
                Assert.False(string.IsNullOrWhiteSpace(record.PrnReason));
            }
        }
        // And nothing is missing: every scheduled dose of an active medication in the last week that fell due more than an hour and a half ago has an
        // active record (the live set's own doses included), whichever clock the demo has been ticked up to.
        var zone = Zone(state);
        var today = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(now, zone));
        var active = (await db.MedicationAdministrations.ToListAsync()).Where(a => a.ScheduledAt != null && a.SupersededByAdministrationId == null).Select(a => (a.ParticipantMedicationId, a.ScheduledAt!.Value)).ToHashSet();
        var gaps = new List<string>();
        foreach (var med in meds.Values.Where(m => m.Type == MedicationType.Regular && m.Status == MedicationStatus.Active))
            foreach (var slot in MedicationSlotCalculator.EnumerateSlots(med, At(today.AddDays(-7), 0, 0), At(today.AddDays(1), 0, 0)))
                if (ProviderLocalTime.LocalToUtc(slot, zone) <= now.AddMinutes(-90) && !active.Contains((med.Id, slot))) gaps.Add($"{med.Name} {slot:MM-dd HH:mm}");
        Assert.True(gaps.Count == 0, "scheduled doses with no record: " + string.Join(", ", gaps.Take(8)));

        foreach (var group in records.Where(r => r.ScheduledAt is null).GroupBy(r => r.ParticipantMedicationId))
        {
            var times = group.Select(r => r.AdministeredAt!.Value).OrderBy(t => t).ToList();
            var med = meds[group.Key];
            for (var i = 1; i < times.Count; i++) Assert.True((times[i] - times[i - 1]).TotalMinutes >= (med.PrnMinIntervalMinutes ?? 0), $"{med.Name}: doses too close");
            foreach (var t in times) Assert.True(times.Count(x => x > t.AddHours(-24) && x <= t) <= (med.PrnMaxDosesPer24h ?? int.MaxValue), $"{med.Name}: over the 24 hour limit");
        }
    }

    [Theory]
    [MemberData(nameof(Clocks))]
    public async Task EveryIncidentsReportingLabel_AgreesWithTheTwentyFourHourRuleAsTheAuthorReadsIt(string state, string date, int hour, int minute)
    {
        // The app has a rule for what is OVERDUE (QscReporting.IsOverdue: Required, not reported, more than 24 hours old) but none that sets ReportedWithin24h or
        // ReportedLate: the form lets the coordinator choose. So the labels are held to the author's reading of the same 24 hours (how long after filing the
        // report was made), which is a statement about the data, not about the app.
        var (env, now) = await RunAtAsync(state, date, hour, minute);
        await using var db = env.AdminDb();
        var users = await db.Users.Where(u => u.TenantId == DemoTestEnv.DemoTenantId).Select(u => u.Id).ToListAsync();
        var incidents = await db.IncidentReports.Where(i => users.Contains(i.ReportedByUserId)).ToListAsync();
        var required = new[] { IncidentType.Abuse, IncidentType.Neglect, IncidentType.Death, IncidentType.RestrictivePracticeUse, IncidentType.MissingPerson };
        var zone = Zone(state);
        // The wall-clock time the Commission was reported to is typed into the form (the wire inventory lists it as a wall-clock value), so it is read back
        // as the instant it denotes before it is compared with an instant (the day the clocks go back has an hour that occurs twice: an hour of slack).
        double HoursAfterFiling(IncidentReport i) => (ProviderLocalTime.LocalToUtc(i.QscReportedAt!.Value, zone) - i.CreatedAt).TotalHours;

        Assert.True(incidents.Count >= 12, $"only {incidents.Count} incidents");
        foreach (var i in incidents)
        {
            var mustReport = i.Severity == IncidentSeverity.Critical || required.Contains(i.IncidentType) || i.IsRestrictivePracticeAuthorised == false;
            var where = $"{i.Title} ({i.QscReportingStatus})";
            if (i.QscReportedAt is { } typed) Assert.True(typed.Kind == DateTimeKind.Unspecified && typed <= ProviderLocalTime.UtcToLocal(now, zone), where + ": the report's time is a wall-clock value that has happened");
            switch (i.QscReportingStatus)
            {
                case QscReportingStatus.NotRequired:
                    Assert.False(mustReport, where + " should need a report");
                    Assert.Null(i.QscReportedAt);
                    break;
                case QscReportingStatus.Required:
                    Assert.True(mustReport, where + " should not need a report");
                    Assert.Null(i.QscReportedAt);
                    Assert.Equal(QscReporting.IsOverdue(i, now), i.CreatedAt < now.AddHours(-24));            // the label and the predicate agree
                    break;
                case QscReportingStatus.ReportedWithin24h:
                    Assert.NotNull(i.QscReportedAt);
                    Assert.InRange(HoursAfterFiling(i), 0, 24);
                    Assert.False(string.IsNullOrWhiteSpace(i.QscReferenceNumber));
                    break;
                case QscReportingStatus.ReportedLate:
                    Assert.NotNull(i.QscReportedAt);
                    Assert.True(HoursAfterFiling(i) > 24, where + " was not late");
                    Assert.False(string.IsNullOrWhiteSpace(i.QscReferenceNumber));
                    break;
                case QscReportingStatus.Pending:
                    Assert.Null(i.QscReportedAt);
                    Assert.False(QscReporting.IsOverdue(i, now.AddDays(365)), "the overdue rule only looks at Required");
                    break;
            }
            Assert.True(i.CreatedAt <= now && (i.ReviewedAt ?? i.CreatedAt) <= now && (i.ResolvedAt ?? i.CreatedAt) <= now, where + " has a time in the future");
            Assert.True(i.CreatedAt <= (i.ReviewedAt ?? i.CreatedAt) && (i.ReviewedAt ?? i.CreatedAt) <= (i.ResolvedAt ?? i.ReviewedAt ?? i.CreatedAt), where + " has its steps out of order");
            if (i.Status is IncidentStatus.Resolved or IncidentStatus.Closed) Assert.NotNull(i.ResolvedAt);
            else Assert.Null(i.ResolvedAt);
        }
        // Exactly the one the plan says is overdue (Ryan's) at each clock this test visits, which are ticks of an ordinary day. Not at every instant: a first run
        // between 13:00 and 14:00 local on a night with no clock change has William's report (scripted at 20 hours) fall due inside the quiet hours, so it is
        // made at the first tick after 05:00, up to an hour past the 24-hour mark, and for that hour the overdue list holds his as well as Ryan's (the label
        // stays ReportedWithin24h, which reads the scripted time). The first run at 14:35 (DemoIncidentsTests) is not affected.
        Assert.Equal(new[] { IncidentCatalog.IdOf("I-03") }, incidents.Where(i => QscReporting.IsOverdue(i, now)).Select(i => i.Id));
    }
}
