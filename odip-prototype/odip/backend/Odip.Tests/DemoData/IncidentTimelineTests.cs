using System.Globalization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// When each change happens to an incident (plan 2.5, 5.2), pinned with literal instants in every zone and across both daylight-saving changes
/// (4 Oct 2026, 4 Apr 2027), so the rules are written down apart from the code that makes them. "The next morning at 09:30" is 09:30 on the
/// provider's clock (so 23 or 25 hours later across a change); "an hour and a quarter after filing" is elapsed time.
/// </summary>
public class IncidentTimelineTests
{
    private static DateTime Utc(string s) => DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

    private static IncidentStory Story(string key) => IncidentCatalog.Static.Single(s => s.Key == key);

    private static string Show(IReadOnlyList<IncidentStep> steps) =>
        string.Join(" ", steps.Select(s => $"{s.Kind}@{s.WhenUtc.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture)}Z"));

    // The twelve, on the plan's example day (Fri 2 Oct 2026, AEST +10, before the clocks go forward): filed at the instant, with the script that follows.
    [Theory]
    [InlineData("I-01", "2026-10-01T23:10:00Z", "Review@2026-10-02T00:25Z")]                                                                    // filed Fri 09:10: reviewed 75 minutes later
    [InlineData("I-02", "2026-09-30T22:40:00Z", "")]                                                                                            // Submitted: nothing after filing
    [InlineData("I-03", "2026-10-01T05:35:00Z", "Review@2026-10-01T06:35Z Escalate@2026-10-01T06:50Z")]                                         // filed by the hour: an hour, and a quarter of an hour on
    [InlineData("I-04", "2026-10-01T15:35:00Z", "Review@2026-10-01T16:35Z Escalate@2026-10-01T16:50Z Report@2026-10-02T11:35Z")]                // reported at 20 hours
    [InlineData("I-05", "2026-09-26T03:30:00Z", "Review@2026-09-26T04:45Z Report@2026-09-26T06:00Z Resolve@2026-09-30T05:00Z")]                 // Sat 13:30: report 2.5 hours on, resolved Wed 15:00
    [InlineData("I-06", "2026-09-20T05:20:00Z", "Review@2026-09-20T06:35Z Report@2026-09-21T11:20Z Resolve@2026-09-24T05:00Z Close@2026-09-26T01:00Z")]
    [InlineData("I-07", "2026-10-01T06:05:00Z", "")]                                                                                            // a Draft stays one
    [InlineData("I-08", "2026-09-27T08:10:00Z", "Review@2026-09-27T23:30Z Resolve@2026-10-01T05:00Z")]                                          // Sun 18:10: reviewed the next morning, Mon 09:30
    [InlineData("I-10", "2026-09-29T00:15:00Z", "Review@2026-09-29T01:30Z Report@2026-09-29T06:15Z")]
    [InlineData("I-11", "2026-09-22T04:25:00Z", "Review@2026-09-22T05:40Z Resolve@2026-09-26T05:00Z Close@2026-09-28T01:00Z")]
    [InlineData("I-12", "2026-09-30T10:40:00Z", "Review@2026-09-30T23:30Z")]                                                                    // Wed 20:40: reviewed Thu 09:30
    public void TheScriptOfEachOfTheTwelve_IsAtTheTimesThePlanGives(string key, string filed, string expected)
    {
        Assert.Equal(expected, Show(IncidentTimeline.For(Story(key), Utc(filed), Zone("NSW"))));
    }

    // A rolling incident: reviewed the next morning at 09:30, resolved on the fifth day at 15:00, closed on the tenth at 11:00, all on the provider's clock.
    [Theory]
    [InlineData("NSW", "2026-10-01T23:30:00Z", "Review@2026-10-02T23:30Z Resolve@2026-10-07T04:00Z Close@2026-10-12T00:00Z")]       // filed Fri 2 Oct 09:30 AEST; the later steps are in daylight time (+11)
    [InlineData("QLD", "2026-10-01T23:30:00Z", "Review@2026-10-02T23:30Z Resolve@2026-10-07T05:00Z Close@2026-10-12T01:00Z")]       // no daylight saving: +10 throughout
    [InlineData("SA", "2026-10-02T00:00:00Z", "Review@2026-10-03T00:00Z Resolve@2026-10-07T04:30Z Close@2026-10-12T00:30Z")]        // filed 09:30 ACST (+9:30); resolved at 15:00 ACDT (+10:30)
    [InlineData("NSW", "2026-10-02T23:30:00Z", "Review@2026-10-03T22:30Z Resolve@2026-10-08T04:00Z Close@2026-10-13T00:00Z")]       // filed Sat 3 Oct 09:30: the clocks go forward that night, so the review is 23 hours on
    [InlineData("NSW", "2027-04-02T22:30:00Z", "Review@2027-04-03T23:30Z Resolve@2027-04-08T05:00Z Close@2027-04-13T01:00Z")]       // filed Sat 3 Apr 2027 09:30 AEDT: they go back that night, so the review is 25 hours on
    public void ARollingIncidentsScript_IsOnTheProvidersWallClock_AcrossBothClockChanges(string state, string filed, string expected)
    {
        Assert.Equal(expected, Show(IncidentTimeline.For(null, Utc(filed), Zone(state))));
    }

    [Theory]
    [InlineData("NSW")]
    [InlineData("QLD")]
    [InlineData("SA")]
    public void EveryScript_ForAnyMomentOfFiling_IsInOrder_EachStepAtADifferentTime_AndEndsWhereItsStoryDoes(string state)
    {
        var zone = Zone(state);
        var checkedScripts = 0;
        foreach (var span in new[] { (Utc("2026-09-18T00:00:00Z"), Utc("2026-10-20T00:00:00Z")), (Utc("2027-03-25T00:00:00Z"), Utc("2027-04-14T00:00:00Z")) })
        {
            for (var filed = span.Item1; filed < span.Item2; filed = filed.AddMinutes(53))
            {
                foreach (var story in IncidentCatalog.Static.Cast<IncidentStory?>().Append(null))
                {
                    var steps = IncidentTimeline.For(story, filed, zone);
                    var where = $"{story?.Key ?? "rolling"} filed {filed:u} in {state}: {Show(steps)}";

                    Assert.True(steps.Select(s => s.WhenUtc).SequenceEqual(steps.Select(s => s.WhenUtc).OrderBy(t => t).Distinct()), where + " is out of order or has two steps at once");
                    Assert.All(steps, s => Assert.True(s.WhenUtc > filed, where + " has a step before filing"));
                    Assert.True(steps.Count(s => s.Kind == IncidentStepKind.Review) <= 1, where + " is reviewed twice");

                    // Replay it: the status it ends at is the story's (a rolling one ends Closed, ten days on).
                    var status = story?.Status == IncidentStatus.Draft ? IncidentStatus.Draft : IncidentStatus.Submitted;
                    foreach (var step in steps)
                    {
                        status = step.Kind switch
                        {
                            IncidentStepKind.Review => IncidentStatus.UnderReview,
                            IncidentStepKind.Escalate => IncidentStatus.Escalated,
                            IncidentStepKind.Resolve => IncidentStatus.Resolved,
                            IncidentStepKind.Close => IncidentStatus.Closed,
                            _ => status,
                        };
                    }
                    Assert.True(status == (story?.Status ?? IncidentStatus.Closed), where + $" ends {status}");
                    if (story is not null) Assert.True(steps.Count == 0 || steps[^1].WhenUtc < filed.AddDays(8), where + " takes more than a week");
                    checkedScripts++;
                }
            }
        }
        Assert.True(checkedScripts > 10_000, $"only {checkedScripts} scripts");
    }

    [Fact]
    public void AStepIsPending_OnlyWhileTheIncidentStandsExactlyAsTheScriptLeftIt()
    {
        var filed = Utc("2026-09-20T05:20:00Z");
        var full = IncidentTimeline.For(Story("I-06"), filed, Zone("NSW"));                   // Review, Report, Resolve, Close
        var urgent = IncidentTimeline.For(Story("I-03"), filed, Zone("NSW"));                 // Review, Escalate
        DateTime When(IReadOnlyList<IncidentStep> script, IncidentStepKind kind) => script.Single(s => s.Kind == kind).WhenUtc;
        var byHand = filed.AddHours(3);
        IncidentReport Incident(IncidentStatus status, DateTime? reviewedAt = null, DateTime? resolvedAt = null, QscReportingStatus qsc = QscReportingStatus.Required, DateTime? reportedAt = null, DateTime? updatedAt = null) =>
            new() { Status = status, ReviewedAt = reviewedAt, ResolvedAt = resolvedAt, QscReportingStatus = qsc, QscReportedAt = reportedAt, CreatedAt = filed, UpdatedAt = updatedAt ?? reviewedAt ?? filed };
        bool Pending(IncidentReport incident, IReadOnlyList<IncidentStep> script, IncidentStepKind kind) => IncidentTimeline.IsPending(incident, script.Single(s => s.Kind == kind), script);

        // Just filed: it waits for its review, and its report is owed.
        var fresh = Incident(IncidentStatus.Submitted);
        Assert.Equal(new[] { true, false, false, true }, new[] { IncidentStepKind.Review, IncidentStepKind.Resolve, IncidentStepKind.Close, IncidentStepKind.Report }.Select(k => Pending(fresh, full, k)));

        // Reviewed by the script: its resolution is next (an urgent one is escalated, from its own review).
        var reviewed = Incident(IncidentStatus.UnderReview, reviewedAt: When(full, IncidentStepKind.Review));
        Assert.False(Pending(reviewed, full, IncidentStepKind.Review));
        Assert.True(Pending(reviewed, full, IncidentStepKind.Resolve));
        Assert.False(Pending(reviewed, full, IncidentStepKind.Close));
        Assert.True(Pending(Incident(IncidentStatus.UnderReview, reviewedAt: When(urgent, IncidentStepKind.Review)), urgent, IncidentStepKind.Escalate));
        Assert.False(Pending(Incident(IncidentStatus.Escalated, reviewedAt: When(urgent, IncidentStepKind.Review)), urgent, IncidentStepKind.Escalate));
        Assert.False(Pending(Incident(IncidentStatus.UnderReview, reviewedAt: When(urgent, IncidentStepKind.Review), updatedAt: byHand), urgent, IncidentStepKind.Escalate));      // stepped back by somebody since

        // Reviewed by somebody else (a time the script never wrote): nothing after it is the script's to make.
        var theirs = Incident(IncidentStatus.UnderReview, reviewedAt: byHand);
        Assert.False(Pending(theirs, full, IncidentStepKind.Review));
        Assert.False(Pending(theirs, full, IncidentStepKind.Resolve));
        Assert.False(Pending(theirs, urgent, IncidentStepKind.Escalate));
        Assert.False(Pending(Incident(IncidentStatus.Submitted, reviewedAt: When(full, IncidentStepKind.Review)), full, IncidentStepKind.Review));       // reopened: the review stamp stays

        // Resolved by the script, it is closed next; resolved by somebody else, it is left.
        Assert.True(Pending(Incident(IncidentStatus.Resolved, When(full, IncidentStepKind.Review), When(full, IncidentStepKind.Resolve)), full, IncidentStepKind.Close));
        Assert.False(Pending(Incident(IncidentStatus.Resolved, When(full, IncidentStepKind.Review), byHand), full, IncidentStepKind.Close));
        Assert.False(Pending(Incident(IncidentStatus.Resolved, When(full, IncidentStepKind.Review), When(full, IncidentStepKind.Resolve)), full, IncidentStepKind.Resolve));

        // The report is owed only while the incident is Required and nobody has reported it.
        Assert.False(Pending(Incident(IncidentStatus.Submitted, qsc: QscReportingStatus.ReportedWithin24h, reportedAt: byHand), full, IncidentStepKind.Report));
        Assert.False(Pending(Incident(IncidentStatus.Submitted, qsc: QscReportingStatus.NotRequired), full, IncidentStepKind.Report));
        Assert.False(Pending(Incident(IncidentStatus.Submitted, reportedAt: byHand), full, IncidentStepKind.Report));
    }

    [Fact]
    public void TheCatalogueAgreesWithItself_TheLabelsTheTimingsAndWhoHadBeenTold()
    {
        Assert.Equal(new[] { "I-04", "I-05", "I-06", "I-10" }, IncidentCatalog.QscReports.Keys.OrderBy(k => k, StringComparer.Ordinal));
        Assert.Equal(IncidentCatalog.QscReports.Count, IncidentCatalog.QscReports.Values.Select(r => r.Reference).Distinct().Count());

        foreach (var story in IncidentCatalog.Static)
        {
            var scripted = IncidentCatalog.QscReports.TryGetValue(story.Key, out var report);
            var withinTheDay = scripted && report!.After <= TimeSpan.FromHours(QscReporting.OverdueHours);
            switch (story.Qsc)
            {
                case QscReportingStatus.ReportedWithin24h: Assert.True(withinTheDay, story.Key); break;
                case QscReportingStatus.ReportedLate: Assert.True(scripted && !withinTheDay, story.Key); break;
                case QscReportingStatus.Required: Assert.True(!scripted || story.Key == "I-04", story.Key + ": Required at the first run, so its report (if any) is still to come"); break;
                default: Assert.False(scripted, story.Key + " has a report scripted but is not Required"); break;
            }
        }

        // Who was told is recorded by the review, so each time is before the review of its incident (and the hour-based stories, which have no fixed day, tell nobody).
        var zone = Zone("NSW");
        Assert.All(IncidentCatalog.ToldAfter, entry =>
        {
            var story = Story(entry.Key);
            Assert.Null(story.HoursBefore);
            var filed = ProviderLocalTime.LocalToUtc(At(new DateOnly(2026, 9, 20), story.ReportedAt.Hour, story.ReportedAt.Minute), zone);
            var review = IncidentTimeline.For(story, filed, zone).Single(s => s.Kind == IncidentStepKind.Review).WhenUtc;
            foreach (var minutes in new[] { entry.Value.FamilyMinutes, entry.Value.CoordinatorMinutes }.Where(m => m is not null))
                Assert.True(filed.AddMinutes(minutes!.Value) < review, $"{entry.Key}: told {minutes} minutes after filing, but the review is at {review:u}");
        });
    }
}
