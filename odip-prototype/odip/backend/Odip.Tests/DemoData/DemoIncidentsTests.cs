using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The incidents (plan 2.5): twelve the demo starts with, the shift notes two of them hang from, the minor ones that follow, and the way each is
/// aged by the clock. Read back through the app's own rules (the QSC overdue predicate, the participant alert rules, the keyword scanner) and
/// with literal instants for the clock changes.
/// </summary>
public class DemoIncidentsTests
{
    /// <summary>10:35 on the first day: the slip (filed at 10:30) is in, and Sophie's morning is still running.</summary>
    private static readonly DateTimeOffset FirstRun = new(2026, 10, 2, 0, 35, 0, TimeSpan.Zero);

    private static async Task<List<IncidentReport>> IncidentsAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        var demoUsers = await db.Users.Where(u => u.TenantId == DemoTestEnv.DemoTenantId).Select(u => u.Id).ToListAsync();
        return await db.IncidentReports.Where(i => demoUsers.Contains(i.ReportedByUserId)).OrderBy(i => i.CreatedAt).ToListAsync();
    }

    private static IncidentReport Story(List<IncidentReport> all, string key) => all.Single(i => i.Id == IncidentCatalog.IdOf(key));

    // ── the twelve ──

    [Fact]
    public async Task TheTwelve_AreThere_WithThePlansCoverage_AndEightOfThemOpen()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        var twelve = Enumerable.Range(1, 12).Select(n => Story(all, $"I-{n:00}")).ToList();

        Assert.Equal(Enum.GetValues<IncidentStatus>().OrderBy(s => s), twelve.Select(i => i.Status).Distinct().OrderBy(s => s));                       // all six
        Assert.Equal(Enum.GetValues<QscReportingStatus>().OrderBy(s => s), twelve.Select(i => i.QscReportingStatus).Distinct().OrderBy(s => s));        // all five
        Assert.Equal(Enum.GetValues<IncidentSeverity>().OrderBy(s => s), twelve.Select(i => i.Severity).Distinct().OrderBy(s => s));                    // all four
        var types = twelve.Select(i => i.IncidentType).Distinct().ToList();
        Assert.Equal(10, types.Count);
        Assert.DoesNotContain(IncidentType.Death, types);                                                                                                // left out on purpose
        Assert.Equal(8, twelve.Count(i => i.Status is not (IncidentStatus.Resolved or IncidentStatus.Closed)));

        // Who reported and who it was about, as the plan has them.
        (string Key, string Reporter, string? About)[] expected =
        {
            ("I-01", "brendan", "ethan"), ("I-02", "daniel", "mia"), ("I-03", "daniel", "ryan"), ("I-04", "sarah", "william"), ("I-05", "emily", "chloe"), ("I-06", "marcus", "charlotte"),
            ("I-07", "james", null), ("I-08", "brendan", "grace"), ("I-09", "james", "sophie"), ("I-10", "rachel", "olivia"), ("I-11", "priya", "dylan"), ("I-12", "marcus", "harrison"),
        };
        foreach (var (key, reporter, about) in expected)
        {
            var i = Story(all, key);
            Assert.Equal(DemoFixture.StaffId(reporter), i.ReportedByUserId);
            Assert.Equal(about is null ? null : DemoFixture.ParticipantId(about), i.InvolvedParticipantId);
        }
    }

    [Fact]
    public async Task OneIncidentIsOverdueToTheCommission_AndOneIsStillInsideItsDay_AsTheAppsOwnRuleSaysIt()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        var now = env.Clock.GetUtcNow().UtcDateTime;

        var overdue = all.Where(i => QscReporting.IsOverdue(i, now)).ToList();
        var restraint = Assert.Single(overdue);
        Assert.Equal(IncidentCatalog.IdOf("I-03"), restraint.Id);
        Assert.True((now - restraint.CreatedAt).TotalHours is > 30 and < 32);                                            // "now minus 31 hours"
        Assert.Equal(RestrictivePracticeType.PhysicalRestraint, restraint.RestrictivePracticeType);
        Assert.False(restraint.IsRestrictivePracticeAuthorised);
        Assert.False(string.IsNullOrWhiteSpace(restraint.UnapprovedRestrictivePracticeDetails));

        var abuse = Story(all, "I-04");
        Assert.Equal(QscReportingStatus.Required, abuse.QscReportingStatus);
        Assert.Null(abuse.QscReportedAt);
        Assert.InRange((now - abuse.CreatedAt).TotalHours, 8.5, 9.5);                                                    // the timer is running, nine hours in
        Assert.False(QscReporting.IsOverdue(abuse, now));
        Assert.Equal(IncidentSeverity.Critical, abuse.Severity);

        // The participant alerts say so too.
        await using var db = env.AdminDb();
        var alerts = (await new ParticipantAlertsService(db, env.Clock).GetAlertsAsync(null, activeOnly: true)).ToDictionary(a => a.ParticipantId, a => a.Alerts.Select(x => x.Type).ToList());
        Assert.Contains("qsc-report-overdue", alerts[DemoFixture.ParticipantId("ryan")]);
        Assert.Contains("open-serious-incident", alerts[DemoFixture.ParticipantId("william")]);
        Assert.DoesNotContain("qsc-report-overdue", alerts[DemoFixture.ParticipantId("william")]);
    }

    [Fact]
    public async Task EveryReportToTheCommissionThatIsOwed_HasAnOpenHighPriorityTask_DueADayAfter()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        await using var db = env.AdminDb();
        var tasks = await db.BookingTasks.Where(t => t.TaskType == TaskType.IncidentQscReport).ToListAsync();

        var owed = all.Where(i => i.QscReportingStatus == QscReportingStatus.Required && i.QscReportedAt is null).ToList();
        Assert.Equal(2, owed.Count);
        Assert.Equal(owed.Count, tasks.Count);
        foreach (var incident in owed)
        {
            var task = tasks.Single(t => t.SourceKey == $"incident-qsc:{incident.Id}");
            Assert.Equal(TaskItemStatus.NotStarted, task.Status);
            Assert.Equal(TaskPriority.High, task.Priority);
            Assert.Equal($"/incidents/{incident.Id}", task.LinkTo);
            Assert.Equal(incident.Id, task.IncidentReportId);
            Assert.Equal(DateOnly.FromDateTime(incident.CreatedAt.AddHours(QscReporting.OverdueHours)), task.DueDate);                // the form's own rule
            Assert.Equal($"Report incident to the NDIS Commission: {incident.Title}", task.Title);
        }
    }

    [Fact]
    public async Task WilliamsReport_IsMadeAtTwentyHours_ItsTaskClosed_AndItIsNeverOverdue()
    {
        var env = await TickAsync(FirstRun);
        var created = Story(await IncidentsAsync(env), "I-04").CreatedAt;

        await RunAsync(env, new DateTimeOffset(created.AddHours(20).AddMinutes(1), TimeSpan.Zero));
        Assert.Equal(QscReportingStatus.Required, Story(await IncidentsAsync(env), "I-04").QscReportingStatus);            // 20 hours and a minute: not yet (two minutes' grace)

        await RunAsync(env, new DateTimeOffset(created.AddHours(20).AddMinutes(2), TimeSpan.Zero));

        var reported = Story(await IncidentsAsync(env), "I-04");
        Assert.Equal(QscReportingStatus.ReportedWithin24h, reported.QscReportingStatus);
        Assert.Equal(created.AddHours(20), reported.QscReportedAt);
        Assert.Equal("QSC-DEMO-0002", reported.QscReferenceNumber);
        Assert.Equal(IncidentStatus.Escalated, reported.Status);
        await using var db = env.AdminDb();
        var task = await db.BookingTasks.SingleAsync(t => t.SourceKey == $"incident-qsc:{reported.Id}");
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(created.AddHours(20), task.AutoCompletedAt);
        Assert.False(QscReporting.IsOverdue(reported, created.AddDays(30)));
        // And the change is its own audit entry, at that instant, by the person who reported it.
        var audit = await db.AuditLogs.Where(a => a.EntityId == reported.Id && a.Action == AuditAction.Updated).ToListAsync();
        Assert.Contains(audit, a => a.ChangedAt == new DateTimeOffset(created.AddHours(20), TimeSpan.Zero) && a.ChangedByName == "Sarah Mitchell");
    }

    [Fact]
    public async Task Injuries_AndWitnesses_AreThePlansMix_AndAStaffWitnessIsExactlyOneWhoCanApprove()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        await using var db = env.AdminDb();
        var injuries = await db.IncidentInjuries.ToListAsync();
        var witnesses = await db.IncidentWitnesses.ToListAsync();

        Assert.Contains(injuries, i => i.IncidentReportId == IncidentCatalog.IdOf("I-01") && i.Region == BodyRegion.RightKnee && i.InjuryType == InjuryType.Abrasion);
        Assert.Contains(injuries, i => i.IncidentReportId == IncidentCatalog.IdOf("I-01") && i.Region == BodyRegion.LeftWrist && i.InjuryType == InjuryType.SprainOrStrain);
        Assert.Contains(injuries, i => i.IncidentReportId == IncidentCatalog.IdOf("I-09") && i.Region == BodyRegion.LeftElbow);
        Assert.Contains(injuries, i => i.IncidentReportId == IncidentCatalog.IdOf("I-12") && i.Region == BodyRegion.RightHip && i.InjuryType == InjuryType.Bruise);
        Assert.All(all.Where(i => i.IncidentType == IncidentType.Injury), i => Assert.Contains(injuries, x => x.IncidentReportId == i.Id));                // an injury incident has a body map

        var counts = witnesses.GroupBy(w => w.WitnessStatus).ToDictionary(g => g.Key, g => g.Count());
        Assert.Equal(3, counts[WitnessStatus.Pending]);
        Assert.Equal(2, counts[WitnessStatus.Approved]);
        Assert.Equal(1, counts[WitnessStatus.Declined]);
        Assert.Equal(2, counts[WitnessStatus.NotRequired]);
        foreach (var w in witnesses)
        {
            var incident = all.Single(i => i.Id == w.IncidentReportId);
            if (w.WitnessStatus == WitnessStatus.NotRequired)
            {
                Assert.Null(w.WitnessUserId);                                       // an outside person has nothing to approve
                Assert.Null(w.WitnessRequestedAt);
                continue;
            }
            Assert.NotNull(w.WitnessUserId);
            Assert.Equal(incident.CreatedAt, w.WitnessRequestedAt);
            if (w.WitnessStatus == WitnessStatus.Pending) Assert.Null(w.WitnessRespondedAt);
            else
            {
                Assert.True(w.WitnessRespondedAt > w.WitnessRequestedAt);
                Assert.False(string.IsNullOrWhiteSpace(w.StatementText));
            }
        }
        Assert.Contains(witnesses, w => w.IncidentReportId == IncidentCatalog.IdOf("I-01") && w.WitnessUserId == DemoFixture.StaffId("jade") && w.WitnessStatus == WitnessStatus.Pending);   // Jade's portal
    }

    [Theory]
    [InlineData("2026-10-01T23:20:00Z", false)]       // Fri 09:20 AEST: I-01 was filed at 09:10, but its review (75 minutes later) has not happened yet
    [InlineData("2026-10-02T00:26:59Z", false)]       // 10:26:59: the review is at 10:25, and a row is written two minutes after its last time
    [InlineData("2026-10-02T00:27:00Z", true)]
    public async Task AnIncidentWhoseReviewIsStillToCome_IsNotWrittenYet_AndThenItsReviewIsAtAFixedTimeAfterFiling(string utc, bool written)
    {
        var env = await TickAsync(DateTimeOffset.Parse(utc, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal));

        var all = await IncidentsAsync(env);

        Assert.Equal(written, all.Any(i => i.Id == IncidentCatalog.IdOf("I-01")));
        if (!written) return;
        var beach = Story(all, "I-01");
        Assert.Equal(At(Friday, 9, 10), Local(beach.CreatedAt));
        Assert.Equal(beach.CreatedAt.AddMinutes(75), beach.ReviewedAt);                   // the same whenever the first tick was
        Assert.Equal(DemoFixture.StaffId("sarah"), beach.ReviewedByUserId);
    }

    // ── the slip, and the note that is still open ──

    [Fact]
    public async Task TheSlip_IsFiledFromTheFlaggedNoteOnSophiesShift_AndTheFollowUpTaskIsClosedAtTheSameMoment()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        var slip = Story(all, "I-09");
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        var note = morning.Notes.Single(n => n.Id == slip.ShiftNoteId);

        Assert.Equal(morning.Shift.Id, slip.ShiftId);
        Assert.Equal(At(Friday, 9, 41), Local(note.CreatedAt));
        Assert.Equal(ShiftNoteFlagCategory.Falls | ShiftNoteFlagCategory.Injury, note.FlaggedCategories);
        Assert.Equal(morning.Worker.Id, slip.ReportedByUserId);
        Assert.Equal(At(Friday, 10, 30), Local(slip.CreatedAt));
        Assert.Equal((IncidentType.Injury, IncidentSeverity.Medium, IncidentStatus.Submitted, QscReportingStatus.Pending), (slip.IncidentType, slip.Severity, slip.Status, slip.QscReportingStatus));
        await using var db = env.AdminDb();
        var task = await db.BookingTasks.SingleAsync(t => t.SourceKey == $"flagged-note:{note.Id}");
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(slip.CreatedAt, task.AutoCompletedAt);
        Assert.Equal(Friday, task.CompletedDate);
        Assert.Equal(note.Id, task.ShiftNoteId);
    }

    // The note is written at 09:43:00 on the provider's clock (09:41 and two minutes' grace) and the incident at 10:32:00, to the second.
    [Theory]
    [InlineData("NSW", "2026-10-01T23:42:59Z", "2026-10-01T23:43:00Z", "2026-10-02T00:31:59Z", "2026-10-02T00:32:00Z")]      // Fri 2 Oct, AEST +10
    [InlineData("QLD", "2026-10-01T23:42:59Z", "2026-10-01T23:43:00Z", "2026-10-02T00:31:59Z", "2026-10-02T00:32:00Z")]
    [InlineData("SA", "2026-10-02T00:12:59Z", "2026-10-02T00:13:00Z", "2026-10-02T01:01:59Z", "2026-10-02T01:02:00Z")]      // ACST +9:30
    [InlineData("NSW", "2026-10-03T22:42:59Z", "2026-10-03T22:43:00Z", "2026-10-03T23:31:59Z", "2026-10-03T23:32:00Z")]      // Sun 4 Oct, the day the clocks went forward: AEDT +11
    [InlineData("SA", "2026-10-03T23:12:59Z", "2026-10-03T23:13:00Z", "2026-10-04T00:01:59Z", "2026-10-04T00:02:00Z")]      // ACDT +10:30
    [InlineData("NSW", "2027-04-03T23:42:59Z", "2027-04-03T23:43:00Z", "2027-04-04T00:31:59Z", "2027-04-04T00:32:00Z")]      // Sun 4 Apr 2027, the day they went back: AEST +10
    public async Task TheNoteAppearsAtTwoMinutesPastNineFortyOne_AndTheIncidentAtTwoMinutesPastTenThirty_OnTheProvidersClock(string state, string beforeNote, string atNote, string beforeIncident, string atIncident)
    {
        static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal);
        var env = await TickAsync(Utc(beforeNote), state);
        async Task<(bool Note, bool Incident)> StateAsync()
        {
            await using var db = env.AdminDb();
            return (await db.ShiftNotes.AnyAsync(n => n.Body == IncidentCatalog.SlipNote), await db.IncidentReports.AnyAsync(i => i.Id == IncidentCatalog.IdOf("I-09")));
        }
        Assert.Equal((false, false), await StateAsync());

        await RunAsync(env, Utc(atNote));
        Assert.Equal((true, false), await StateAsync());                                    // the note and its open task wait for the incident
        await RunAsync(env, Utc(beforeIncident));
        Assert.Equal((true, false), await StateAsync());
        await RunAsync(env, Utc(atIncident));
        Assert.Equal((true, true), await StateAsync());
    }

    [Fact]
    public async Task AFlaggedNote_NobodyHasFiledAnIncidentFrom_IsInTheQueueWithItsTaskOpen()
    {
        var env = await TickAsync(FirstRun);
        await using var db = env.AdminDb();
        var open = await db.ShiftNotes.SingleAsync(n => n.Body == IncidentCatalog.OpenNote);
        var evening = await RequireDayAsync(env, LiveSetCatalog.Evening, Friday.AddDays(-1));

        Assert.Equal(evening.Shift.Id, open.ShiftId);
        Assert.Equal(ShiftNoteFlagCategory.Injury, open.FlaggedCategories);
        Assert.Equal(At(Friday.AddDays(-1), 18, 30), Local(open.CreatedAt));
        Assert.Null(open.FlagsAcknowledgedAt);
        var task = await db.BookingTasks.SingleAsync(t => t.SourceKey == $"flagged-note:{open.Id}");
        Assert.Equal(TaskItemStatus.NotStarted, task.Status);
        Assert.Equal(Friday, task.DueDate);
        Assert.Equal("/incidents?view=flagged-notes", task.LinkTo);
        Assert.False(await db.IncidentReports.AnyAsync(i => i.ShiftNoteId == open.Id));
    }

    // ── the minor ones, and the age script ──

    [Fact]
    public async Task TheRollingIncidents_AreAboutThreeDaysInTen_MinorAndNeverOwedToTheCommission()
    {
        // Three months of ticks, one every three days: about three days in ten have one (any one tick looks back fifteen days, which holds from none to nine).
        var env = await TickAsync(new DateTimeOffset(2026, 10, 5, 0, 30, 0, TimeSpan.Zero));
        for (var utc = new DateTimeOffset(2026, 10, 8, 0, 30, 0, TimeSpan.Zero); utc <= new DateTimeOffset(2027, 1, 2, 0, 30, 0, TimeSpan.Zero); utc = utc.AddDays(3)) await RunAsync(env, utc);
        var all = await IncidentsAsync(env);
        var days = Enumerable.Range(0, 90).Select(d => new DateOnly(2026, 12, 30).AddDays(-d)).ToList();
        var rolling = all.Where(i => days.Any(day => i.Id == DemoIds.For("incident", "rolling", day))).ToList();

        Assert.InRange(rolling.Count, 15, 35);                                                // about 27 of 90
        Assert.All(rolling, i =>
        {
            Assert.Equal(QscReportingStatus.NotRequired, i.QscReportingStatus);
            Assert.True(i.Severity <= IncidentSeverity.Medium);
            Assert.DoesNotContain(i.IncidentType, new[] { IncidentType.Abuse, IncidentType.Neglect, IncidentType.Death, IncidentType.RestrictivePracticeUse, IncidentType.MissingPerson });
            Assert.False(string.IsNullOrWhiteSpace(i.Description));
            Assert.DoesNotContain("{n}", i.Description, StringComparison.Ordinal);
            Assert.Equal(i.IncidentType == IncidentType.Other, i.OtherTypeSpecify is not null);
            Assert.True(i.IncidentDateTime < Local(i.CreatedAt));                              // it happened before it was reported (a wall-clock reading)
        });
    }

    /// <summary>The status the plan's age script gives an incident filed at a moment: reviewed the next day 09:30, resolved on the fifth day 15:00, closed on the tenth 11:00.</summary>
    private static IncidentStatus ExpectedStatus(IncidentReport incident, DateTime nowUtc, string state)
    {
        var zone = Zone(state);
        var created = DateOnly.FromDateTime(Local(incident.CreatedAt, state));
        DateTime At(int days, int hour, int minute) => ProviderLocalTime.LocalToUtc(DemoLive.At(created.AddDays(days), hour, minute), zone).AddMinutes(2);
        return nowUtc >= At(10, 11, 0) ? IncidentStatus.Closed : nowUtc >= At(5, 15, 0) ? IncidentStatus.Resolved : nowUtc >= At(1, 9, 30) ? IncidentStatus.UnderReview : IncidentStatus.Submitted;
    }

    [Theory]
    [InlineData("NSW")]
    [InlineData("QLD")]
    [InlineData("SA")]
    public async Task EveryRollingIncident_IsExactlyWhereTheAgeScriptSaysItIs_AtEachOfManyClocks_AcrossTheClockChange(string state)
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 9, 24, 0, 0, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync(state);
        var checkedIncidents = 0;

        // Every few hours from the last week of September to the middle of October: the days of the 4 Oct change are inside.
        for (var utc = new DateTimeOffset(2026, 9, 24, 0, 0, 0, TimeSpan.Zero); utc <= new DateTimeOffset(2026, 10, 18, 0, 0, 0, TimeSpan.Zero); utc = utc.AddHours(7))
        {
            await RunAsync(env, utc);
            var rolling = (await IncidentsAsync(env)).Where(i => Enumerable.Range(0, 71).Any(d => i.Id == DemoIds.For("incident", "rolling", DateOnly.FromDateTime(Local(utc.UtcDateTime, state)).AddDays(-d)))).ToList();
            foreach (var incident in rolling)
            {
                Assert.True(ExpectedStatus(incident, utc.UtcDateTime, state) == incident.Status, $"{state} at {utc:u}: incident of {incident.CreatedAt:u} is {incident.Status}");
                checkedIncidents++;
            }
        }
        Assert.True(checkedIncidents > 30, $"only {checkedIncidents} observations");
    }

    [Theory]
    [InlineData("NSW", "2026-10-09T01:00:00Z")]
    [InlineData("QLD", "2026-10-09T01:00:00Z")]
    [InlineData("SA", "2026-10-09T01:00:00Z")]
    public async Task EachStepOfTheAgeScript_IsItsOwnChange_AtTheWallClockTimeInEveryZone_WithItsOwnAuditEntry(string state, string tick)
    {
        var env = await TickAsync(DateTimeOffset.Parse(tick, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal), state);
        var zone = Zone(state);
        var aged = (await IncidentsAsync(env)).Where(i => i.Status == IncidentStatus.Closed && i.ReviewNotes is not null && i.ResolvedAt is not null
                                                         && Enumerable.Range(0, 15).Any(d => i.Id == DemoIds.For("incident", "rolling", Friday.AddDays(7).AddDays(-d)))).ToList();
        Assert.NotEmpty(aged);
        await using var db = env.AdminDb();

        foreach (var incident in aged)
        {
            var created = DateOnly.FromDateTime(Local(incident.CreatedAt, state));
            Assert.Equal(ProviderLocalTime.LocalToUtc(At(created.AddDays(1), 9, 30), zone), incident.ReviewedAt);
            Assert.Equal(ProviderLocalTime.LocalToUtc(At(created.AddDays(5), 15, 0), zone), incident.ResolvedAt);
            var audit = (await db.AuditLogs.Where(a => a.EntityId == incident.Id).ToListAsync()).OrderBy(a => a.ChangedAt).ToList();
            Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated, AuditAction.Updated, AuditAction.Updated }, audit.Select(a => a.Action));       // filed, reviewed, resolved, closed
            Assert.Equal(new DateTimeOffset(incident.CreatedAt, TimeSpan.Zero), audit[0].ChangedAt);
            Assert.Equal(new DateTimeOffset(incident.ReviewedAt!.Value, TimeSpan.Zero), audit[1].ChangedAt);
            Assert.Equal(new DateTimeOffset(incident.ResolvedAt!.Value, TimeSpan.Zero), audit[2].ChangedAt);
            Assert.Equal(new DateTimeOffset(ProviderLocalTime.LocalToUtc(At(created.AddDays(10), 11, 0), zone), TimeSpan.Zero), audit[3].ChangedAt);
            Assert.All(audit.Skip(1), a => Assert.Equal("Sarah Mitchell", a.ChangedByName));
            Assert.Equal(incident.ReportedByUserId, audit[0].ChangedById);
        }
    }

    // ── what it leaves alone ──

    [Fact]
    public async Task ASecondTick_AtTheSameClock_ChangesNothing_AndTheSameRowsComeWhateverTheTicksWere()
    {
        var incremental = new DemoTestEnv(new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(incremental);
        await incremental.SetProviderStateAsync("NSW");
        for (var utc = new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero); utc <= new DateTimeOffset(2026, 10, 2, 12, 55, 0, TimeSpan.Zero); utc = utc.AddMinutes(30))
            await RunAsync(incremental, utc);
        var oneGo = await TickAsync(new DateTimeOffset(2026, 10, 2, 12, 55, 0, TimeSpan.Zero));

        static List<string> Rows(DemoTestEnv env)
        {
            using var db = env.AdminDb();
            var snapshot = DemoSnapshot.Take(db);
            var types = new[] { nameof(IncidentReport), nameof(IncidentInjury), nameof(IncidentWitness) };
            // Left out: the two the plan dates by the hour ("now minus 31 hours", "nine hours in"), which are counted back from the first tick's own moment.
            var hourly = new[] { "I-03", "I-04" }.Select(k => IncidentCatalog.IdOf(k).ToString("D")).ToHashSet();
            bool Hourly(IReadOnlyDictionary<string, string> row) => row.Values.Any(v => hourly.Contains(v) || hourly.Any(h => v.EndsWith(h, StringComparison.Ordinal)));
            return snapshot.Keys.Where(k => (types.Contains(DemoSnapshot.TypeOf(k))
                                            || (DemoSnapshot.TypeOf(k) == nameof(BookingTask) && snapshot.Row(k)!.GetValueOrDefault("SourceKey") is { } s && (s.StartsWith("incident-qsc:", StringComparison.Ordinal) || s.StartsWith("flagged-note:", StringComparison.Ordinal))))
                                            && !Hourly(snapshot.Row(k)!) && !hourly.Contains(k[(k.IndexOf('|') + 1)..]))
                .OrderBy(k => k, StringComparer.Ordinal)
                .Select(k => k + "=" + string.Join(";", snapshot.Row(k)!.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => kv.Key + ":" + kv.Value))).ToList();
        }
        var expected = Rows(oneGo);
        Assert.True(expected.Count > 25, $"only {expected.Count} rows");
        Assert.Equal(expected, Rows(incremental));

        var again = await RunAsync(oneGo, new DateTimeOffset(2026, 10, 2, 12, 55, 0, TimeSpan.Zero));
        Assert.DoesNotContain(again.RowsAdded.Keys, k => k.StartsWith("incidents/", StringComparison.Ordinal));
        Assert.DoesNotContain(again.RowsChanged.Keys, k => k.StartsWith("incidents/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task WithoutTheOldSeedsNotes_NoNoteIsWritten_SoTheSlipAndTheOpenNoteWait_ButTheTwelveAreStillThere()
    {
        var env = new DemoTestEnv(FirstRun);
        await DemoFixture.SeedPeopleAsync(env, oldSeed: false);
        await env.SetProviderStateAsync("NSW");

        var result = await RunAsync(env, FirstRun);

        var all = await IncidentsAsync(env);
        Assert.DoesNotContain(all, i => i.Id == IncidentCatalog.IdOf("I-09"));
        Assert.Equal(11, all.Count(i => Enumerable.Range(1, 12).Any(n => i.Id == IncidentCatalog.IdOf($"I-{n:00}"))));
        Assert.Null(Story(all, "I-02").MedicationAdministrationId);                     // no medication chart, so nothing to link
        Assert.Contains(result.SkippedStories, s => s.Contains("incident I-09's flagged note", StringComparison.Ordinal));
        await using var db = env.AdminDb();
        Assert.Empty(await db.ShiftNotes.ToListAsync());
    }

    [Fact]
    public async Task TheWrongMedicationIncident_IsLinkedToTheWrongMedicationRecord()
    {
        var env = await TickAsync(FirstRun);
        var i02 = Story(await IncidentsAsync(env), "I-02");
        await using var db = env.AdminDb();

        var dose = await db.MedicationAdministrations.SingleAsync(a => a.Id == i02.MedicationAdministrationId);
        Assert.Equal(MedicationAdministrationStatus.WrongMedication, dose.Status);
        Assert.Equal(MedicationCatalog.MiaSertraline, dose.ParticipantMedicationId);
        Assert.Equal(i02.InvolvedParticipantId, dose.ParticipantId);
        Assert.Equal(i02.ReportedByUserId, dose.RecordedByUserId);                        // Daniel gave it and reported it
        Assert.True(dose.CreatedAt < i02.CreatedAt, "the dose was written down before the incident was filed");
    }

    [Fact]
    public async Task EveryIncidentIsTheDemoTenantsAndOnlyAboutItsPeople()
    {
        var env = await TickAsync(FirstRun);
        await using var db = env.AdminDb();
        var users = await db.Users.Where(u => u.TenantId == DemoTestEnv.DemoTenantId).Select(u => u.Id).ToListAsync();
        var people = await db.Participants.Where(p => p.TenantId == DemoTestEnv.DemoTenantId).Select(p => p.Id).ToListAsync();
        var all = await db.IncidentReports.ToListAsync();

        Assert.All(all, i =>
        {
            Assert.Contains(i.ReportedByUserId, users);
            if (i.ReviewedByUserId is { } reviewer) Assert.Contains(reviewer, users);
            if (i.InvolvedParticipantId is { } participant) Assert.Contains(participant, people);
        });
        Assert.All(await db.IncidentWitnesses.Where(w => w.WitnessUserId != null).ToListAsync(), w => Assert.Contains(w.WitnessUserId!.Value, users));
    }
}
