using System.Globalization;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Pricing;

// Everything the plan builder's pricing engine reads about one weekly support. Values travel as names in JSON and are persisted nowhere (the
// builder stores blocks in phase C), so the numbers here are free to change; they are still appended, never renumbered, out of habit.

/// <summary>The kind of support a block describes. A sleepover is not a type: a personal-care or short-term-accommodation block that qualifies becomes one (NDIS-CODES 4.1).</summary>
public enum PlanSupportType
{
    /// <summary>Assistance with self-care activities (RG 0107 standard, RG 0104 high intensity).</summary>
    PersonalCare = 0,
    /// <summary>Access Community, Social and Recreational Activities, one-to-one or in a group (RG 0125; RG 0104 high intensity).</summary>
    CommunityAccess = 1,
    /// <summary>A group outing: priced under the provider's group-outing family (RG 0136 by default, RG 0125 when the provider says so).</summary>
    GroupActivity = 2,
    /// <summary>Short-term accommodation support hours (RG 0115), with accommodation nights on the block.</summary>
    StaSupport = 3,
}

/// <summary>Where the support is delivered. A centre adds the Centre Capital Cost item for community and group supports.</summary>
public enum PlanSetting
{
    Community = 0,
    Centre = 1,
    AtHome = 2,
    Accommodation = 3,
}

/// <summary>What to do with an occurrence that falls on a public holiday in the delivery state (NDIS-CODES 11.2 example 5).</summary>
public enum HolidayDecision
{
    /// <summary>Default. Price it at the holiday item and flag it for a person to decide.</summary>
    Review = 0,
    /// <summary>Charge the public holiday rate.</summary>
    Charge = 1,
    /// <summary>The support does not happen on a public holiday: no lines for that occurrence.</summary>
    Skip = 2,
}

/// <summary>The vehicle for activity-based transport: the per-kilometre rate differs (provider settings).</summary>
public enum VehicleKind
{
    Standard = 0,
    Accessible = 1,
}

/// <summary>The delivery location: the state decides the holiday calendar and the time zone, the price zone decides the price column.</summary>
public sealed record PlanLocation
{
    /// <summary>ACT, NSW, NT, QLD, SA, TAS, VIC or WA, in any case.</summary>
    public string State { get; init; } = string.Empty;
    /// <summary>MM1-5 National, MM6 Remote (x1.40), MM7 Very Remote (x1.50): where the support is delivered, not where the participant lives.</summary>
    public PriceZone Zone { get; init; } = PriceZone.National;
    /// <summary>The Modified Monash level 1-7, when known: it sets the provider-travel time cap (MM1-3 30 minutes, MM4-5 60). Without it National is read as MM1-3.</summary>
    public int? Mm { get; init; }
}

/// <summary>From this time (local, after the block starts) the number of participants present is the given number, until the next change or the end of the block.</summary>
public sealed record PlanHeadcountChange
{
    public TimeOnly From { get; init; }
    public int ParticipantsPresent { get; init; } = 1;
}

/// <summary>The part of an overnight block in which the worker may sleep. Without one the whole block is the sleepover window.</summary>
public sealed record PlanSleepoverWindow
{
    public TimeOnly From { get; init; }
    public TimeOnly To { get; init; }
}

/// <summary>Provider travel: the worker's travel to the participant, claimed on the support item (NDIS-CODES 7). Claimed only when <see cref="Claim"/> is set and the provider settings allow it.</summary>
public sealed record PlanProviderTravel
{
    public bool Claim { get; init; }
    /// <summary>Minutes of travel each way. The claimable minutes are capped by zone (30 in MM1-3, 60 in MM4-5, no cap in MM6-7).</summary>
    public int MinutesEachWay { get; init; }
    /// <summary>Also claim the leg from the last participant back to base.</summary>
    public bool ReturnToBase { get; init; }
    /// <summary>The participants one trip serves: the travel time and the cost are divided among them.</summary>
    public int ParticipantsSharing { get; init; } = 1;
    /// <summary>Kilometres each way, claimed at the provider's standard per-kilometre rate on the provider-travel (non-labour) item.</summary>
    public decimal KmEachWay { get; init; }
}

/// <summary>Activity-based transport: the vehicle costs of taking participants on the activity (NDIS-CODES 4.5). The worker's time in the vehicle stays on the support item.</summary>
public sealed record PlanActivityTransport
{
    public decimal Km { get; init; }
    public VehicleKind Vehicle { get; init; } = VehicleKind.Standard;
    /// <summary>Tolls, in dollars, at cost.</summary>
    public decimal Tolls { get; init; }
    /// <summary>Parking, in dollars, at cost.</summary>
    public decimal Parking { get; init; }
    /// <summary>The participants who share the vehicle: the dollar amount is divided among them.</summary>
    public int ParticipantsSharing { get; init; } = 1;
}

/// <summary>Short-term accommodation nights for an occurrence of an STA block (items 01_250 and 01_251).</summary>
public sealed record PlanAccommodation
{
    public int Nights { get; init; }
    /// <summary>A support worker must stay on site, so the support worker accommodation item is claimed too.</summary>
    public bool WorkerOnSite { get; init; }
}

/// <summary>
/// One weekly routine of one support type for one participant, at one place (NDIS-CODES 11.1, weekly routine only). The pricing engine turns it
/// into dated occurrences and then into claim lines. Local times only: the end falls on the next day when it is not after the start, and a
/// block whose start and end are the same time is 24 hours long.
/// </summary>
public sealed record PlanBlock
{
    private const int MinutesPerDay = 1440;

    /// <summary>The most headcount changes a block may have: each one cuts every occurrence into another line, so an unbounded list is an unbounded answer.</summary>
    public const int MaxHeadcountChanges = 10;

    private static readonly string[] States = { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA" };

    /// <summary>The client's own key for the block (unique in a request): lines and totals are attributed to it.</summary>
    public string Id { get; init; } = string.Empty;
    public PlanSupportType SupportType { get; init; }
    public SupportIntensity Intensity { get; init; } = SupportIntensity.Standard;
    public IReadOnlyList<DayOfWeek> Days { get; init; } = Array.Empty<DayOfWeek>();
    public TimeOnly Start { get; init; }
    public TimeOnly End { get; init; }
    /// <summary>Workers delivering the support at the same time (2 for a 2:1 support).</summary>
    public int Workers { get; init; } = 1;
    /// <summary>Participants supported at the same time, this one included (1 for a one-to-one support). Each participant's price is the maximum x workers / participants present, floored to the cent.</summary>
    public int ParticipantsPresent { get; init; } = 1;
    /// <summary>Times at which the number of participants present changes (a late joiner, an early leaver).</summary>
    public IReadOnlyList<PlanHeadcountChange> HeadcountChanges { get; init; } = Array.Empty<PlanHeadcountChange>();
    public PlanSetting Setting { get; init; } = PlanSetting.Community;
    public PlanLocation Location { get; init; } = new();
    /// <summary>The worker may sleep during the block. With an overnight window of 8 hours or more across midnight it makes a sleepover.</summary>
    public bool WorkerMaySleep { get; init; }
    public PlanSleepoverWindow? SleepoverWindow { get; init; }
    /// <summary>Hours of active support the worker is expected to give inside the sleepover. The first two are in the sleepover item; the rest are priced hourly.</summary>
    public decimal SleepoverActiveHours { get; init; }
    public HolidayDecision OnPublicHoliday { get; init; } = HolidayDecision.Review;
    public PlanProviderTravel? Travel { get; init; }
    public PlanActivityTransport? Transport { get; init; }
    public PlanAccommodation? Accommodation { get; init; }

    /// <summary>
    /// An upper bound on the lines one occurrence can produce, for the engine's ceiling on a quote's size: the day bands the occurrence can touch (06:00, 20:00
    /// and midnight cut it) plus two for a part-day holiday's hours, one more for each headcount change, and the sleepover, centre capital, travel, transport and
    /// accommodation lines the block asks for. A plain 09:00 to 13:00 block is 3.
    /// </summary>
    public int MaxLinesPerOccurrence
    {
        get
        {
            var start = (int)(Start.Ticks / TimeSpan.TicksPerMinute);
            var end = start + DurationMinutes;
            var bands = 1;
            for (var day = 0; day <= 1; day++)
                foreach (var minute in new[] { 0, 360, 1200 })
                {
                    var at = day * MinutesPerDay + minute;
                    if (at > start && at < end) bands++;
                }

            var companions = (WorkerMaySleep ? 2 : 0) + (Setting == PlanSetting.Centre ? 1 : 0) + (Travel is { Claim: true } ? 2 : 0)
                + (Transport is not null ? 1 : 0) + (Accommodation is { Nights: > 0 } ? 2 : 0);
            return bands + 2 + (HeadcountChanges?.Count ?? 0) + companions;
        }
    }

    /// <summary>Derived: the end is on the next day when it is not after the start.</summary>
    public bool EndsNextDay => End <= Start;

    /// <summary>The block's length on the wall clock, in minutes (a clock change inside it is accounted for when the engine prices an occurrence).</summary>
    public int DurationMinutes
    {
        get
        {
            var minutes = (int)((End.Ticks - Start.Ticks) / TimeSpan.TicksPerMinute);
            return minutes <= 0 ? minutes + MinutesPerDay : minutes;
        }
    }

    /// <summary>The minutes from the block's start to a clock time on or after it, going into the next day when the time is earlier than the start.</summary>
    public int OffsetFromStart(TimeOnly time) => Mod((int)((time.Ticks - Start.Ticks) / TimeSpan.TicksPerMinute));

    /// <summary>
    /// What is wrong with the block, one message each, each naming the block; empty when it can be priced. The engine reports these as invalid-input
    /// issues and prices nothing from the block.
    /// </summary>
    public IReadOnlyList<string> Validate()
    {
        var messages = new List<string>();
        var who = string.IsNullOrWhiteSpace(Id) ? "A block" : $"Block '{Id}'";
        void Add(string message) => messages.Add($"{who}: {message}");

        if (string.IsNullOrWhiteSpace(Id)) messages.Add("A block needs an id.");
        if (Id is { Length: > 64 }) Add("the id is longer than 64 characters.");

        if (!Enum.IsDefined(SupportType)) Add("the support type is not one of the known types.");
        if (!Enum.IsDefined(Intensity)) Add("the intensity is not one of the known levels.");
        if (!Enum.IsDefined(Setting)) Add("the setting is not one of the known settings.");
        if (!Enum.IsDefined(OnPublicHoliday)) Add("the public holiday decision is not one of Review, Charge or Skip.");

        if (Days is null || Days.Count == 0) Add("choose at least one day.");
        else
        {
            if (Days.Any(d => !Enum.IsDefined(d))) Add("a day is not a day of the week.");
            if (Days.Distinct().Count() != Days.Count) Add("each day can be listed once.");
        }

        if (Workers is < 1 or > 10) Add("workers must be between 1 and 10.");
        if (ParticipantsPresent is < 1 or > 40) Add("participants present must be between 1 and 40.");

        var wholeMinutes = Start.Ticks % TimeSpan.TicksPerMinute == 0 && End.Ticks % TimeSpan.TicksPerMinute == 0;
        if (!wholeMinutes) Add("start and end times must be whole minutes.");

        ValidateLocation(Add);

        if (wholeMinutes)
        {
            ValidateSleepover(Add);
            ValidateHeadcountChanges(Add);
        }

        if (Travel is { } travel)
        {
            if (travel.MinutesEachWay is < 0 or > 480) Add("travel minutes each way must be between 0 and 480.");
            if (travel.ParticipantsSharing is < 1 or > 40) Add("participants sharing the trip must be between 1 and 40.");
            if (travel.KmEachWay is < 0m or > 2000m) Add("travel kilometres each way must be between 0 and 2000.");
        }

        if (Transport is { } transport)
        {
            if (!Enum.IsDefined(transport.Vehicle)) Add("the transport vehicle is not one of Standard or Accessible.");
            if (transport.Km is < 0m or > 2000m) Add("transport kilometres must be between 0 and 2000.");
            if (transport.Tolls is < 0m or > 10000m) Add("tolls must be between $0 and $10,000.");
            if (transport.Parking is < 0m or > 10000m) Add("parking must be between $0 and $10,000.");
            if (transport.ParticipantsSharing is < 1 or > 40) Add("participants sharing the vehicle must be between 1 and 40.");
        }

        if (Accommodation is { } accommodation && accommodation.Nights is < 0 or > 14)
            Add("accommodation nights must be between 0 and 14.");

        return messages;
    }

    private void ValidateLocation(Action<string> add)
    {
        if (Location is null || !States.Contains((Location.State ?? string.Empty).Trim(), StringComparer.OrdinalIgnoreCase))
        {
            add("the delivery state must be one of ACT, NSW, NT, QLD, SA, TAS, VIC or WA.");
            return;
        }

        if (!Enum.IsDefined(Location.Zone))
        {
            add("the price zone is not one of National, Remote or VeryRemote.");
            return;
        }

        if (Location.Mm is { } mm)
        {
            var agrees = Location.Zone switch
            {
                PriceZone.National => mm is >= 1 and <= 5,
                PriceZone.Remote => mm == 6,
                _ => mm == 7,
            };
            if (!agrees)
                add(string.Create(CultureInfo.InvariantCulture, $"Modified Monash level {mm} does not match the {Location.Zone} price zone (National is MM1-5, Remote MM6, VeryRemote MM7)."));
        }
    }

    private void ValidateSleepover(Action<string> add)
    {
        if (SleepoverWindow is not null && !WorkerMaySleep) add("a sleepover window needs 'worker may sleep'.");
        if (SleepoverActiveHours != 0m && !WorkerMaySleep) add("active hours during a sleepover need 'worker may sleep'.");

        var windowMinutes = DurationMinutes;
        if (SleepoverWindow is { } window)
        {
            var fromOffset = OffsetFromStart(window.From);
            var length = Mod((int)((window.To.Ticks - window.From.Ticks) / TimeSpan.TicksPerMinute));
            var wholeWindow = window.From.Ticks % TimeSpan.TicksPerMinute == 0 && window.To.Ticks % TimeSpan.TicksPerMinute == 0;
            if (!wholeWindow) add("the sleepover window times must be whole minutes.");
            else if (length == 0 || fromOffset >= DurationMinutes || fromOffset + length > DurationMinutes) add("the sleepover window must lie inside the block.");
            else windowMinutes = length;
        }

        if (SleepoverActiveHours < 0m || SleepoverActiveHours * 60m > windowMinutes)
            add("active hours during a sleepover must be between 0 and the length of the sleepover.");
    }

    private void ValidateHeadcountChanges(Action<string> add)
    {
        if (HeadcountChanges is null || HeadcountChanges.Count == 0) return;

        if (HeadcountChanges.Count > MaxHeadcountChanges)
        {
            add(string.Create(CultureInfo.InvariantCulture, $"a block can have at most {MaxHeadcountChanges} headcount changes."));
            return;
        }

        var offsets = new HashSet<int>();
        foreach (var change in HeadcountChanges)
        {
            if (change.ParticipantsPresent is < 1 or > 40) add("participants present after a headcount change must be between 1 and 40.");
            var offset = OffsetFromStart(change.From);
            if (offset <= 0 || offset >= DurationMinutes) add("a headcount change must fall after the block starts and before it ends.");
            else if (!offsets.Add(offset)) add("two headcount changes cannot share a time.");
        }
    }

    private static int Mod(int minutes) => ((minutes % MinutesPerDay) + MinutesPerDay) % MinutesPerDay;
}
