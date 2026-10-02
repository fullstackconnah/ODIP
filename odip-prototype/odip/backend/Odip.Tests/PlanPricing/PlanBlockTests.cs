using System.Text.Json;
using System.Text.Json.Serialization;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The support block (plan builder phase B item 1, NDIS-CODES 11.1): one weekly routine of one support type, at one place, for one
/// participant. These tests pin what the model derives (the end falling on the next day, the duration) and what it refuses; the engine
/// never throws for a bad block, it reports each message below as an invalid-input issue.
/// </summary>
public class PlanBlockTests
{
    private static PlanBlock Valid(Func<PlanBlock, PlanBlock>? change = null)
    {
        var block = new PlanBlock
        {
            Id = "b1",
            SupportType = PlanSupportType.CommunityAccess,
            Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday },
            Start = new TimeOnly(9, 0),
            End = new TimeOnly(13, 0),
            Location = new PlanLocation { State = "NSW" },
        };
        return change is null ? block : change(block);
    }

    // ── What the model derives ────────────────────────────────────────────────────

    [Theory]
    [InlineData(9, 0, 13, 0, false, 240)]
    [InlineData(22, 0, 6, 0, true, 480)]
    [InlineData(18, 30, 22, 15, false, 225)]
    [InlineData(23, 0, 0, 0, true, 60)]
    [InlineData(0, 0, 0, 0, true, 1440)]
    [InlineData(9, 0, 9, 0, true, 1440)]
    public void The_end_falls_on_the_next_day_when_it_is_not_after_the_start_and_the_duration_follows(int sh, int sm, int eh, int em, bool nextDay, int minutes)
    {
        var block = Valid(b => b with { Start = new TimeOnly(sh, sm), End = new TimeOnly(eh, em) });

        Assert.Equal(nextDay, block.EndsNextDay);
        Assert.Equal(minutes, block.DurationMinutes);
        Assert.Empty(block.Validate());
    }

    [Fact]
    public void A_block_has_the_owner_approved_defaults_one_worker_for_one_participant_in_the_community_reviewing_holidays()
    {
        var block = new PlanBlock();

        Assert.Equal((1, 1, PlanSetting.Community, HolidayDecision.Review, SupportIntensity.Standard), (block.Workers, block.ParticipantsPresent, block.Setting, block.OnPublicHoliday, block.Intensity));
        Assert.False(block.WorkerMaySleep);
        Assert.Null(block.Travel);
        Assert.Null(block.Transport);
        Assert.Null(block.Accommodation);
        Assert.Empty(block.HeadcountChanges);
        Assert.Equal(PriceZone.National, block.Location.Zone);
    }

    [Fact]
    public void A_valid_block_has_nothing_to_report()
    {
        Assert.Empty(Valid().Validate());
    }

    // ── What it refuses ───────────────────────────────────────────────────────────

    [Fact]
    public void A_block_needs_an_id_and_at_least_one_distinct_day()
    {
        Assert.Contains(Valid(b => b with { Id = " " }).Validate(), m => m.Contains("id", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(Valid(b => b with { Days = Array.Empty<DayOfWeek>() }).Validate(), m => m.Contains("day", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(Valid(b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Monday } }).Validate(), m => m.Contains("once", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(11, 1)]
    [InlineData(1, 0)]
    [InlineData(1, 41)]
    public void Workers_and_participants_present_are_whole_numbers_in_range(int workers, int participants)
    {
        Assert.NotEmpty(Valid(b => b with { Workers = workers, ParticipantsPresent = participants }).Validate());
    }

    [Theory]
    [InlineData("")]
    [InlineData("NZ")]
    [InlineData("Victoria")]
    public void The_delivery_state_is_one_of_the_eight_states_or_territories(string state)
    {
        Assert.Contains(Valid(b => b with { Location = new PlanLocation { State = state } }).Validate(), m => m.Contains("state", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("nsw")]
    [InlineData("Qld")]
    [InlineData("WA")]
    public void A_state_is_accepted_in_any_case(string state)
    {
        Assert.Empty(Valid(b => b with { Location = new PlanLocation { State = state } }).Validate());
    }

    [Theory]
    [InlineData(PriceZone.National, 3, true)]
    [InlineData(PriceZone.National, 5, true)]
    [InlineData(PriceZone.Remote, 6, true)]
    [InlineData(PriceZone.VeryRemote, 7, true)]
    [InlineData(PriceZone.National, 6, false)]
    [InlineData(PriceZone.Remote, 5, false)]
    [InlineData(PriceZone.VeryRemote, 6, false)]
    [InlineData(PriceZone.National, 0, false)]
    [InlineData(PriceZone.National, 8, false)]
    public void A_Modified_Monash_level_must_agree_with_the_price_zone(PriceZone zone, int mm, bool valid)
    {
        var messages = Valid(b => b with { Location = new PlanLocation { State = "NSW", Zone = zone, Mm = mm } }).Validate();

        Assert.Equal(valid, messages.Count == 0);
    }

    [Fact]
    public void Times_are_whole_minutes()
    {
        Assert.NotEmpty(Valid(b => b with { Start = new TimeOnly(9, 0, 30) }).Validate());
        Assert.NotEmpty(Valid(b => b with { End = new TimeOnly(13, 0, 0, 500) }).Validate());
    }

    // ── Sleepover ─────────────────────────────────────────────────────────────────

    private static PlanBlock Overnight(Func<PlanBlock, PlanBlock>? change = null)
    {
        var block = Valid(b => b with
        {
            SupportType = PlanSupportType.PersonalCare, Days = new[] { DayOfWeek.Friday },
            Start = new TimeOnly(17, 0), End = new TimeOnly(9, 0), WorkerMaySleep = true,
            SleepoverWindow = new PlanSleepoverWindow { From = new TimeOnly(22, 0), To = new TimeOnly(6, 0) },
        });
        return change is null ? block : change(block);
    }

    [Fact]
    public void A_sleepover_window_inside_the_block_is_valid()
    {
        Assert.Empty(Overnight().Validate());
    }

    [Fact]
    public void A_sleepover_window_needs_the_worker_to_be_allowed_to_sleep()
    {
        Assert.Contains(Overnight(b => b with { WorkerMaySleep = false }).Validate(), m => m.Contains("sleep", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_sleepover_window_must_lie_inside_the_block()
    {
        // 16:00 is before the 17:00 start; 22:00-10:00 runs past the 09:00 end.
        Assert.NotEmpty(Overnight(b => b with { SleepoverWindow = new PlanSleepoverWindow { From = new TimeOnly(16, 0), To = new TimeOnly(6, 0) } }).Validate());
        Assert.NotEmpty(Overnight(b => b with { SleepoverWindow = new PlanSleepoverWindow { From = new TimeOnly(22, 0), To = new TimeOnly(10, 0) } }).Validate());
    }

    [Fact]
    public void Active_hours_during_a_sleepover_are_not_negative_and_fit_inside_it()
    {
        Assert.Empty(Overnight(b => b with { SleepoverActiveHours = 3.5m }).Validate());
        Assert.NotEmpty(Overnight(b => b with { SleepoverActiveHours = -1m }).Validate());
        Assert.NotEmpty(Overnight(b => b with { SleepoverActiveHours = 8.5m }).Validate());
        Assert.NotEmpty(Valid(b => b with { SleepoverActiveHours = 1m }).Validate());   // no sleepover, so nothing to be active inside
    }

    // ── Headcount changes ─────────────────────────────────────────────────────────

    [Fact]
    public void A_headcount_change_lies_strictly_inside_the_block()
    {
        PlanBlock WithChange(TimeOnly at, int participants = 2) => Valid(b => b with
        {
            Days = new[] { DayOfWeek.Saturday }, Start = new TimeOnly(9, 0), End = new TimeOnly(15, 0), ParticipantsPresent = 3,
            HeadcountChanges = new[] { new PlanHeadcountChange { From = at, ParticipantsPresent = participants } },
        });

        Assert.Empty(WithChange(new TimeOnly(12, 0)).Validate());
        Assert.NotEmpty(WithChange(new TimeOnly(9, 0)).Validate());
        Assert.NotEmpty(WithChange(new TimeOnly(15, 0)).Validate());
        Assert.NotEmpty(WithChange(new TimeOnly(16, 0)).Validate());
        Assert.NotEmpty(WithChange(new TimeOnly(12, 0), 0).Validate());
        Assert.NotEmpty(WithChange(new TimeOnly(12, 0), 41).Validate());
    }

    [Fact]
    public void Two_headcount_changes_cannot_share_a_time()
    {
        var block = Valid(b => b with
        {
            Start = new TimeOnly(9, 0), End = new TimeOnly(15, 0), ParticipantsPresent = 3,
            HeadcountChanges = new[]
            {
                new PlanHeadcountChange { From = new TimeOnly(12, 0), ParticipantsPresent = 2 },
                new PlanHeadcountChange { From = new TimeOnly(12, 0), ParticipantsPresent = 1 },
            },
        });

        Assert.NotEmpty(block.Validate());
    }

    [Fact]
    public void A_block_has_at_most_ten_headcount_changes_because_each_one_cuts_every_occurrence_into_another_line()
    {
        PlanBlock WithChanges(int count) => Valid(b => b with
        {
            Start = new TimeOnly(0, 0), End = new TimeOnly(0, 0), ParticipantsPresent = 5,
            HeadcountChanges = Enumerable.Range(1, count).Select(i => new PlanHeadcountChange { From = TimeOnly.MinValue.AddMinutes(i * 15), ParticipantsPresent = 1 + i % 4 }).ToList(),
        });

        Assert.Equal(10, PlanBlock.MaxHeadcountChanges);
        Assert.Empty(WithChanges(10).Validate());
        Assert.Contains(WithChanges(11).Validate(), m => m.Contains("at most 10 headcount changes"));
        Assert.Contains(WithChanges(90).Validate(), m => m.Contains("at most 10 headcount changes"));
    }

    [Fact]
    public void A_missing_headcount_list_or_a_missing_entry_in_it_is_a_message_never_an_exception_and_counts_as_no_changes_afterwards()
    {
        var noList = Valid(b => b with { HeadcountChanges = null! });
        var nullEntry = Valid(b => b with { HeadcountChanges = new PlanHeadcountChange?[] { null }! });
        var mixed = Valid(b => b with { HeadcountChanges = new[] { new PlanHeadcountChange { From = new TimeOnly(11, 0), ParticipantsPresent = 2 }, null! } });

        Assert.Contains(noList.Validate(), m => m.Contains("headcount changes must be a list"));
        Assert.Contains(nullEntry.Validate(), m => m.Contains("headcount changes must be a list"));
        Assert.Contains(mixed.Validate(), m => m.Contains("headcount changes must be a list"));
        Assert.Empty(noList.Changes);
        Assert.Empty(nullEntry.Changes);
        Assert.Single(mixed.Changes);
        Assert.Equal(noList.MaxLinesPerOccurrence, Valid().MaxLinesPerOccurrence);
    }

    [Fact]
    public void A_JSON_null_for_the_headcount_list_reads_as_a_block_with_a_message()
    {
        var block = JsonSerializer.Deserialize<PlanBlock>("""{ "id": "b", "supportType": "CommunityAccess", "days": ["Monday"], "start": "09:00", "end": "13:00", "headcountChanges": null, "location": { "state": "NSW" } }""", Options)!;
        var inList = JsonSerializer.Deserialize<PlanBlock>("""{ "id": "b", "supportType": "CommunityAccess", "days": ["Monday"], "start": "09:00", "end": "13:00", "headcountChanges": [null], "location": { "state": "NSW" } }""", Options)!;

        Assert.Contains(block.Validate(), m => m.Contains("headcount changes must be a list"));
        Assert.Contains(inList.Validate(), m => m.Contains("headcount changes must be a list"));
    }

    [Fact]
    public void A_headcount_change_after_midnight_counts_from_the_start_of_an_overnight_block()
    {
        var block = Valid(b => b with
        {
            SupportType = PlanSupportType.StaSupport, Start = new TimeOnly(20, 0), End = new TimeOnly(8, 0), ParticipantsPresent = 3,
            HeadcountChanges = new[] { new PlanHeadcountChange { From = new TimeOnly(2, 0), ParticipantsPresent = 2 } },
        });

        Assert.Empty(block.Validate());
    }

    // ── Travel, transport, accommodation ──────────────────────────────────────────

    [Fact]
    public void Travel_transport_and_accommodation_stay_inside_sensible_bounds()
    {
        Assert.Empty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 25, ReturnToBase = true, ParticipantsSharing = 3, KmEachWay = 12.5m } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = -1 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 481 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, ParticipantsSharing = 0 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, KmEachWay = -0.5m } }).Validate());

        Assert.Empty(Valid(b => b with { Transport = new PlanActivityTransport { Km = 40, Vehicle = VehicleKind.Accessible, Tolls = 12.5m, Parking = 9m, ParticipantsSharing = 3 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = -1 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = 1, Tolls = -1m } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = 1, Parking = -1m } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = 1, ParticipantsSharing = 0 } }).Validate());

        Assert.Empty(Valid(b => b with { SupportType = PlanSupportType.StaSupport, Accommodation = new PlanAccommodation { Nights = 2, WorkerOnSite = true } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Accommodation = new PlanAccommodation { Nights = -1 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Accommodation = new PlanAccommodation { Nights = 15 } }).Validate());
    }

    [Fact]
    public void Every_message_names_the_block()
    {
        var messages = Valid(b => b with { Id = "block-7", Workers = 0 }).Validate();

        Assert.All(messages, m => Assert.Contains("block-7", m));
    }

    // ── JSON: the engine's input travels as the API body ──────────────────────────

    [Fact]
    public void A_block_reads_from_the_JSON_the_API_receives_with_names_for_enums_days_and_times()
    {
        const string json = """
        {
          "id": "mon-wed",
          "supportType": "CommunityAccess",
          "intensity": "Standard",
          "days": ["Monday", "Wednesday"],
          "start": "09:00",
          "end": "13:00",
          "workers": 1,
          "participantsPresent": 1,
          "setting": "Community",
          "location": { "state": "NSW", "zone": "National" },
          "onPublicHoliday": "Review",
          "travel": { "claim": true, "minutesEachWay": 20, "returnToBase": true, "participantsSharing": 1 },
          "transport": { "km": 20, "vehicle": "Standard", "tolls": 0, "parking": 0, "participantsSharing": 1 }
        }
        """;

        var block = JsonSerializer.Deserialize<PlanBlock>(json, Options)!;

        Assert.Equal("mon-wed", block.Id);
        Assert.Equal(new[] { DayOfWeek.Monday, DayOfWeek.Wednesday }, block.Days);
        Assert.Equal((new TimeOnly(9, 0), new TimeOnly(13, 0), 240), (block.Start, block.End, block.DurationMinutes));
        Assert.Equal(20, block.Travel!.MinutesEachWay);
        Assert.Equal(20m, block.Transport!.Km);
        Assert.Empty(block.Validate());
    }

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
}
