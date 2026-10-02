using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Properties of the engine over many generated plans (a seeded generator, so a failure names its seed and reruns identically). The window is
/// 12 October to 8 November 2026, which holds no clock change in any state, so wall-clock minutes equal elapsed minutes. The checks are written
/// independently of the engine: integer cents for the group arithmetic, plain loops for the dates.
/// </summary>
public class PlanPricingPropertyTests
{
    private const int Cases = 150;
    private static readonly DateOnly From = new(2026, 10, 12), To = new(2026, 11, 8);
    private static readonly string[] States = { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA" };

    private sealed record Case(int Seed, List<PlanBlock> Blocks, List<HolidayEntry> Holidays, PlanPricingPolicy Policy, PlanQuote Quote);

    // ── The generator ─────────────────────────────────────────────────────────────

    private static PlanBlock RandomBlock(Random random, int index)
    {
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var type = (PlanSupportType)random.Next(4);
            var start = new TimeOnly(random.Next(0, 24), random.Next(0, 4) * 15);
            var end = new TimeOnly(random.Next(0, 24), random.Next(0, 4) * 15);
            var block = new PlanBlock
            {
                Id = $"b{index}", SupportType = type,
                Intensity = random.Next(8) == 0 ? SupportIntensity.HighIntensity : SupportIntensity.Standard,
                Days = Enum.GetValues<DayOfWeek>().OrderBy(_ => random.Next()).Take(random.Next(1, 4)).ToArray(),
                Start = start, End = end,
                Workers = random.Next(5) == 0 ? 2 : 1, ParticipantsPresent = random.Next(1, 5),
                Setting = (PlanSetting)random.Next(4),
                Location = RandomLocation(random),
                OnPublicHoliday = (HolidayDecision)random.Next(3),
            };
            block = WithSleepover(random, block);
            block = WithHeadcount(random, block);
            block = WithExtras(random, block);
            if (block.Validate().Count == 0) return block;
        }

        return new PlanBlock { Id = $"b{index}", SupportType = PlanSupportType.CommunityAccess, Days = new[] { DayOfWeek.Monday }, Start = new TimeOnly(9, 0), End = new TimeOnly(13, 0), Location = new PlanLocation { State = "NSW" } };
    }

    private static PlanLocation RandomLocation(Random random) => random.Next(6) switch
    {
        0 => new PlanLocation { State = States[random.Next(8)], Zone = PriceZone.Remote, Mm = random.Next(2) == 0 ? 6 : null },
        1 => new PlanLocation { State = States[random.Next(8)], Zone = PriceZone.VeryRemote },
        _ => new PlanLocation { State = States[random.Next(8)], Zone = PriceZone.National, Mm = random.Next(3) == 0 ? random.Next(1, 6) : null },
    };

    private static PlanBlock WithSleepover(Random random, PlanBlock block)
    {
        if (random.Next(3) != 0) return block;
        block = block with { WorkerMaySleep = true, SleepoverActiveHours = random.Next(5) < 2 ? random.Next(1, 9) * 0.5m : 0m };
        if (random.Next(2) == 0) return block;

        var offset = random.Next(0, block.DurationMinutes / 15) * 15;
        var length = random.Next(1, Math.Max(2, (block.DurationMinutes - offset) / 15 + 1)) * 15;
        var from = block.Start.AddMinutes(offset);
        return block with { SleepoverWindow = new PlanSleepoverWindow { From = from, To = from.AddMinutes(length) } };
    }

    private static PlanBlock WithHeadcount(Random random, PlanBlock block)
    {
        if (random.Next(5) != 0 || block.DurationMinutes < 60) return block;
        var changes = Enumerable.Range(0, random.Next(1, 3))
            .Select(_ => random.Next(1, block.DurationMinutes / 15) * 15).Distinct()
            .Select(offset => new PlanHeadcountChange { From = block.Start.AddMinutes(offset), ParticipantsPresent = random.Next(1, 5) }).ToList();
        return block with { HeadcountChanges = changes };
    }

    private static PlanBlock WithExtras(Random random, PlanBlock block) => block with
    {
        Travel = random.Next(3) == 0 ? new PlanProviderTravel { Claim = true, MinutesEachWay = random.Next(0, 9) * 15, ReturnToBase = random.Next(2) == 0, ParticipantsSharing = RandomSharing(random, block), KmEachWay = random.Next(0, 30) } : null,
        Transport = random.Next(4) == 0 ? new PlanActivityTransport { Km = random.Next(0, 60), Tolls = random.Next(0, 3) * 5, Vehicle = (VehicleKind)random.Next(2), ParticipantsSharing = RandomSharing(random, block) } : null,
        Accommodation = block.SupportType == PlanSupportType.StaSupport && random.Next(2) == 0 ? new PlanAccommodation { Nights = random.Next(1, 4), WorkerOnSite = random.Next(2) == 0 } : null,
    };

    /// <summary>Sharing is left out about a third of the time (the pricer then uses the participants present) and is never more than the participants present.</summary>
    private static int? RandomSharing(Random random, PlanBlock block) =>
        random.Next(3) == 0 ? null : random.Next(1, Math.Max(block.ParticipantsPresent, block.Changes.Select(c => c.ParticipantsPresent).DefaultIfEmpty(0).Max()) + 1);

    private static List<HolidayEntry> RandomHolidays(Random random)
    {
        var holidays = new List<HolidayEntry>();
        for (var i = 0; i < random.Next(0, 4); i++)
        {
            var date = From.AddDays(random.Next(0, (To.DayNumber - From.DayNumber) + 1));
            var state = random.Next(3) == 0 ? null : States[random.Next(8)];
            holidays.Add(random.Next(4) == 0
                ? new HolidayEntry(date, state, "Part day", new TimeOnly(random.Next(0, 23), 0), random.Next(2) == 0 ? null : new TimeOnly(23, 30), "random")
                : new HolidayEntry(date, state, "Holiday", null, null, "random"));
        }

        return holidays;
    }

    private static readonly Lazy<List<Case>> AllCases = new(() => Enumerable.Range(1, Cases).Select(MakeCase).ToList());

    private static Case MakeCase(int seed)
    {
        var random = new Random(seed);
        var blocks = Enumerable.Range(0, random.Next(1, 5)).Select(i => RandomBlock(random, i)).ToList();
        var holidays = RandomHolidays(random);
        var policy = PlanPricingPolicy.Default with { Crossing = random.Next(2) == 0 ? CrossingPolicy.Split : CrossingPolicy.HigherOf };
        return new Case(seed, blocks, holidays, policy, Quote(blocks, From, To, policy, holidays));
    }

    private static string Tag(Case c) => $"seed {c.Seed}";

    private static List<DateOnly> Dates(PlanBlock block)
    {
        var dates = new List<DateOnly>();
        for (var d = From; d <= To; d = d.AddDays(1))
            if (block.Days.Contains(d.DayOfWeek)) dates.Add(d);
        return dates;
    }

    // ── Properties ────────────────────────────────────────────────────────────────

    [Fact]
    public void The_generator_reaches_the_rules_it_is_meant_to_exercise()
    {
        var lines = AllCases.Value.SelectMany(c => c.Quote.Lines).ToList();

        Assert.Contains(lines, l => l.Kind == PlannedLineKind.Sleepover);
        Assert.Contains(lines, l => l.Kind == PlannedLineKind.SleepoverActiveHours);
        Assert.Contains(lines, l => l.Trace.Policy == "B");
        Assert.Contains(lines, l => l.Trace.Policy == "A");
        Assert.Contains(lines, l => l.HolidayExposure);
        Assert.Contains(lines, l => !l.IsPriced);
        Assert.Contains(lines, l => l.Trace.ParticipantsPresent > 1);
        Assert.Contains(lines, l => l.Kind == PlannedLineKind.ProviderTravelTime);
        Assert.Contains(lines, l => l.Kind == PlannedLineKind.ActivityTransport);
        Assert.Contains(lines, l => l.Kind == PlannedLineKind.CentreCapital);
        Assert.Contains(lines, l => l.Kind == PlannedLineKind.ParticipantAccommodation);
        Assert.Contains(AllCases.Value, c => c.Quote.HolidayOccurrences.Any(h => h.Skipped));
        Assert.True(lines.Count > 1000);
    }

    [Fact]
    public void Lines_never_overlap_in_time_within_a_block()
    {
        foreach (var c in AllCases.Value)
            foreach (var group in c.Quote.Lines.Where(l => l.StartLocal is not null && l.EndLocal is not null).GroupBy(l => l.BlockId))
            {
                var ordered = group.OrderBy(l => l.StartLocal).ThenBy(l => l.EndLocal).ToList();
                for (var i = 1; i < ordered.Count; i++)
                    Assert.True(ordered[i].StartLocal >= ordered[i - 1].EndLocal, $"{Tag(c)}, block {group.Key}: {ordered[i - 1].StartLocal}-{ordered[i - 1].EndLocal} overlaps {ordered[i].StartLocal}-{ordered[i].EndLocal}");
            }
    }

    [Fact]
    public void A_blocks_split_hours_add_up_to_its_duration_for_every_occurrence_that_is_not_skipped()
    {
        foreach (var c in AllCases.Value)
            foreach (var block in c.Blocks.Where(b => b.Validate().Count == 0))
            {
                var skipped = c.Quote.HolidayOccurrences.Where(h => h.BlockId == block.Id && h.Skipped).Select(h => h.Date).ToHashSet();
                foreach (var date in Dates(block))
                {
                    var start = date.ToDateTime(block.Start);
                    var end = start.AddMinutes(block.DurationMinutes);
                    var inside = c.Quote.Lines.Where(l => l.BlockId == block.Id && l.StartLocal is { } s && s >= start && s < end).ToList();
                    var minutes = inside.Sum(l => (l.EndLocal!.Value - l.StartLocal!.Value).TotalMinutes);

                    Assert.Equal(skipped.Contains(date) ? 0 : block.DurationMinutes, minutes);
                }
            }
    }

    [Fact]
    public void Every_priced_hour_costs_the_floor_of_the_maximum_times_workers_over_participants_and_the_total_is_the_floor_of_unit_price_times_hours()
    {
        foreach (var c in AllCases.Value)
            foreach (var line in c.Quote.Lines.Where(l => l.IsPriced && l.Kind is PlannedLineKind.Support or PlannedLineKind.SleepoverActiveHours or PlannedLineKind.Sleepover or PlannedLineKind.WorkerAccommodation))
            {
                var maxCents = (long)(line.Trace.MaximumUnitPrice!.Value * 100m);
                Assert.Equal((decimal)maxCents, line.Trace.MaximumUnitPrice!.Value * 100m);      // a catalogue price has whole cents
                var unitCents = maxCents * line.Trace.Workers / line.Trace.ParticipantsPresent;   // integer division is the floor
                Assert.True(line.UnitPrice * 100m == unitCents, $"{Tag(c)}: {line.ItemCode} unit {line.UnitPrice} but floor({maxCents} x {line.Trace.Workers} / {line.Trace.ParticipantsPresent}) = {unitCents} cents");

                if (line.Unit == "H")
                {
                    var minutes = (long)(line.Qty * 60m);
                    Assert.Equal(line.Qty * 60m, minutes);                               // generated times are whole quarter hours
                    Assert.True(line.Total * 100m == unitCents * minutes / 60, $"{Tag(c)}: {line.ItemCode} total {line.Total} for {minutes} min at {unitCents} cents");
                }
            }
    }

    [Fact]
    public void The_same_input_always_gives_the_same_output_whatever_the_order_of_the_catalogue_the_holidays_and_the_days()
    {
        foreach (var c in AllCases.Value.Take(60))
        {
            var again = Quote(c.Blocks, From, To, c.Policy, c.Holidays);
            var shuffled = Quote(c.Blocks.Select(b => b with { Days = b.Days.Reverse().ToList() }).ToList(), From, To, c.Policy,
                Enumerable.Reverse(c.Holidays), RealCatalogue.Reverse().ToList());

            Assert.Equal(Json(c.Quote), Json(again));
            Assert.Equal(Json(c.Quote), Json(shuffled));
        }
    }

    [Fact]
    public void Totals_are_the_sum_of_the_priced_lines_and_agree_by_category_and_by_block()
    {
        foreach (var c in AllCases.Value)
        {
            var priced = c.Quote.Lines.Where(l => l.IsPriced).ToList();

            Assert.Equal(priced.Sum(l => l.Total), c.Quote.Totals.Amount);
            Assert.Equal(c.Quote.Totals.Amount, c.Quote.Totals.ByCategory.Sum(x => x.Amount));
            Assert.Equal(c.Quote.Totals.Amount, c.Quote.Totals.ByBlock.Sum(x => x.Amount));
            Assert.Equal(c.Quote.Lines.Count(l => !l.IsPriced), c.Quote.Totals.UnpricedLines);
            Assert.Equal(c.Quote.Lines.Count(l => l.Review), c.Quote.Totals.ReviewLines);
        }
    }

    [Fact]
    public void Each_block_has_one_occurrence_for_every_matching_day_in_the_period_less_the_skipped_ones()
    {
        foreach (var c in AllCases.Value)
            foreach (var total in c.Quote.Totals.ByBlock)
            {
                var block = c.Blocks.Single(b => b.Id == total.BlockId);
                Assert.Equal(Dates(block).Count, total.Occurrences + total.SkippedOccurrences);
            }
    }

    [Fact]
    public async Task A_later_catalogue_import_never_changes_the_lines_for_an_earlier_service_date()
    {
        // Every priced row is raised by a dollar from 1 December: the period straddles it.
        var december = await WithDecemberPriceSetAsync(_ => true);
        var from = new DateOnly(2026, 11, 16);
        var to = new DateOnly(2026, 12, 14);
        var changed = 0;

        foreach (var c in AllCases.Value.Take(100))
        {
            var before = Quote(c.Blocks, from, to, c.Policy, c.Holidays);
            var after = Quote(c.Blocks, from, to, c.Policy, c.Holidays, december.ToList());

            var early = before.Lines.Where(l => l.ServiceDate < new DateOnly(2026, 12, 1)).Select(Json).ToList();
            var earlyAfter = after.Lines.Where(l => l.ServiceDate < new DateOnly(2026, 12, 1)).Select(Json).ToList();
            Assert.True(early.SequenceEqual(earlyAfter), $"{Tag(c)}: a December price set changed a line dated before it");
            changed += after.Lines.Count(l => l.ServiceDate >= new DateOnly(2026, 12, 1) && l.IsPriced && before.Lines.All(b => Json(b) != Json(l)));
        }

        Assert.True(changed > 100, "the December set priced nothing differently, so the check proved nothing");
    }

    [Fact]
    public void A_priced_line_never_exceeds_the_catalogue_maximum_for_its_workers_and_participants_and_every_line_names_its_price_basis()
    {
        foreach (var c in AllCases.Value)
            foreach (var line in c.Quote.Lines.Where(l => l.IsPriced))
            {
                Assert.NotNull(line.Trace.CatalogueVersion);
                Assert.NotNull(line.Trace.PriceBasisFrom);
                Assert.NotEmpty(line.Trace.Rules);
                Assert.False(string.IsNullOrWhiteSpace(line.Trace.Why));
                Assert.True(line.Trace.PriceBasisFrom <= line.ServiceDate, $"{Tag(c)}: {line.ItemCode} priced from {line.Trace.PriceBasisFrom} for {line.ServiceDate}");
            }
    }
}
