using System.Text.Json;
using Odip.Api.Serialization;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The quotes the plan builder's frontend tests read, written by the engine and nothing else. The screen's tests used to build their quotes by hand, and a hand-made quote holds what its author
/// believed the engine says: one issue for every date, a message with the date in it, counts that mean something else. The engine keeps one issue for each block, reason and message with the shifts
/// it was met on, and its text never carries a date, so the frontend (which counts and groups them) was tested against a shape the engine does not produce (review F11).
///
/// Each test prices a scenario against the real 2026-27 catalogue, serialises it as the API does (<see cref="ApiJsonOptions"/>), and compares it with the file the frontend imports from
/// <c>frontend/src/test/fixtures/golden</c>. If the engine changes what it says, this fails and says how to rewrite the file; the frontend's tests then run against the new quote.
/// Regenerate: <c>ODIP_REGENERATE_GOLDEN=1 dotnet test --filter PlanQuoteFrontendFixtureTests</c>, then run the frontend tests. A build that has no frontend beside the backend (the backend image)
/// skips them.
/// </summary>
public class PlanQuoteFrontendFixtureTests
{
    private const string RegenerateVariable = "ODIP_REGENERATE_GOLDEN";

    private static string? FixtureDirectory()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) return null;
            dir = parent;
        }
        if (dir is null) return null;
        var frontend = Path.GetFullPath(Path.Combine(dir, "..", "frontend", "src", "test", "fixtures"));
        return Directory.Exists(frontend) ? Path.Combine(frontend, "golden") : null;
    }

    private static string AsTheApiSendsIt(PlanQuote quote) => Written(quote);

    private static void MatchesFile(string fileName, PlanQuote quote) => MatchesText(fileName, AsTheApiSendsIt(quote));

    private static void MatchesText(string fileName, string actual)
    {
        var directory = FixtureDirectory();
        Skip.If(directory is null, "There is no frontend beside the backend here (the backend image): nothing to compare the quote with.");
        var path = Path.Combine(directory!, fileName);

        if (Environment.GetEnvironmentVariable(RegenerateVariable) == "1")
        {
            Directory.CreateDirectory(directory!);
            File.WriteAllText(path, actual);
            return;
        }

        Assert.True(File.Exists(path), $"{fileName} is missing: run once with {RegenerateVariable}=1 to write it.");
        var committed = File.ReadAllText(path).Replace("\r\n", "\n");
        Assert.True(committed == actual, $"The engine's quote is no longer the one frontend/src/test/fixtures/golden/{fileName} holds. If the change is meant, run `{RegenerateVariable}=1 dotnet test --filter PlanQuoteFrontendFixtureTests` and then the frontend tests, which read the file.");
    }

    private static PlanBlock Weekdays(string id, PlanSupportType type, TimeOnly start, TimeOnly end, Func<PlanBlock, PlanBlock>? change = null) =>
        Block(id, type, DayOfWeek.Monday, start, end, block => (change is null ? block : change(block)) with
        {
            Days = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday },
        });

    /// <summary>
    /// The brief's block (community access, Monday and Wednesday 09:00 to 13:00) over the first two weeks of October 2026, with NSW's Labour Day on Monday 5 October: a priced plan with one
    /// public holiday still to decide, the registration notice, and the lines the Review step groups.
    /// </summary>
    [SkippableFact]
    public void The_brief_block_over_a_fortnight_with_a_public_holiday_is_the_quote_the_review_tests_read()
    {
        var block = Block("b1", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

        var quote = Quote(new[] { block }, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 14), holidays: new[] { NswLabourDay });

        MatchesFile("plan-quote-brief-fortnight.json", quote);
    }

    /// <summary>
    /// A block that runs from 05:00 to 08:00 on weekdays with a vehicle: each shift has a part with no catalogue item (the hour before six), so the engine gives ONE issue counting the ten shifts,
    /// ten lines that are not priced ("No item"), and the priced support and transport lines beside them.
    /// </summary>
    [SkippableFact]
    public void A_weekday_dawn_block_with_a_vehicle_is_the_quote_the_no_item_tests_read()
    {
        var block = Weekdays("b1", PlanSupportType.CommunityAccess, T(5), T(8), b => b with { Transport = new PlanActivityTransport { Vehicle = VehicleKind.Standard, Km = 20m } });

        var quote = Quote(new[] { block }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 16));

        MatchesFile("plan-quote-no-item-dawn.json", quote);
    }

    /// <summary>
    /// A personal care block that asks for activity-based transport and accommodation nights, neither of which goes with personal care: each shift has two parts that cannot be priced, so the engine
    /// gives two issues (one for each), each counting the same ten shifts. A person reads that as ten shifts with a part not priced, not twenty.
    /// </summary>
    [SkippableFact]
    public void A_block_asking_for_two_things_its_support_type_has_no_item_for_is_the_quote_the_issue_grouping_tests_read()
    {
        var block = Weekdays("b1", PlanSupportType.PersonalCare, T(9), T(12), b => b with
        {
            Transport = new PlanActivityTransport { Vehicle = VehicleKind.Standard, Km = 20m },
            Accommodation = new PlanAccommodation { Nights = 1 },
        });

        var quote = Quote(new[] { block }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 16));

        MatchesFile("plan-quote-two-issues-same-shifts.json", quote);
    }

    private static string Written(object value)
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true };
        ApiJsonOptions.Configure(options);
        return JsonSerializer.Serialize(value, options).Replace("\r\n", "\n") + "\n";
    }

    /// <summary>
    /// The one week the mock API's plan pricing is held to (mockMoneyParity.test.ts): a daytime community access block on Labour Day, a personal care sleepover across midnight, a personal care
    /// block of 8 hours by day whose worker may sleep (not a sleepover, priced hourly) and a high intensity block (the 0104 items). The file holds the request as well as the quote, so the mock is run on
    /// exactly what the engine was given. To refresh: ODIP_REGENERATE_GOLDEN=1 dotnet test --filter PlanQuoteFrontendFixtureTests.
    /// </summary>
    [SkippableFact]
    public void A_week_with_a_sleepover_a_daytime_eight_hours_high_intensity_and_a_holiday_is_the_quote_the_mock_is_held_to()
    {
        var blocks = new List<PlanBlock>
        {
            Block("holiday", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13)),
            Block("sleepover", PlanSupportType.PersonalCare, DayOfWeek.Wednesday, T(22), T(7), b => b with { WorkerMaySleep = true }),
            Block("eight-by-day", PlanSupportType.PersonalCare, DayOfWeek.Tuesday, T(9), T(17), b => b with { WorkerMaySleep = true }),
            Block("high", PlanSupportType.PersonalCare, DayOfWeek.Thursday, T(9), T(12), b => b with { Intensity = SupportIntensity.HighIntensity }),
        };
        // One block for every family, intensity and band, so each price the mock holds is read back from the engine: Monday is Labour Day, Tuesday carries the weekday bands, then Saturday and Sunday.
        foreach (var type in new[] { PlanSupportType.PersonalCare, PlanSupportType.CommunityAccess, PlanSupportType.GroupActivity, PlanSupportType.StaSupport })
        foreach (var intensity in new[] { SupportIntensity.Standard, SupportIntensity.HighIntensity })
        {
            var shapes = new (string Name, DayOfWeek Day, TimeOnly Start, TimeOnly End)[]
            {
                ("holiday", DayOfWeek.Monday, T(10), T(12)), ("day", DayOfWeek.Tuesday, T(10), T(12)), ("evening", DayOfWeek.Tuesday, T(20), T(22)), ("night", DayOfWeek.Tuesday, T(2), T(5)),
                ("saturday", DayOfWeek.Saturday, T(10), T(12)), ("sunday", DayOfWeek.Sunday, T(10), T(12)),
            };
            foreach (var shape in shapes)
                blocks.Add(Block($"{type}-{intensity}-{shape.Name}", type, shape.Day, shape.Start, shape.End, b => b with { Intensity = intensity }));
        }
        // The sleepover items: one Friday 22:00-07:00 block with a worker who may sleep, for personal care and STA support only. Community access and group activities have no sleepover item, so they get no such block here (the mock still prices them, see the report).
        foreach (var type in new[] { PlanSupportType.PersonalCare, PlanSupportType.StaSupport })
            blocks.Add(Block($"{type}-sleepover", type, DayOfWeek.Friday, T(22), T(7), b => b with { WorkerMaySleep = true }));
        var (from, to) = (Mon5Oct, new DateOnly(2026, 10, 11));

        var quote = Quote(blocks, from, to, holidays: new[] { NswLabourDay });

        MatchesText("plan-quote-mock-parity.json", Written(new { request = new { blocks, periodFrom = from, periodTo = to }, quote }));
    }

    /// <summary>
    /// The ledger states on the 80% line (mockMoneyParity.test.ts): 1,024.12 used of 1,280.15 available is exactly 80% (80 x 1,280.15 = 102,412 = 100 x 1,024.12), so it is Approaching; one cent less is On
    /// track. A double says 102411.99999999999 for the first and On track. Each state also holds what the roster check (ShiftBudgetAssessor) says of the same figures: the percentage in its Approaching
    /// finding, or null when it raises none.
    /// </summary>
    [SkippableFact]
    public void A_pool_used_to_eighty_percent_and_one_cent_under_are_the_ledgers_the_mock_is_held_to()
    {
        var today = new DateOnly(2026, 10, 4);
        object State(decimal claimed)
        {
            var period = new FundingPeriod { Id = Guid.NewGuid(), Position = 0, PeriodStart = new DateOnly(2026, 7, 1), PeriodEnd = new DateOnly(2027, 6, 30), PlanAmount = 1280.15m };
            var pool = new FundingPool { Id = Guid.NewGuid(), Position = 0, Kind = FundingPoolKind.CoreFlexible, PaceCategory = 0, ManagementType = PlanType.PlanManaged, Name = "Core (flexible)", Periods = new List<FundingPeriod> { period } };
            var plan = new FundingPlan { Id = Guid.NewGuid(), PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30), Pools = new List<FundingPool> { pool } };
            var item = new LedgerItem
            {
                Kind = LedgerRowKind.ClaimLine, Group = LedgerGroup.Claimed, Date = new DateOnly(2026, 8, 3), Amount = claimed, PaceCategory = 4, PlanType = PlanType.PlanManaged, Id = Guid.NewGuid(), Description = "claimed",
            };
            var current = BudgetLedgerCalculator.Compute(plan, today, 80, new[] { item }).Pools[0].Periods.Single();
            var figures = new BudgetFindingFigures("Core (flexible)", period.PeriodStart, period.PeriodEnd, current.Available, current.Used, current.Forecast, 0m);
            var approaching = ShiftBudgetAssessor.Assess(figures, new ShiftBudgetContext(BudgetLimitMode.Warn, 80, true, true, false)).SingleOrDefault(f => f.Code == BudgetFindingCodes.Approaching);
            int? rosterPercent = approaching is null ? null : int.Parse(System.Text.RegularExpressions.Regex.Match(approaching.Message, @"at ([0-9]+)%").Groups[1].Value);
            return new
            {
                input = new { planAmount = period.PlanAmount, claimed, approachingPercent = 80, today },
                expected = new { available = current.Available, used = current.Used, forecast = current.Forecast, status = current.Status, rosterApproachingPercent = rosterPercent },
            };
        }

        MatchesText("budget-ledger-mock-parity.json", Written(new { states = new[] { State(1024.12m), State(1024.11m) } }));
    }
}
