using System.Globalization;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportFundingRowsTests
{
    private static readonly string[] Headers = ["NDIS number", "First name", "Last name", "Date of birth", "Plan start", "Plan end", "Support category", "Managed by", "Amount"];

    private static List<ImportRowPlan> Read(params string[][] rows) =>
        ImportFundingRows.Build(new ImportTable(Headers, rows.Select((cells, i) => new ImportRow(i + 2, cells)).ToList()), ImportFields.AutoMatch(ImportKind.FundingPlans, Headers));

    private static string[] Line(string ndis, string category, string management, string amount, string start = "01/07/2026", string end = "30/06/2027",
        string first = "", string last = "", string dob = "") => [ndis, first, last, dob, start, end, category, management, amount];

    [Fact]
    public void A_complete_row_is_read_into_its_line()
    {
        var plan = Read(["430 000 001", "Ava", "Stone", "", "01/07/2026", "2027-06-30", "01", "Plan-managed", "$12,500.50"]).Single();

        Assert.Equal(ImportRowStatus.Ready, plan.Status);
        Assert.Equal(new ImportFundingLine("430000001", "Ava Stone", null, new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30), 1, PlanType.PlanManaged, 12500.50m), plan.Funding);
    }

    [Theory]
    [InlineData("Core", 0)]
    [InlineData("core supports", 0)]
    [InlineData("Core (flexible)", 0)]
    [InlineData("1", 1)]
    [InlineData("04", 4)]
    [InlineData("15", 15)]
    [InlineData("Improved Daily Living Skills", 15)]
    [InlineData("assistance with daily life", 1)]
    public void The_category_is_a_number_a_name_or_Core(string text, int expected) =>
        Assert.Equal(expected, Read(Line("430000001", text, "Self managed", "100")).Single().Funding!.Category);

    [Fact]
    public void Every_reason_is_listed_in_plain_words()
    {
        var plan = Read(["", "Ava", "", "", "", "31/02/2027", "Holidays", "Family", "-5"]).Single();

        Assert.Equal(ImportRowStatus.Invalid, plan.Status);
        Assert.Equal(new[]
        {
            "Amount can't be negative.",
            "Give the participant's NDIS number, or their first name, last name and date of birth.",
            "Managed by must be Self managed, Plan managed or NDIA managed.",
            "Plan end isn't a real date.",
            "Plan start is required.",
            "Support category must be a number from 01 to 21, a category name, or Core.",
        }, plan.Reasons.OrderBy(r => r, StringComparer.Ordinal));
        Assert.Null(plan.Funding);
    }

    [Theory]
    [InlineData("12500", "12500")]
    [InlineData("12,500.5", "12500.5")]
    [InlineData("$ 12,500.00", "12500")]
    public void An_amount_reads_as_Excel_or_a_person_writes_it(string text, string expected) =>
        Assert.Equal((decimal?)decimal.Parse(expected, CultureInfo.InvariantCulture), Read(Line("430000001", "Core", "Self managed", text)).Single().Funding!.Amount);

    [Theory]
    [InlineData("", "Amount is required.")]
    [InlineData("twelve", "Amount must be a number of dollars, like 12500.00.")]
    [InlineData("12500,50", "Amount: use a dot for cents, and commas only between thousands, like 12,500.00.")]
    [InlineData("1,5", "Amount: use a dot for cents, and commas only between thousands, like 12,500.00.")]
    [InlineData("10.005", "Amount is in dollars and cents: at most two decimal places.")]
    [InlineData("100000000", "Amount can be at most $99,999,999.99.")]
    public void A_wrong_amount_is_refused(string text, string reason) =>
        Assert.Equal(reason, Read(Line("430000001", "Core", "Self managed", text)).Single().Reasons.Single());

    [Fact]
    public void A_row_that_cant_be_imported_still_knows_its_plan_so_it_can_keep_the_plan_out()
    {
        var plan = Read(Line("430000001", "Core", "Self managed", "lots")).Single();
        Assert.Equal((ImportRowStatus.Invalid, "430000001", (decimal?)null), (plan.Status, plan.Funding!.NdisKey, plan.Funding.Amount));
    }

    [Fact]
    public void Recurring_transport_and_the_template_example_are_skipped()
    {
        var plans = Read(
            Line("430000001", "18", "Self managed", "900"),
            Line("430000000", "Core", "Plan managed", "45000.00", first: ImportParticipantRows.ExampleFirstName, last: ImportParticipantRows.ExampleLastName, dob: "03/04/1990"));

        Assert.Equal(new[] { ImportRowStatus.Skipped, ImportRowStatus.Skipped }, plans.Select(p => p.Status));
        Assert.Equal("Recurring Transport (18) is paid to the participant and never claimed by providers, so ODIP doesn't record it.", plans[0].SkipReason);
        Assert.Equal("This is the template's example row.", plans[1].SkipReason);
    }

    [Fact]
    public void Plan_end_before_plan_start_is_refused_on_the_row() =>
        Assert.Equal("Plan end is before Plan start.", Read(Line("430000001", "Core", "Self managed", "100", start: "30/06/2027", end: "01/07/2026")).Single().Reasons.Single());

    [Fact]
    public void A_name_and_date_of_birth_stand_in_for_a_missing_NDIS_number()
    {
        var plan = Read(Line("", "Core", "Self managed", "100", first: "Ava", last: " Stone", dob: "03/04/1990")).Single();
        Assert.Null(plan.Funding!.NdisKey);
        Assert.Equal(("Ava  Stone", (DateOnly?)new DateOnly(1990, 4, 3), "ava stone|1990-04-03"), (plan.Funding.FullName, plan.Funding.DateOfBirth, plan.DuplicateKey));
    }
}
