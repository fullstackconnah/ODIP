using System.Text.Json;
using Odip.Api.Serialization;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
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

    private static string AsTheApiSendsIt(PlanQuote quote)
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true };
        ApiJsonOptions.Configure(options);
        return JsonSerializer.Serialize(quote, options).Replace("\r\n", "\n") + "\n";
    }

    private static void MatchesFile(string fileName, PlanQuote quote)
    {
        var directory = FixtureDirectory();
        Skip.If(directory is null, "There is no frontend beside the backend here (the backend image): nothing to compare the quote with.");
        var path = Path.Combine(directory!, fileName);
        var actual = AsTheApiSendsIt(quote);

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
}
