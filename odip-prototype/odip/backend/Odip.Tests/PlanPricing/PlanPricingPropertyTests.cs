using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Properties of the engine over many generated plans (a seeded generator, so a failure names its seed and reruns identically). A case's period is
/// one of three windows: 12 October to 8 November 2026, which holds no clock change in any state, and two that hold the night the clocks go forward
/// (Sunday 4 October 2026) and the night they go back (Sunday 4 April 2027) in NSW, ACT, VIC, TAS and SA, where an hour is lost or repeated and the
/// elapsed-hours rules apply. The checks are written independently of the engine: integer cents for the group arithmetic, plain loops for the dates and
/// a catalogue lookup of its own for every price.
/// </summary>
public class PlanPricingPropertyTests
{
    private const int Cases = 150;
    private static readonly DateOnly From = new(2026, 10, 12), To = new(2026, 11, 8);

    private static readonly (DateOnly From, DateOnly To)[] Windows =
    {
        (From, To),
        (new DateOnly(2026, 9, 28), new DateOnly(2026, 10, 11)),   // the clocks go forward at 02:00 on Sunday 4 October
        (new DateOnly(2027, 3, 29), new DateOnly(2027, 4, 11)),    // and go back at 03:00 on Sunday 4 April
    };
    private static readonly string[] States = { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA" };

    private sealed record Case(int Seed, List<PlanBlock> Blocks, List<HolidayEntry> Holidays, PlanPricingPolicy Policy, DateOnly From, DateOnly To, PlanQuote Quote);

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
        block = block with { WorkerMaySleep = true, SleepoverActiveHours = random.Next(5) < 2 ? random.Next(3, 9) * 0.5m : 0m };
        // Without a window the whole block is the night, and above 12 hours a block has to say which part is (review L2).
        if (block.DurationMinutes <= 12 * 60 && random.Next(2) == 0) return block;

        // Most windows are long enough to be a sleepover (8 hours or more); the rest are any stretch of the block.
        var longEnough = block.DurationMinutes >= 8 * 60 && random.Next(5) < 3;
        var offset = longEnough ? random.Next(0, (block.DurationMinutes - 8 * 60) / 15 + 1) * 15 : random.Next(0, block.DurationMinutes / 15) * 15;
        var longest = block.DurationMinutes - offset;
        var length = longEnough ? random.Next(8 * 4, longest / 15 + 1) * 15 : random.Next(1, Math.Max(2, longest / 15 + 1)) * 15;
        var from = block.Start.AddMinutes(offset);
        return block with { SleepoverWindow = new PlanSleepoverWindow { From = from, To = from.AddMinutes(length) } };
    }

    private static PlanBlock WithHeadcount(Random random, PlanBlock block)
    {
        if (random.Next(5) != 0 || block.DurationMinutes < 60) return block;
        // Up to the cap of ten changes: a long list cuts every occurrence into many lines, and the short lists the generator used to make never showed it.
        var changes = Enumerable.Range(0, random.Next(1, PlanBlock.MaxHeadcountChanges + 1))
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

    private static List<HolidayEntry> RandomHolidays(Random random, DateOnly from, DateOnly to)
    {
        var holidays = new List<HolidayEntry>();
        for (var i = 0; i < random.Next(0, 4); i++)
        {
            var date = from.AddDays(random.Next(0, (to.DayNumber - from.DayNumber) + 1));
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
        var (from, to) = Windows[random.Next(Windows.Length)];
        var blocks = Enumerable.Range(0, random.Next(1, 5)).Select(i => RandomBlock(random, i)).ToList();
        var holidays = RandomHolidays(random, from, to);
        var policy = PlanPricingPolicy.Default with { Crossing = random.Next(2) == 0 ? CrossingPolicy.Split : CrossingPolicy.HigherOf };
        return new Case(seed, blocks, holidays, policy, from, to, Quote(blocks, from, to, policy, holidays));
    }

    private static string Tag(Case c) => $"seed {c.Seed}";

    private static List<DateOnly> Dates(PlanBlock block, DateOnly from, DateOnly to)
    {
        var dates = new List<DateOnly>();
        for (var d = from; d <= to; d = d.AddDays(1))
            if (block.Days.Contains(d.DayOfWeek)) dates.Add(d);
        return dates;
    }

    // ── A catalogue lookup of the test's own ──────────────────────────────────────

    private static readonly Lazy<ILookup<string, SupportCatalogueItem>> CatalogueByCode = new(() => RealCatalogue.ToLookup(r => r.ItemNumber, StringComparer.Ordinal));

    /// <summary>
    /// The catalogue maximum for a line, found without the engine's own resolver or the line's own trace: the one row of the item valid on the service date, at the price
    /// column of the zone the block is delivered in.
    /// </summary>
    private static decimal CatalogueMaximum(Case c, PlannedLine line)
    {
        var zone = c.Blocks.Single(b => b.Id == line.BlockId).Location.Zone;
        var row = Assert.Single(CatalogueByCode.Value[line.ItemCode!], r => r.EffectiveFrom <= line.ServiceDate && (r.EffectiveTo is null || r.EffectiveTo >= line.ServiceDate));
        return (zone switch { PriceZone.Remote => row.PriceRemote, PriceZone.VeryRemote => row.PriceVeryRemote, _ => row.PriceNational })!.Value;
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
        Assert.Contains(AllCases.Value.SelectMany(c => c.Blocks), b => b.Changes.Count >= 5);   // long headcount lists, up to the cap of ten (the old generator made at most two)
        if (ProviderLocalTime.TzDataAvailable)
            Assert.Contains(lines, l => l.Trace.Rules.Contains("clock-change:elapsed-hours"));   // a support over a night the clocks changed
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
                foreach (var date in Dates(block, c.From, c.To))
                {
                    var start = date.ToDateTime(block.Start);
                    var end = start.AddMinutes(block.DurationMinutes);
                    var inside = c.Quote.Lines.Where(l => l.BlockId == block.Id && l.StartLocal is { } s && s >= start && s < end).ToList();
                    var minutes = inside.Sum(l => (l.EndLocal!.Value - l.StartLocal!.Value).TotalMinutes);

                    if (skipped.Contains(date)) { Assert.Equal(0, minutes); continue; }

                    // The wall clock never shows the hour it skips going forward, so a part that lies wholly inside it is no line at all (and the support in it takes no time).
                    var zone = ProviderLocalTime.ResolveZone(StateTimeZoneMap.Resolve(block.Location.State));
                    var missing = Enumerable.Range(0, block.DurationMinutes).Count(m => zone.IsInvalidTime(start.AddMinutes(m)));
                    Assert.True(minutes <= block.DurationMinutes && minutes >= block.DurationMinutes - missing, $"{Tag(c)}, block {block.Id} on {date}: {minutes} wall minutes of {block.DurationMinutes} ({missing} do not exist)");
                    if (missing == 0) Assert.Equal(block.DurationMinutes, minutes);
                }
            }
    }

    [Fact]
    public void Every_priced_hour_costs_the_floor_of_the_maximum_times_workers_over_participants_and_the_total_is_the_floor_of_unit_price_times_hours()
    {
        foreach (var c in AllCases.Value)
            foreach (var line in c.Quote.Lines.Where(l => l.IsPriced && l.Kind is PlannedLineKind.Support or PlannedLineKind.SleepoverActiveHours or PlannedLineKind.Sleepover or PlannedLineKind.WorkerAccommodation))
            {
                var maximum = CatalogueMaximum(c, line);                                          // looked up here, not read from the line's own trace
                Assert.True(maximum == line.Trace.MaximumUnitPrice, $"{Tag(c)}: {line.ItemCode} on {line.ServiceDate} is priced from {line.Trace.MaximumUnitPrice} but the catalogue says {maximum}");
                var maxCents = (long)(maximum * 100m);
                Assert.Equal((decimal)maxCents, maximum * 100m);                                  // a catalogue price has whole cents
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
            var again = Quote(c.Blocks, c.From, c.To, c.Policy, c.Holidays);
            var shuffled = Quote(c.Blocks.Select(b => b with { Days = b.Days.Reverse().ToList() }).ToList(), c.From, c.To, c.Policy,
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
                Assert.Equal(Dates(block, c.From, c.To).Count, total.Occurrences + total.SkippedOccurrences);
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
    public void Every_priced_lines_maximum_is_the_catalogue_price_of_its_item_zone_and_service_date_and_no_unit_price_exceeds_it_for_its_workers_and_participants()
    {
        // Review L7: this was named "never exceeds the catalogue maximum" and only checked that the trace was filled in. The maximum is now looked up independently, for
        // every kind of line, and an hourly unit price is bounded by it with its group arithmetic.
        foreach (var c in AllCases.Value)
            foreach (var line in c.Quote.Lines.Where(l => l.IsPriced))
            {
                var maximum = CatalogueMaximum(c, line);
                Assert.True(maximum == line.Trace.MaximumUnitPrice, $"{Tag(c)}: {line.Kind} {line.ItemCode} on {line.ServiceDate} is priced from {line.Trace.MaximumUnitPrice} but the catalogue says {maximum}");
                if (line.Kind is PlannedLineKind.Support or PlannedLineKind.SleepoverActiveHours or PlannedLineKind.Sleepover or PlannedLineKind.WorkerAccommodation)
                    Assert.True(line.UnitPrice <= maximum * line.Trace.Workers / line.Trace.ParticipantsPresent, $"{Tag(c)}: {line.ItemCode} unit {line.UnitPrice} is above {maximum} x {line.Trace.Workers} / {line.Trace.ParticipantsPresent}");
                else
                    Assert.True(line.UnitPrice <= maximum, $"{Tag(c)}: {line.ItemCode} unit {line.UnitPrice} is above {maximum}");
            }
    }

    [Fact]
    public void Every_line_has_a_positive_quantity_and_no_unit_price_or_total_is_negative()
    {
        // The property the widened generator needed: a headcount change on either side of the hour the clocks skip once made a line of minus half an hour.
        foreach (var c in AllCases.Value)
            foreach (var line in c.Quote.Lines)
            {
                Assert.True(line.Qty > 0m, $"{Tag(c)}: block {line.BlockId} {line.Kind} on {line.ServiceDate} has quantity {line.Qty}");
                Assert.True(line.UnitPrice >= 0m && line.Total >= 0m, $"{Tag(c)}: block {line.BlockId} {line.Kind} on {line.ServiceDate} has unit {line.UnitPrice} and total {line.Total}");
            }
    }

    [Fact]
    public void Every_priced_line_names_its_price_basis_and_a_row_that_started_on_or_before_its_service_date()
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
