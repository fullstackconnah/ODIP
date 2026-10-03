using Odip.Domain.Enums;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// One of the twelve incidents the demo starts with (plan 2.5): who it is about and who reported it, what kind and how serious, where it stands
/// at the first run (<see cref="Status"/> and <see cref="Qsc"/> are the end of its script, <see cref="IncidentTimeline"/>: it is filed Submitted,
/// or Draft, and the changes that take it there are made one at a time), and when it was reported, counted back from the day of the first run
/// (<see cref="DaysBefore"/>, at <see cref="ReportedAt"/> on the provider's clock) or, for the two the plan dates by the hour, from the moment of
/// the first tick (<see cref="HoursBefore"/>). The id is a function of <see cref="Key"/> alone, so each is made once, whatever it has become.
/// </summary>
public sealed record IncidentStory(
    string Key, string? Participant, string Reporter, IncidentType Type, IncidentSeverity Severity, IncidentStatus Status, QscReportingStatus Qsc,
    string Title, string Description, string Location, int DaysBefore, TimeOnly ReportedAt, int? HoursBefore = null,
    ServiceStreams Service = ServiceStreams.CommunityAccessDailyLiving, bool Trip = false);

/// <summary>
/// The incidents of the demo's first day, and the wording of the ones that follow (plan 2.5). Coverage: all six statuses, all five reporting states,
/// ten of the eleven types (death is left out on purpose) and all four severities; eight are open and one has been waiting more than a day for its
/// report to the Commission. The rolling ones (<see cref="Rolling"/>) are minor and never need a report, so the tiles stay credible.
/// </summary>
public static class IncidentCatalog
{
    public static Guid IdOf(string key) => DemoIds.For("incident", key);

    private static TimeOnly T(int hour, int minute) => new(hour, minute);

    /// <summary>The shift note the first day's slip is filed from: the scanner reads it as Falls and Injury (plan 2.1, I-09).</summary>
    public const string SlipNote = LiveSetCatalog.InjuryNote;

    /// <summary>The flagged note nobody has filed an incident from yet: the follow-up task stays open and shows in the queue.</summary>
    public const string OpenNote =
        "Noticed a bruise on Charlotte's upper arm while she was getting changed for dinner. She could not say how it happened. Told the next worker and took a photo.";

    // I-09 (the slip) and the open note are written beside a live shift by the pack itself, so they are not in this list.
    public static readonly IReadOnlyList<IncidentStory> Static = new[]
    {
        new IncidentStory("I-01", "ethan", "brendan", IncidentType.Injury, IncidentSeverity.Medium, IncidentStatus.UnderReview, QscReportingStatus.NotRequired,
            "Ethan fell on the beach boardwalk during the respite trip",
            "Ethan was walking back from the water on the boardwalk when his foot caught a raised board and he fell onto his right knee and left hand. A lifeguard nearby helped Ethan up. "
            + "The knee was grazed and the left wrist was sore. Staff cleaned and covered the graze, applied an ice pack to the wrist and checked movement, which was normal.",
            "Beach boardwalk, respite trip", 0, T(9, 10), Service: ServiceStreams.Trip, Trip: true),
        new IncidentStory("I-02", "mia", "daniel", IncidentType.MedicationError, IncidentSeverity.High, IncidentStatus.Submitted, QscReportingStatus.NotRequired,
            "Mia given the wrong strength of sertraline",
            "At the morning medication round Mia was given a 100mg sertraline tablet from a pack meant for another person; her prescribed dose is 50mg. The error was noticed when the pack was "
            + "returned to the cupboard. Her GP was phoned and advised watching for drowsiness and nausea today. Mia has been monitored since and has had no ill effects.",
            "Mia's home", 1, T(8, 40), Service: ServiceStreams.InHomeSupport),
        new IncidentStory("I-03", "ryan", "daniel", IncidentType.RestrictivePracticeUse, IncidentSeverity.High, IncidentStatus.Escalated, QscReportingStatus.Required,
            "Unplanned physical restraint used on Ryan",
            "During a period of acute distress Ryan struck out at a support worker and a second worker held his arms for about two minutes until he calmed. Ryan has no approved restrictive "
            + "practice for this and no behaviour support plan covers it. Nobody was hurt. The incident is reportable and the report to the Commission is overdue.",
            "Ryan's home", 0, T(0, 0), HoursBefore: 31, Service: ServiceStreams.BSP),
        new IncidentStory("I-04", "william", "sarah", IncidentType.Abuse, IncidentSeverity.Critical, IncidentStatus.Escalated, QscReportingStatus.Required,
            "Allegation of financial abuse by a former carer",
            "William told his support coordinator that a former carer has been using his bank card without his agreement. William was calm and clear. The coordinator has made a written "
            + "record, secured his card and started the report to the Commission, which has to be made within 24 hours.",
            "Coordinator's office", 0, T(0, 0), HoursBefore: 9),
        new IncidentStory("I-05", "chloe", "emily", IncidentType.MissingPerson, IncidentSeverity.High, IncidentStatus.Resolved, QscReportingStatus.ReportedWithin24h,
            "Chloe left a community access outing unsupervised",
            "Chloe left the shopping centre during an outing while the worker was at a counter. She was found by centre security 25 minutes later at the bus stop and was safe and unharmed. "
            + "Her family and her support coordinator were told straight away and the report was made to the Commission the same afternoon.",
            "Shopping centre", 6, T(13, 30)),
        new IncidentStory("I-06", "charlotte", "marcus", IncidentType.BehaviourOfConcern, IncidentSeverity.Medium, IncidentStatus.Closed, QscReportingStatus.ReportedLate,
            "Aggression towards staff",
            "Charlotte became very upset when her evening routine changed and pushed a support worker's arm away, then threw a cup. Staff followed her behaviour support plan, gave her space "
            + "and her headphones, and she settled within half an hour. No injury. The plan has been reviewed with her team.",
            "Charlotte's home", 12, T(15, 20), Service: ServiceStreams.BSP),
        new IncidentStory("I-07", null, "james", IncidentType.PropertyDamage, IncidentSeverity.Low, IncidentStatus.Draft, QscReportingStatus.NotRequired,
            "Scrape on the minibus door",
            "A long scrape along the lower edge of the sliding door of the minibus, found at the end of the trip. Nobody remembers it happening. Draft only; photos still to be added.",
            "Minibus, car park", 1, T(16, 5), Service: ServiceStreams.Trip, Trip: true),
        new IncidentStory("I-08", "grace", "brendan", IncidentType.Illness, IncidentSeverity.Low, IncidentStatus.Resolved, QscReportingStatus.NotRequired,
            "Gastro illness on last week's trip",
            "Grace had stomach cramps and vomited twice on the second evening of the trip. She rested, drank small sips of water and was well by the next morning. Two other guests at the "
            + "accommodation were unwell too, so it is likely to have come from there.",
            "Trip accommodation", 5, T(18, 10), Service: ServiceStreams.Trip, Trip: true),
        new IncidentStory("I-10", "olivia", "rachel", IncidentType.Neglect, IncidentSeverity.High, IncidentStatus.UnderReview, QscReportingStatus.ReportedWithin24h,
            "Neglect concern raised by Olivia's family",
            "Olivia's sister rang to say Olivia had been left in the same chair for most of a day when she visited. The roster and the shift notes for that day are being checked, and "
            + "the report was made to the Commission within the day.",
            "Olivia's home", 3, T(10, 15), Service: ServiceStreams.InHomeSupport),
        new IncidentStory("I-11", "dylan", "priya", IncidentType.Other, IncidentSeverity.Low, IncidentStatus.Closed, QscReportingStatus.NotRequired,
            "Wheelchair battery failed on an outing",
            "Dylan's wheelchair battery stopped working at the park, half an hour from home. The wheelchair was pushed to the van and Dylan was taken home safely. A new battery was fitted "
            + "the next day by the supplier.",
            "Riverside park", 10, T(14, 25)),
        new IncidentStory("I-12", "harrison", "marcus", IncidentType.Injury, IncidentSeverity.High, IncidentStatus.UnderReview, QscReportingStatus.NotRequired,
            "Harrison fell in the shower",
            "Harrison slipped getting out of the shower and landed on his right hip. He was helped up with the hoist and checked: a bruise was forming, he was in some pain but able to move "
            + "the leg normally. An ambulance was not called. He was watched through the evening and the GP visit has been booked.",
            "Harrison's bathroom", 2, T(20, 40), Service: ServiceStreams.InHomeSupport),
    };

    private static readonly IReadOnlyDictionary<Guid, IncidentStory> StoriesById = Static.ToDictionary(s => IdOf(s.Key));

    /// <summary>The story of one of the twelve (the slip is built beside its shift, so it has none), or null for any other incident.</summary>
    public static IncidentStory? StoryOf(Guid incidentId) => StoriesById.GetValueOrDefault(incidentId);

    /// <summary>
    /// The report to the Commission an incident has after it is filed (plan 2.5): how long after, and the reference the Commission gave. An incident
    /// with one is filed with its reporting Required, as the incident form files these types, so the form's obligation task is raised then and the
    /// report completes it. Whether the report is within the day or late is how long after (24 hours, <c>QscReporting.OverdueHours</c>); the app
    /// decides only what is OVERDUE, not these two labels, which the form lets the coordinator choose. William's (I-04) is the one that is still to
    /// come at the first run: scripted inside its day, eleven hours after the demo starts. A tick holds nothing back except between 00:00 and 05:00
    /// local, so a first run between 13:00 and 14:00 on a night with no clock change makes it at the first tick after 05:00, up to an hour past the
    /// 24-hour mark, and for that hour the overdue list holds his report too (its label stays within 24 hours, as scripted).
    /// </summary>
    public sealed record QscReport(TimeSpan After, string Reference);

    public static readonly IReadOnlyDictionary<string, QscReport> QscReports = new Dictionary<string, QscReport>
    {
        ["I-05"] = new(TimeSpan.FromMinutes(150), "QSC-DEMO-0001"),
        ["I-04"] = new(TimeSpan.FromHours(20), "QSC-DEMO-0002"),
        ["I-06"] = new(TimeSpan.FromHours(30), "QSC-DEMO-0003"),
        ["I-10"] = new(TimeSpan.FromHours(6), "QSC-DEMO-0004"),
    };

    /// <summary>
    /// Who had been told, and how long after the incident was filed (wall-clock times on the incident, as typed into the compliance step). The review
    /// records them, so each is earlier than the review of its incident (a test holds that).
    /// </summary>
    public sealed record Told(int? FamilyMinutes = null, int? CoordinatorMinutes = null);

    public static readonly IReadOnlyDictionary<string, Told> ToldAfter = new Dictionary<string, Told>
    {
        ["I-05"] = new(FamilyMinutes: 35, CoordinatorMinutes: 50),
        ["I-10"] = new(CoordinatorMinutes: 60),
        ["I-12"] = new(FamilyMinutes: 60),
    };

    /// <summary>What happens to a rolling incident (plan 5.2): reviewed the next morning, resolved on the fifth day, closed on the tenth.</summary>
    public static readonly (int Days, TimeOnly At) ReviewAfter = (1, T(9, 30));
    public static readonly (int Days, TimeOnly At) ResolveAfter = (5, T(15, 0));
    public static readonly (int Days, TimeOnly At) CloseAfter = (10, T(11, 0));

    /// <summary>
    /// The same for the twelve, which are at their stated status by the first run (the oldest, I-06, was filed twelve days before it): resolved on the
    /// fourth day after filing and closed on the sixth.
    /// </summary>
    public static readonly (int Days, TimeOnly At) StaticResolveAfter = (4, T(15, 0));
    public static readonly (int Days, TimeOnly At) StaticCloseAfter = (6, T(11, 0));

    /// <summary>A minor incident that follows on a day that has one: the day decides, by its date, which kind, about whom and who reported it.</summary>
    public sealed record RollingStory(
        string Title, string Description, string Location, IncidentType Type, IncidentSeverity Severity, string? OtherType = null, bool Injury = false);

    public static readonly IReadOnlyList<RollingStory> Rolling = new RollingStory[]
    {
        new("Tripped on the kerb outside the chemist", "{n} caught a foot on the kerb and went down on one knee. A grazed knee, cleaned and covered. {n} was a little shaken and had a rest before the walk home.",
            "Outside the chemist", IncidentType.Injury, IncidentSeverity.Low, Injury: true),
        new("Raised voice during a transport delay", "The bus was twenty minutes late and {n} became upset, raised their voice and refused to wait. Staff stayed calm, offered the headphones and a seat, and {n} settled by the time it arrived.",
            "Bus stop", IncidentType.BehaviourOfConcern, IncidentSeverity.Low),
        new("Broken cup in the kitchen", "A cup slipped out of {n}'s hands while drying up and broke on the floor. Nobody was hurt and the pieces were swept up straight away.",
            "{n}'s kitchen", IncidentType.PropertyDamage, IncidentSeverity.Low),
        new("Stomach upset after lunch", "{n} had stomach cramps about an hour after lunch and felt unwell for the afternoon. Drank water, rested, and was feeling better by dinner.",
            "{n}'s home", IncidentType.Illness, IncidentSeverity.Low),
        new("Morning medication given forty minutes late", "The morning medication was given forty minutes after its time because the pack was in another room. Nothing was missed or doubled and no ill effects were seen.",
            "{n}'s home", IncidentType.MedicationError, IncidentSeverity.Medium),
        new("Hearing aid lost on an outing", "{n}'s hearing aid fell out somewhere between the cafe and the car. Staff retraced the walk without finding it. A replacement has been ordered.",
            "Community outing", IncidentType.Other, IncidentSeverity.Low, OtherType: "Lost equipment"),
    };

    public static readonly string[] ReviewNotes =
    {
        "Reviewed with the support team. No wider concerns and nothing further needed.",
        "Talked through with the worker and the participant. Routine reminders given.",
        "Reviewed against the support plan. It was followed and no change is needed.",
    };

    public static readonly string[] CorrectiveActions =
    {
        "Reminder to all staff at the next team meeting.",
        "Plan checked and left as it is. Worker's notes added to the file.",
        "Equipment checked and replaced where worn.",
    };
}
