using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

public enum IncidentStepKind
{
    /// <summary>A coordinator takes the incident on: under review, with the reviewer and the time (and who had been told, as they record it).</summary>
    Review,

    /// <summary>The coordinator escalates it.</summary>
    Escalate,

    /// <summary>The report to the Commission is made: its reporting state, its time and its reference, and the obligation task is completed.</summary>
    Report,

    /// <summary>It is resolved, with the review notes and the corrective actions.</summary>
    Resolve,

    /// <summary>It is closed.</summary>
    Close,
}

/// <summary>One change on an incident's script and the instant it is made.</summary>
public sealed record IncidentStep(IncidentStepKind Kind, DateTime WhenUtc);

/// <summary>
/// When each change happens to an incident filed at an instant (plan 2.5, 5.2): the one place those times are worked out. It is pure, with no clock
/// and no database, so the same incident has the same script at whatever tick it is read, and the pack and its tests read the same rules.
///
/// Time (plan 2.0): "the next morning at 9:30" is a time of day on the provider's clock, on a date counted from the day the incident was filed, and is
/// made an instant with the one conversion allowed, so it is 9:30 there across a daylight-saving change; "an hour and a quarter after filing" is
/// elapsed time and is added to the instant. The steps are returned in the order they happen, each at a different time.
///
///  - A rolling incident (no story): reviewed the next morning, resolved on the fifth day, closed on the tenth (<see cref="IncidentCatalog.ReviewAfter"/>).
///  - One of the twelve, which are at their stated status by the first run: reviewed (an hour after filing when it is going to be escalated, a little
///    over an hour for one filed in the day, the next morning for one filed in the evening), escalated a quarter of an hour later, resolved on the
///    fourth day and closed on the sixth (<see cref="IncidentCatalog.StaticResolveAfter"/>), and reported to the Commission when its story says.
///    An incident that is only filed (Draft, Submitted) has no steps.
/// </summary>
public static class IncidentTimeline
{
    public static readonly TimeSpan ReviewedSoon = TimeSpan.FromMinutes(75);
    public static readonly TimeSpan ReviewedUrgently = TimeSpan.FromHours(1);
    public static readonly TimeSpan EscalatedAfterReview = TimeSpan.FromMinutes(15);

    /// <summary>An incident filed at or after this hour (provider-local) waits for the next morning's review.</summary>
    public const int EveningFromHour = 17;

    public static IReadOnlyList<IncidentStep> For(IncidentStory? story, DateTime createdUtc, TimeZoneInfo zone)
    {
        var created = ProviderLocalTime.AsUtc(createdUtc);
        var filedOn = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(created, zone));
        DateTime At((int Days, TimeOnly At) when) =>
            ProviderLocalTime.LocalToUtc(filedOn.AddDays(when.Days).ToDateTime(when.At, DateTimeKind.Unspecified), zone);

        var steps = new List<IncidentStep>();
        if (story is null)
        {
            steps.Add(new(IncidentStepKind.Review, At(IncidentCatalog.ReviewAfter)));
            steps.Add(new(IncidentStepKind.Resolve, At(IncidentCatalog.ResolveAfter)));
            steps.Add(new(IncidentStepKind.Close, At(IncidentCatalog.CloseAfter)));
            return steps;
        }

        var reviewed = story.Status == IncidentStatus.Escalated ? created + ReviewedUrgently
            : ProviderLocalTime.UtcToLocal(created, zone).Hour < EveningFromHour ? created + ReviewedSoon
            : At(IncidentCatalog.ReviewAfter);

        if (story.Status is IncidentStatus.UnderReview or IncidentStatus.Escalated or IncidentStatus.Resolved or IncidentStatus.Closed)
            steps.Add(new(IncidentStepKind.Review, reviewed));
        if (story.Status == IncidentStatus.Escalated)
            steps.Add(new(IncidentStepKind.Escalate, reviewed + EscalatedAfterReview));
        if (IncidentCatalog.QscReports.TryGetValue(story.Key, out var report))
            steps.Add(new(IncidentStepKind.Report, created + report.After));
        if (story.Status is IncidentStatus.Resolved or IncidentStatus.Closed)
            steps.Add(new(IncidentStepKind.Resolve, At(IncidentCatalog.StaticResolveAfter)));
        if (story.Status == IncidentStatus.Closed)
            steps.Add(new(IncidentStepKind.Close, At(IncidentCatalog.StaticCloseAfter)));

        return steps.OrderBy(s => s.WhenUtc).ToList();
    }

    /// <summary>
    /// Whether a step is still to be made: the incident stands exactly as the script left it before this step (compare-and-set, plan 4.3). The review
    /// is recognised by its own instant, which nobody else would have written, so an incident somebody reviews, resolves or reopens by hand stands
    /// otherwise and the script leaves it alone from then on; an edit that touches none of these fields does not stop it. The escalation follows the
    /// review at once, so it also needs the incident untouched since the review: a coordinator who steps an escalated incident back to under review is
    /// not escalated again. A step that is not pending is either made already or not the script's to make.
    /// </summary>
    public static bool IsPending(IncidentReport incident, IncidentStep step, IReadOnlyList<IncidentStep> script)
    {
        DateTime? WhenOf(IncidentStepKind kind) => script.Where(s => s.Kind == kind).Select(s => (DateTime?)s.WhenUtc).FirstOrDefault();
        return step.Kind switch
        {
            IncidentStepKind.Review => incident.Status == IncidentStatus.Submitted && incident.ReviewedAt is null,
            IncidentStepKind.Escalate => incident.Status == IncidentStatus.UnderReview && incident.ReviewedAt == WhenOf(IncidentStepKind.Review)
                && incident.UpdatedAt == WhenOf(IncidentStepKind.Review),
            IncidentStepKind.Report => incident.QscReportingStatus == QscReportingStatus.Required && incident.QscReportedAt is null,
            IncidentStepKind.Resolve => incident.Status == IncidentStatus.UnderReview && incident.ReviewedAt == WhenOf(IncidentStepKind.Review) && incident.ResolvedAt is null,
            IncidentStepKind.Close => incident.Status == IncidentStatus.Resolved && incident.ResolvedAt == WhenOf(IncidentStepKind.Resolve),
            _ => false,
        };
    }
}
