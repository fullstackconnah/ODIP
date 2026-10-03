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

    // ── Review L2: a long block needs its window ──

    [Theory]
    [InlineData(22, 0, 10, 0, true)]     // 12 hours exactly: the whole block can be the night
    [InlineData(22, 0, 10, 15, false)]   // 12 hours 15
    [InlineData(6, 0, 6, 0, false)]      // 24 hours
    public void A_block_over_12_hours_where_the_worker_may_sleep_needs_the_sleepover_window(int sh, int sm, int eh, int em, bool valid)
    {
        // Without a window the whole block is the sleepover, so a 24 hour block was one Each item (311.79 for a day of support) with no issue.
        var block = Valid(b => b with
        {
            SupportType = PlanSupportType.PersonalCare, Days = new[] { DayOfWeek.Friday },
            Start = new TimeOnly(sh, sm), End = new TimeOnly(eh, em), WorkerMaySleep = true,
        });

        var messages = block.Validate();

        if (valid) Assert.Empty(messages);
        else Assert.Contains("needs the sleepover window", Assert.Single(messages));
    }

    [Fact]
    public void A_long_block_is_valid_with_its_window_or_when_the_worker_stays_awake()
    {
        var day = Valid(b => b with { Days = new[] { DayOfWeek.Friday }, Start = new TimeOnly(6, 0), End = new TimeOnly(6, 0) });

        Assert.Empty(day.Validate());   // 24 hours awake
        Assert.Empty((day with { WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = new TimeOnly(22, 0), To = new TimeOnly(6, 0) } }).Validate());
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

    // ── Verification of fix round 1, N2: a block id is echoed in every message, so it is shortened ──

    [Fact]
    public void A_block_id_is_shortened_to_64_characters_and_an_ellipsis_in_every_message_that_names_the_block()
    {
        var messages = PlanPricingTestSupport.WrongInManyWays(new string('x', 100_000)).Validate();

        Assert.True(messages.Count >= 20, $"{messages.Count} messages");
        Assert.All(messages, m => Assert.StartsWith($"Block '{new string('x', 64)}…': ", m));
        Assert.True(messages.Sum(m => m.Length) < 10_000, "the messages repeat the whole id");
    }

    [Fact]
    public void ShortId_leaves_a_normal_id_alone_and_cuts_a_long_one_without_splitting_a_surrogate_pair()
    {
        var sixtyFour = new string('a', 64);

        Assert.Equal(string.Empty, PlanBlock.ShortId(null));
        Assert.Equal("mon-wed", PlanBlock.ShortId("mon-wed"));
        Assert.Equal(sixtyFour, PlanBlock.ShortId(sixtyFour));
        Assert.Equal(sixtyFour + "…", PlanBlock.ShortId(sixtyFour + "b"));
        // A pair that straddles the cut is dropped whole: half of one is not valid text and cannot be written as JSON.
        Assert.Equal(new string('a', 63) + "…", PlanBlock.ShortId(new string('a', 63) + "😀" + "tail"));
    }

    // ── Review F6: a control character in an id is a 400, never a database error ──

    [Theory]
    [InlineData("a\0b")]            // a NUL: PostgreSQL's jsonb refuses it (22P05) and so does a varchar (22021), which InMemory never shows
    [InlineData("line\nbreak")]
    [InlineData("tab\there")]
    [InlineData("\u007f")]
    public void An_id_with_a_control_character_is_refused_and_is_not_echoed_back_in_the_message(string id)
    {
        var messages = Valid(b => b with { Id = id }).Validate();

        var message = Assert.Single(messages);
        Assert.Contains("control character", message);
        Assert.DoesNotContain(message, c => char.IsControl(c));          // the message that names the block shows the id without it
        Assert.DoesNotContain(PlanBlock.ShortId(id), c => char.IsControl(c));
    }

    [Fact]
    public void An_ordinary_id_with_spaces_dots_dashes_and_accents_is_still_fine()
    {
        Assert.Empty(Valid(b => b with { Id = "Mon–Wed café 1.2_a-b" }).Validate());
    }

    // ── Verification of fix round 1, N3: a huge number is a message, never an OverflowException ──

    [Fact]
    public void A_JSON_decimal_at_the_top_of_the_range_for_the_active_hours_is_a_message_and_not_an_overflow()
    {
        // The check multiplied the active hours by 60 to compare them with the window's minutes, and the request carries any decimal System.Text.Json reads: decimal.MaxValue
        // times 60 threw an OverflowException out of Validate() and the middleware answered 500 for the whole quote.
        var block = JsonSerializer.Deserialize<PlanBlock>("""{ "id": "b", "supportType": "PersonalCare", "days": ["Friday"], "start": "22:00", "end": "06:00", "workerMaySleep": true, "sleepoverActiveHours": 79228162514264337593543950335, "location": { "state": "NSW" } }""", Options)!;

        Assert.Contains(block.Validate(), m => m.Contains("active hours during a sleepover must be between 0 and the length of the sleepover"));
    }

    [Fact]
    public void The_active_hours_are_compared_with_the_sleepover_in_hours_so_the_edges_are_exact()
    {
        PlanBlock WithActive(decimal hours) => Valid(b => b with
        {
            SupportType = PlanSupportType.PersonalCare, Days = new[] { DayOfWeek.Friday }, Start = new TimeOnly(22, 0), End = new TimeOnly(6, 0), WorkerMaySleep = true, SleepoverActiveHours = hours,
        });

        Assert.Empty(WithActive(0m).Validate());
        Assert.Empty(WithActive(8m).Validate());                 // the whole 8 hour night
        Assert.NotEmpty(WithActive(8.25m).Validate());
        Assert.NotEmpty(WithActive(-0.25m).Validate());
        Assert.NotEmpty(WithActive(1_000_000_000_000_000_000_000_000m).Validate());   // 1e24
        Assert.NotEmpty(WithActive(decimal.MaxValue).Validate());
        Assert.NotEmpty(WithActive(decimal.MinValue).Validate());
    }

    [Fact]
    public void Every_number_in_a_block_can_be_as_large_or_as_small_as_its_type_allows_and_the_answer_is_a_message()
    {
        // Every field the request controls, at both ends of its type: the walk through Validate() must never throw, because an exception is a 500 and a logged error with a
        // stack trace for every other block in the quote.
        Func<Func<PlanProviderTravel, PlanProviderTravel>, Func<PlanBlock, PlanBlock>> travel = change => b => b with { Travel = change(new PlanProviderTravel { Claim = true }) };
        Func<Func<PlanActivityTransport, PlanActivityTransport>, Func<PlanBlock, PlanBlock>> transport = change => b => b with { Transport = change(new PlanActivityTransport { Km = 1m }) };
        Func<int, Func<PlanBlock, PlanBlock>> headcount = people => b => b with { HeadcountChanges = new[] { new PlanHeadcountChange { From = new TimeOnly(11, 0), ParticipantsPresent = people } } };
        var extremes = new (string Field, Func<PlanBlock, PlanBlock> Change)[]
        {
            ("active hours", b => b with { SleepoverActiveHours = decimal.MaxValue }), ("active hours", b => b with { SleepoverActiveHours = decimal.MinValue }),
            ("workers", b => b with { Workers = int.MaxValue }), ("workers", b => b with { Workers = int.MinValue }),
            ("participants", b => b with { ParticipantsPresent = int.MaxValue }), ("participants", b => b with { ParticipantsPresent = int.MinValue }),
            ("travel minutes", travel(t => t with { MinutesEachWay = int.MaxValue })), ("travel minutes", travel(t => t with { MinutesEachWay = int.MinValue })),
            ("travel km", travel(t => t with { KmEachWay = decimal.MaxValue })), ("travel km", travel(t => t with { KmEachWay = decimal.MinValue })),
            ("trip sharing", travel(t => t with { ParticipantsSharing = int.MaxValue })), ("trip sharing", travel(t => t with { ParticipantsSharing = int.MinValue })),
            ("transport km", transport(t => t with { Km = decimal.MaxValue })), ("transport km", transport(t => t with { Km = decimal.MinValue })),
            ("tolls", transport(t => t with { Tolls = decimal.MaxValue })), ("tolls", transport(t => t with { Tolls = decimal.MinValue })),
            ("parking", transport(t => t with { Parking = decimal.MaxValue })), ("parking", transport(t => t with { Parking = decimal.MinValue })),
            ("vehicle sharing", transport(t => t with { ParticipantsSharing = int.MaxValue })), ("vehicle sharing", transport(t => t with { ParticipantsSharing = int.MinValue })),
            ("nights", b => b with { Accommodation = new PlanAccommodation { Nights = int.MaxValue } }), ("nights", b => b with { Accommodation = new PlanAccommodation { Nights = int.MinValue } }),
            ("monash level", b => b with { Location = new PlanLocation { State = "NSW", Mm = int.MaxValue } }), ("monash level", b => b with { Location = new PlanLocation { State = "NSW", Mm = int.MinValue } }),
            ("headcount", headcount(int.MaxValue)), ("headcount", headcount(int.MinValue)),
            ("start", b => b with { Start = TimeOnly.MaxValue }), ("end", b => b with { End = TimeOnly.MaxValue }),
            ("window", b => b with { WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = TimeOnly.MaxValue, To = TimeOnly.MinValue } }),
        };

        foreach (var (field, change) in extremes)
        {
            var messages = change(Valid()).Validate();

            Assert.True(messages.Count > 0, $"{field}: an extreme value was accepted");
            Assert.All(messages, m => Assert.StartsWith("Block 'b1'", m));
        }
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
        Assert.Empty(Valid(b => b with { ParticipantsPresent = 3, Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 25, ReturnToBase = true, ParticipantsSharing = 3, KmEachWay = 12.5m } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = -1 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 481 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, ParticipantsSharing = 0 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Travel = new PlanProviderTravel { Claim = true, KmEachWay = -0.5m } }).Validate());

        Assert.Empty(Valid(b => b with { ParticipantsPresent = 3, Transport = new PlanActivityTransport { Km = 40, Vehicle = VehicleKind.Accessible, Tolls = 12.5m, Parking = 9m, ParticipantsSharing = 3 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = -1 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = 1, Tolls = -1m } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = 1, Parking = -1m } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Transport = new PlanActivityTransport { Km = 1, ParticipantsSharing = 0 } }).Validate());

        Assert.Empty(Valid(b => b with { SupportType = PlanSupportType.StaSupport, Accommodation = new PlanAccommodation { Nights = 2, WorkerOnSite = true } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Accommodation = new PlanAccommodation { Nights = -1 } }).Validate());
        Assert.NotEmpty(Valid(b => b with { Accommodation = new PlanAccommodation { Nights = 15 } }).Validate());
    }

    // ── Review M7: a trip is shared by the participants present unless the plan says otherwise ──

    [Fact]
    public void Nobody_is_assumed_to_share_a_trip_or_a_vehicle_until_the_plan_says_so_and_the_pricer_then_uses_the_participants_present()
    {
        Assert.Null(new PlanProviderTravel().ParticipantsSharing);
        Assert.Null(new PlanActivityTransport().ParticipantsSharing);
        Assert.Empty(Valid(b => b with { ParticipantsPresent = 3, Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 30 }, Transport = new PlanActivityTransport { Km = 10 } }).Validate());
    }

    [Fact]
    public void More_participants_cannot_share_a_trip_or_a_vehicle_than_are_present()
    {
        var trip = Valid(b => b with { ParticipantsPresent = 3, Travel = new PlanProviderTravel { Claim = true, ParticipantsSharing = 4 } }).Validate();
        var vehicle = Valid(b => b with { ParticipantsPresent = 3, Transport = new PlanActivityTransport { Km = 1, ParticipantsSharing = 4 } }).Validate();

        Assert.Contains("4 participants cannot share the trip: at most 3 are present", Assert.Single(trip));
        Assert.Contains("4 participants cannot share the vehicle: at most 3 are present", Assert.Single(vehicle));
        Assert.Empty(Valid(b => b with { ParticipantsPresent = 3, Travel = new PlanProviderTravel { Claim = true, ParticipantsSharing = 2 } }).Validate());   // a smaller group on the trip is fine
    }

    [Fact]
    public void The_most_that_can_share_is_the_most_present_at_any_time_in_the_block()
    {
        // Two are present at 09:00 and four from 11:00, so four can share a trip or a vehicle and five cannot.
        PlanBlock Block(int sharing) => Valid(b => b with
        {
            ParticipantsPresent = 2,
            HeadcountChanges = new[] { new PlanHeadcountChange { From = new TimeOnly(11, 0), ParticipantsPresent = 4 } },
            Travel = new PlanProviderTravel { Claim = true, ParticipantsSharing = sharing },
        });

        Assert.Empty(Block(4).Validate());
        Assert.Contains("at most 4 are present", Assert.Single(Block(5).Validate()));
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
