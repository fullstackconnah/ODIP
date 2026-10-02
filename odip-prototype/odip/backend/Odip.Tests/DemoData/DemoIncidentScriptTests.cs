using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoAudit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The script each incident follows after it is filed (plan 2.5, 4.4, 5.2): every change its own save and so its own audit entry, by the coordinator, at its
/// own time on the provider's clock; the compare-and-set that leaves an incident somebody else has taken on alone; and the wall-clock times the form types.
/// The times are written out by hand as local clock readings, against the plan's example day: Fri 2 Oct 2026, 10:35 AEST (00:35Z), before the clocks go forward.
/// </summary>
public class DemoIncidentScriptTests
{
    private static readonly DateTimeOffset FirstRun = new(2026, 10, 2, 0, 35, 0, TimeSpan.Zero);

    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static async Task<List<IncidentReport>> IncidentsAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        var demoUsers = await db.Users.Where(u => u.TenantId == DemoTestEnv.DemoTenantId).Select(u => u.Id).ToListAsync();
        return await db.IncidentReports.Where(i => demoUsers.Contains(i.ReportedByUserId)).OrderBy(i => i.CreatedAt).ToListAsync();
    }

    private static IncidentReport Story(List<IncidentReport> all, string key) => all.Single(i => i.Id == IncidentCatalog.IdOf(key));

    private static async Task<List<AuditLog>> HistoryAsync(DemoTestEnv env, Guid entityId)
    {
        await using var db = env.AdminDb();
        return (await db.AuditLogs.Where(a => a.EntityId == entityId).ToListAsync()).OrderBy(a => a.ChangedAt).ToList();
    }

    // ── the history of each of the twelve ──

    [Fact]
    public async Task EachOfTheTwelve_HasTheHistoryOfItsScript_EveryChangeItsOwnAuditEntry_ByTheCoordinator_AtItsOwnTimeOnTheProvidersClock()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        await using var db = env.AdminDb();
        var people = (await db.Users.ToListAsync()).ToDictionary(u => u.Id, u => u.FullName);
        static DateOnly Sep(int day) => new(2026, 9, day);
        static DateOnly Oct(int day) => new(2026, 10, day);

        // Filed, then what has happened by 10:35 on Fri 2 Oct: each change and the clock time it was made (William's and Ryan's, filed by the hour, are below).
        var expected = new (string Key, IncidentStatus Status, (string Kind, DateTime Local)[] Steps)[]
        {
            ("I-01", IncidentStatus.UnderReview, new[] { ("Review", At(Oct(2), 10, 25)) }),                                                      // filed 09:10 today: +75 minutes
            ("I-02", IncidentStatus.Submitted, Array.Empty<(string, DateTime)>()),
            ("I-05", IncidentStatus.Resolved, new[] { ("Review", At(Sep(26), 14, 45)), ("Report", At(Sep(26), 16, 0)), ("Resolve", At(Sep(30), 15, 0)) }),
            ("I-06", IncidentStatus.Closed, new[] { ("Review", At(Sep(20), 16, 35)), ("Report", At(Sep(21), 21, 20)), ("Resolve", At(Sep(24), 15, 0)), ("Close", At(Sep(26), 11, 0)) }),
            ("I-07", IncidentStatus.Draft, Array.Empty<(string, DateTime)>()),
            ("I-08", IncidentStatus.Resolved, new[] { ("Review", At(Sep(28), 9, 30)), ("Resolve", At(Oct(1), 15, 0)) }),                         // filed 18:10: reviewed the next morning
            ("I-09", IncidentStatus.Submitted, Array.Empty<(string, DateTime)>()),
            ("I-10", IncidentStatus.UnderReview, new[] { ("Review", At(Sep(29), 11, 30)), ("Report", At(Sep(29), 16, 15)) }),
            ("I-11", IncidentStatus.Closed, new[] { ("Review", At(Sep(22), 15, 40)), ("Resolve", At(Sep(26), 15, 0)), ("Close", At(Sep(28), 11, 0)) }),
            ("I-12", IncidentStatus.UnderReview, new[] { ("Review", At(Oct(1), 9, 30)) }),                                                       // filed 20:40: reviewed the next morning
        };

        foreach (var (key, status, steps) in expected)
        {
            var incident = Story(all, key);
            var history = (await db.AuditLogs.Where(a => a.EntityId == incident.Id).ToListAsync()).OrderBy(a => a.ChangedAt).ToList();
            Assert.True(status == incident.Status, $"{key} is {incident.Status}, expected {status}");
            Assert.True(history.Count == 1 + steps.Length, $"{key} has {history.Count} audit entries, expected {1 + steps.Length}: " + string.Join(", ", history.Select(h => $"{h.Action}@{h.ChangedAt:u}")));

            Assert.Equal(AuditAction.Created, history[0].Action);
            Assert.Equal(new DateTimeOffset(incident.CreatedAt, TimeSpan.Zero), history[0].ChangedAt);
            Assert.Equal(people[incident.ReportedByUserId], history[0].ChangedByName);
            for (var n = 0; n < steps.Length; n++)
            {
                var (kind, local) = steps[n];
                var entry = history[n + 1];
                var at = new DateTimeOffset(ProviderLocalTime.LocalToUtc(local, Zone()), TimeSpan.Zero);
                Assert.True(entry.Action == AuditAction.Updated && entry.ChangedAt == at, $"{key} {kind}: {entry.Action} at {entry.ChangedAt:u}, expected {at:u} ({local:yyyy-MM-dd HH:mm} local)");
                Assert.Equal("Sarah Mitchell", entry.ChangedByName);
                Assert.Equal(DemoFixture.StaffId("sarah"), entry.ChangedById);

                // And what the change says.
                switch (kind)
                {
                    case "Review":
                        Assert.True(Says(entry, "Status", "Submitted", "UnderReview") && Mentions(entry, "ReviewedByUserId") && Mentions(entry, "ReviewedAt"), $"{key} review: {entry.Changes}");
                        break;
                    case "Report":
                        Assert.True(Says(entry, "QscReportingStatus", "Required", incident.QscReportingStatus.ToString()) && Mentions(entry, "QscReportedAt") && Mentions(entry, "QscReferenceNumber"), $"{key} report: {entry.Changes}");
                        break;
                    case "Resolve":
                        Assert.True(Says(entry, "Status", "UnderReview", "Resolved") && Mentions(entry, "ResolvedAt") && Mentions(entry, "ReviewNotes") && Mentions(entry, "CorrectiveActions"), $"{key} resolve: {entry.Changes}");
                        break;
                    default:
                        Assert.True(Says(entry, "Status", "Resolved", "Closed"), $"{key} close: {entry.Changes}");
                        break;
                }
            }
        }
    }

    // Plan T4: "the audit history of I-03 shows Created plus at least 2 Updated entries with actors."
    [Fact]
    public async Task TheAuditHistoryOfRyansRestraint_IsFilingAndTwoChanges_EachByAPerson_AndWilliamsIsTheSame()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);

        foreach (var (key, reporter) in new[] { ("I-03", "Daniel Williams"), ("I-04", "Sarah Mitchell") })
        {
            var incident = Story(all, key);
            var history = await HistoryAsync(env, incident.Id);

            Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated, AuditAction.Updated }, history.Select(h => h.Action));
            Assert.All(history, h => Assert.NotNull(h.ChangedById));                                                                       // every entry has an actor
            Assert.Equal(new[] { reporter, "Sarah Mitchell", "Sarah Mitchell" }, history.Select(h => h.ChangedByName));
            Assert.Equal(new[] { 0, 60, 75 }.Select(m => new DateTimeOffset(incident.CreatedAt.AddMinutes(m), TimeSpan.Zero)), history.Select(h => h.ChangedAt));
            Assert.True(Says(history[0], "Status", null, "Submitted") && Says(history[0], "QscReportingStatus", null, "Required"), history[0].Changes);
            Assert.True(Says(history[1], "Status", "Submitted", "UnderReview") && Mentions(history[1], "ReviewedByUserId"), history[1].Changes);
            Assert.True(Says(history[2], "Status", "UnderReview", "Escalated"), history[2].Changes);
            Assert.Equal(IncidentStatus.Escalated, incident.Status);
            Assert.Equal(incident.CreatedAt.AddMinutes(75), incident.UpdatedAt);
        }
    }

    [Fact]
    public async Task TheFilingEntry_SaysOnlyWhatTheFormFiled_NeverWhatHappenedAfterwards()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        string[] after = { "ReviewedByUserId", "ReviewedAt", "ReviewNotes", "CorrectiveActions", "ResolvedAt", "QscReportedAt", "QscReferenceNumber", "FamilyNotifiedAt", "SupportCoordinatorNotifiedAt" };

        async Task CheckAsync(string key, string status, string reporting)
        {
            var filing = (await HistoryAsync(env, Story(all, key).Id)).First();
            Assert.Equal(AuditAction.Created, filing.Action);
            Assert.True(Says(filing, "Status", null, status), $"{key}: {filing.Changes}");
            Assert.True(Says(filing, "QscReportingStatus", null, reporting), $"{key}: {filing.Changes}");
            Assert.True(Says(filing, "FamilyNotified", null, "False") && Says(filing, "SupportCoordinatorNotified", null, "False"), $"{key}: {filing.Changes}");
            Assert.All(after, field => Assert.False(Mentions(filing, field), $"{key}'s filing entry mentions {field}: {filing.Changes}"));
        }

        foreach (var story in IncidentCatalog.Static)
        {
            // Filed Submitted (the draft stays a draft), with its reporting Required where a report to the Commission is to follow, as the form files these types.
            var reporting = IncidentCatalog.QscReports.ContainsKey(story.Key) || story.Qsc == QscReportingStatus.Required ? "Required" : story.Qsc.ToString();
            await CheckAsync(story.Key, story.Status == IncidentStatus.Draft ? "Draft" : "Submitted", reporting);
        }
        await CheckAsync("I-09", "Submitted", "Pending");                                         // the slip is built beside its shift, not from the list
    }

    // ── who had been told ──

    [Fact]
    public async Task WhoHadBeenToldIsRecordedByTheReview_AsTheWallClockTimesTheyWereTold_AndEachIsBeforeThatReview()
    {
        var env = await TickAsync(FirstRun);
        var all = await IncidentsAsync(env);
        static DateOnly Sep(int day) => new(2026, 9, day);

        // Key, when the family were told, when the support coordinator was (wall-clock times, written out by hand).
        var told = new (string Key, DateTime? Family, DateTime? Coordinator)[]
        {
            ("I-05", At(Sep(26), 14, 5), At(Sep(26), 14, 20)),         // filed 13:30: +35 and +50 minutes
            ("I-10", null, At(Sep(29), 11, 15)),                       // filed 10:15: +1 hour
            ("I-12", At(Sep(30), 21, 40), null),                       // filed 20:40: +1 hour
        };
        foreach (var (key, family, coordinator) in told)
        {
            var incident = Story(all, key);
            Assert.Equal(family is not null, incident.FamilyNotified);
            Assert.Equal(family, incident.FamilyNotifiedAt);
            Assert.Equal(coordinator is not null, incident.SupportCoordinatorNotified);
            Assert.Equal(coordinator, incident.SupportCoordinatorNotifiedAt);
            Assert.All(new[] { incident.FamilyNotifiedAt, incident.SupportCoordinatorNotifiedAt }.Where(t => t is not null), t =>
            {
                Assert.Equal(DateTimeKind.Unspecified, t!.Value.Kind);
                Assert.True(t.Value <= Local(incident.ReviewedAt, "NSW"), $"{key}: told at {t:u}, after its review");
            });

            // The first change after filing is the review, and it is the one that records them.
            var review = (await HistoryAsync(env, incident.Id))[1];
            Assert.True(Says(review, "Status", "Submitted", "UnderReview"));
            Assert.Equal(family is not null, Mentions(review, "FamilyNotifiedAt"));
            Assert.Equal(coordinator is not null, Mentions(review, "SupportCoordinatorNotifiedAt"));
        }

        foreach (var key in new[] { "I-01", "I-02", "I-03", "I-04", "I-06", "I-07", "I-08", "I-09", "I-11" })
        {
            var incident = Story(all, key);
            Assert.False(incident.FamilyNotified || incident.SupportCoordinatorNotified, key);
            Assert.Null(incident.FamilyNotifiedAt);
            Assert.Null(incident.SupportCoordinatorNotifiedAt);
        }
    }

    // ── the report to the Commission is typed as the wall clock of the moment it was made ──

    [Theory]
    [InlineData("NSW", "2026-10-14T23:35:00Z", "2026-10-04T22:20:00")]       // 15 Oct 10:35 AEDT: filed Sat 3 Oct 15:20 AEST, +30 hours of elapsed time is Sun 4 Oct 22:20 AEDT, as the clocks went forward on the night
    [InlineData("SA", "2026-10-14T23:35:00Z", "2026-10-04T22:20:00")]        // ACST to ACDT on the same night
    [InlineData("QLD", "2026-10-14T23:35:00Z", "2026-10-04T21:20:00")]       // Queensland keeps one clock all year: 30 hours later is 21:20
    public async Task AReportThirtyHoursAfterFiling_IsTheWallClockOfThatMomentOnTheProvidersClock_AcrossTheNightTheClocksWentForward(string state, string tick, string typed)
    {
        var env = await TickAsync(Utc(tick), state);
        var late = Story(await IncidentsAsync(env), "I-06");

        Assert.Equal(At(new DateOnly(2026, 10, 3), 15, 20), Local(late.CreatedAt, state));                               // filed twelve days before the first run
        Assert.Equal(DateTime.Parse(typed, CultureInfo.InvariantCulture), late.QscReportedAt);
        Assert.Equal(DateTimeKind.Unspecified, late.QscReportedAt!.Value.Kind);
        Assert.Equal(late.CreatedAt.AddHours(30), ProviderLocalTime.LocalToUtc(late.QscReportedAt.Value, Zone(state)));   // thirty hours of elapsed time whatever the wall clock did
        Assert.Equal(QscReportingStatus.ReportedLate, late.QscReportingStatus);
    }

    [Theory]
    [InlineData("NSW", "2026-10-04T08:00:00")]       // William's incident is filed at 01:00Z (nine hours before the first tick), so his report at +20 hours is 21:00Z: Sun 4 Oct 08:00 AEDT
    [InlineData("SA", "2026-10-04T07:30:00")]        // 07:30 ACDT
    [InlineData("QLD", "2026-10-04T07:00:00")]       // 07:00 AEST
    public async Task WilliamsReportAtTwentyHours_IsTheWallClockOfThatMoment_WhenTheClocksGoForwardInBetween(string state, string typed)
    {
        var env = await TickAsync(Utc("2026-10-03T10:00:00Z"), state);
        var created = Story(await IncidentsAsync(env), "I-04").CreatedAt;
        Assert.Equal(Utc("2026-10-03T01:00:00Z").UtcDateTime, created);

        await RunAsync(env, new DateTimeOffset(created.AddHours(20).AddMinutes(2), TimeSpan.Zero));

        var reported = Story(await IncidentsAsync(env), "I-04");
        Assert.Equal(QscReportingStatus.ReportedWithin24h, reported.QscReportingStatus);
        Assert.Equal(DateTime.Parse(typed, CultureInfo.InvariantCulture), reported.QscReportedAt);
        Assert.Equal(created.AddHours(20), ProviderLocalTime.LocalToUtc(reported.QscReportedAt!.Value, Zone(state)));
        Assert.Equal(new[] { AuditAction.Created, AuditAction.Updated, AuditAction.Updated, AuditAction.Updated }, (await HistoryAsync(env, reported.Id)).Select(h => h.Action));
    }

    [Fact]
    public async Task WithoutTheCoordinator_TheIncidentsAreStillFiled_ButNoneIsMovedOn_AndTheTickSaysSo()
    {
        var env = new DemoTestEnv(FirstRun);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        await using (var db = env.AdminDb())
        {
            db.Users.Remove(await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("sarah")));
            await db.SaveChangesAsync();
        }

        var result = await RunAsync(env, FirstRun);

        var twelve = (await IncidentsAsync(env)).Where(i => IncidentCatalog.StoryOf(i.Id) is not null).ToList();
        Assert.True(twelve.Count >= 9, $"only {twelve.Count} of the twelve were filed");
        Assert.All(twelve, i =>
        {
            Assert.Contains(i.Status, new[] { IncidentStatus.Submitted, IncidentStatus.Draft });
            Assert.Null(i.ReviewedAt);
            Assert.Null(i.ResolvedAt);
        });
        Assert.Contains(result.SkippedStories, s => s.Contains("incident script", StringComparison.Ordinal));
    }

    // ── an incident somebody else has taken on is left alone ──

    private static async Task EditAsync(DemoTestEnv env, string key, Action<IncidentReport> edit)
    {
        await using var db = env.AdminDb();
        var incident = await db.IncidentReports.SingleAsync(i => i.Id == IncidentCatalog.IdOf(key));
        edit(incident);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task AnIncidentSomebodyReviewedByHand_IsNotReviewedAgainByTheScript_OrMovedOnFromThere()
    {
        var env = await TickAsync(Utc("2026-10-02T00:00:00Z"));                                  // 10:00: I-01 is filed (09:10) and its review is at 10:25
        var byHand = new DateTime(2026, 10, 2, 0, 5, 0, DateTimeKind.Utc);                        // 10:05
        await EditAsync(env, "I-01", i =>
        {
            i.Status = IncidentStatus.UnderReview;
            i.ReviewedByUserId = DemoFixture.StaffId("rachel");
            i.ReviewedAt = i.UpdatedAt = byHand;
        });

        await RunAsync(env, Utc("2026-10-02T05:00:00Z"));                                         // 15:00, long after the script's review
        await RunAsync(env, Utc("2026-10-09T05:00:00Z"));                                         // and a week on: its resolution would be long past too

        var kept = Story(await IncidentsAsync(env), "I-01");
        Assert.Equal(IncidentStatus.UnderReview, kept.Status);
        Assert.Equal(DemoFixture.StaffId("rachel"), kept.ReviewedByUserId);
        Assert.Equal(byHand, kept.ReviewedAt);
        Assert.Equal(byHand, kept.UpdatedAt);
        Assert.Null(kept.ResolvedAt);
        Assert.Empty((await HistoryAsync(env, kept.Id)).Where(h => h.Action == AuditAction.Updated && h.ChangedByName == "Sarah Mitchell"));
    }

    [Fact]
    public async Task AnIncidentSomebodyReopens_IsNotReviewedAgain()
    {
        var env = await TickAsync(Utc("2026-10-02T00:40:00Z"));                                   // 10:40: the script has reviewed I-01 (10:25)
        var reopened = new DateTime(2026, 10, 2, 0, 50, 0, DateTimeKind.Utc);
        await EditAsync(env, "I-01", i =>
        {
            i.Status = IncidentStatus.Submitted;                                                   // the review stamp stays, as the app leaves it
            i.UpdatedAt = reopened;
        });

        await RunAsync(env, Utc("2026-10-02T05:00:00Z"));

        var kept = Story(await IncidentsAsync(env), "I-01");
        Assert.Equal(IncidentStatus.Submitted, kept.Status);
        Assert.Equal(reopened, kept.UpdatedAt);
        Assert.Single((await HistoryAsync(env, kept.Id)).Where(h => h.Action == AuditAction.Updated && h.ChangedByName == "Sarah Mitchell"));      // the one review, and no second
    }

    [Theory]
    [InlineData("2026-10-02T00:10:00Z", "2026-10-02T00:27:00Z", false)]       // edited 10:10, reviewed at 10:25: the review's stamp is the later
    [InlineData("2026-10-02T00:45:00Z", "2026-10-02T00:50:00Z", true)]        // edited 10:45, before a tick that makes the 10:25 review: the edit's stamp stays (forward only)
    public async Task AnEditThatTouchesNoneOfTheScriptsFields_DoesNotStopTheScript_AndItsStampIsNeverMovedBack(string editedAt, string tick, bool editIsLater)
    {
        var env = await TickAsync(Utc("2026-10-02T00:00:00Z"));                                   // 10:00, before the 10:25 review
        var edited = Utc(editedAt).UtcDateTime;
        await EditAsync(env, "I-01", i =>
        {
            i.Location = "Beach boardwalk, near the surf club";
            i.UpdatedAt = edited;
        });

        await RunAsync(env, Utc(tick));

        var beach = Story(await IncidentsAsync(env), "I-01");
        Assert.Equal(IncidentStatus.UnderReview, beach.Status);
        Assert.Equal(beach.CreatedAt.AddMinutes(75), beach.ReviewedAt);
        Assert.Equal("Beach boardwalk, near the surf club", beach.Location);
        Assert.Equal(editIsLater ? edited : beach.ReviewedAt, beach.UpdatedAt);
        var review = (await HistoryAsync(env, beach.Id)).Single(h => h.ChangedByName == "Sarah Mitchell");
        Assert.Equal(new DateTimeOffset(beach.ReviewedAt!.Value, TimeSpan.Zero), review.ChangedAt);                      // the audit entry says when the review was, whatever the stamp
    }

    [Fact]
    public async Task WilliamsReport_IsStillMadeAfterSomebodyEditsHisIncident_ButNotOnceTheyHaveReportedItThemselves()
    {
        var edited = await TickAsync(FirstRun);
        var created = Story(await IncidentsAsync(edited), "I-04").CreatedAt;
        await EditAsync(edited, "I-04", i =>
        {
            i.Location = "Coordinator's office, front room";
            i.UpdatedAt = created.AddHours(2);
        });
        await RunAsync(edited, new DateTimeOffset(created.AddHours(20).AddMinutes(2), TimeSpan.Zero));
        Assert.Equal(QscReportingStatus.ReportedWithin24h, Story(await IncidentsAsync(edited), "I-04").QscReportingStatus);

        var byHand = await TickAsync(FirstRun);
        await EditAsync(byHand, "I-04", i =>
        {
            i.QscReportingStatus = QscReportingStatus.ReportedWithin24h;
            i.QscReportedAt = new DateTime(2026, 10, 2, 6, 0, 0, DateTimeKind.Unspecified);
            i.QscReferenceNumber = "QSC-BY-HAND";
            i.UpdatedAt = created.AddHours(3);
        });
        await RunAsync(byHand, new DateTimeOffset(created.AddHours(20).AddMinutes(2), TimeSpan.Zero));
        var theirs = Story(await IncidentsAsync(byHand), "I-04");
        Assert.Equal("QSC-BY-HAND", theirs.QscReferenceNumber);
        Assert.Equal(new DateTime(2026, 10, 2, 6, 0, 0, DateTimeKind.Unspecified), theirs.QscReportedAt);
    }

    private static DateOnly FirstRollingDayFrom5October() =>
        Enumerable.Range(0, 20).Select(n => new DateOnly(2026, 10, 5).AddDays(n)).First(d => DemoIds.Pick(DemoIds.For("incident-day", d), "has", 0, 99) < 30);

    [Fact]
    public async Task ARollingIncidentSomebodyReviewedByHand_IsNotResolvedByTheScript()
    {
        var day = FirstRollingDayFrom5October();
        var id = DemoIds.For("incident", "rolling", day);
        var env = await TickAsync(new DateTimeOffset(day.ToDateTime(new TimeOnly(19, 0)), TimeSpan.FromHours(11)));          // the evening it was filed: its review is at 09:30 the next morning
        var byHand = day.ToDateTime(new TimeOnly(21, 0), DateTimeKind.Utc);                                                    // 08:00 the next morning on the provider's clock, before the script's
        await using (var db = env.AdminDb())
        {
            var incident = await db.IncidentReports.SingleAsync(i => i.Id == id);
            Assert.Equal(IncidentStatus.Submitted, incident.Status);
            incident.Status = IncidentStatus.UnderReview;
            incident.ReviewedByUserId = DemoFixture.StaffId("rachel");
            incident.ReviewedAt = incident.UpdatedAt = byHand;
            await db.SaveChangesAsync();
        }
        await RunAsync(env, new DateTimeOffset(day.AddDays(7).ToDateTime(new TimeOnly(12, 0)), TimeSpan.FromHours(11)));        // two days past the script's resolution

        await using var after = env.AdminDb();
        var kept = await after.IncidentReports.SingleAsync(i => i.Id == id);
        Assert.Equal(IncidentStatus.UnderReview, kept.Status);
        Assert.Equal(byHand, kept.ReviewedAt);
        Assert.Null(kept.ResolvedAt);
    }

    [Fact]
    public async Task ARollingIncidentSomebodyResolvedByHand_IsNotClosedByTheScript()
    {
        // The first day with a rolling incident from the 5th of October on, and the morning after it (when the script reviews it).
        var day = FirstRollingDayFrom5October();
        var id = DemoIds.For("incident", "rolling", day);
        var env = await TickAsync(new DateTimeOffset(day.AddDays(1).ToDateTime(new TimeOnly(11, 0)), TimeSpan.FromHours(11)));

        await using (var db = env.AdminDb())
        {
            var reviewed = await db.IncidentReports.SingleAsync(i => i.Id == id);
            Assert.Equal(IncidentStatus.UnderReview, reviewed.Status);                              // the script reviewed it at 09:30
            reviewed.Status = IncidentStatus.Resolved;
            reviewed.ResolvedAt = reviewed.UpdatedAt = day.AddDays(1).ToDateTime(new TimeOnly(1, 0), DateTimeKind.Utc);      // 12:00 on the provider's clock, a time the script never wrote
            await db.SaveChangesAsync();
        }
        await RunAsync(env, new DateTimeOffset(day.AddDays(12).ToDateTime(new TimeOnly(12, 0)), TimeSpan.FromHours(11)));      // two days past the script's closing

        await using var after = env.AdminDb();
        var kept = await after.IncidentReports.SingleAsync(i => i.Id == id);
        Assert.Equal(IncidentStatus.Resolved, kept.Status);
    }
}
