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

    private static readonly Guid Ava = Guid.NewGuid(), Ben = Guid.NewGuid();
    private static readonly ImportParticipantMatch[] People =
    [
        new(Ava, "430000001", "Ava", "Stone", new DateOnly(1990, 4, 3)),
        new(Ben, null, "Ben", "Lee", new DateOnly(1985, 1, 2)),
    ];
    private static readonly (Guid, DateOnly, DateOnly)[] NoPlans = [];

    private static List<ImportRowPlan> Checked(IReadOnlyCollection<(Guid, DateOnly, DateOnly)> existing, params string[][] rows)
    {
        var plans = Read(rows);
        ImportFundingRows.Match(plans, People);
        ImportFundingRows.Check(plans, existing);
        return plans;
    }

    [Fact]
    public void Rows_for_one_participant_and_plan_dates_make_one_plan_and_01_to_04_add_into_Core()
    {
        var plans = Checked(NoPlans,
            Line("430000001", "01", "Plan managed", "1000"),
            Line("430 000 001", "Transport", "Plan managed", "250.50"),
            Line("430000001", "15", "NDIA managed", "5000"),
            Line("", "Core", "Self managed", "300", first: "ben", last: " Lee", dob: "02/01/1985"));

        Assert.All(plans, p => Assert.Equal(ImportRowStatus.Ready, p.Status));
        Assert.Equal(new[] { "Ava Stone", "Ava Stone", "Ava Stone", "Ben Lee" }, plans.Select(p => p.Name));
        var made = ImportFundingRows.Plans(plans);
        Assert.Equal(new[] { Ava, Ben }, made.Select(p => p.ParticipantId));
        var ava = made[0].Plan;
        Assert.Equal((BudgetEvidenceSource.Other, (int?)null, new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30)), (ava.Evidence!.Value, ava.PeriodLengthMonths, ava.PlanStart!.Value, ava.PlanEnd!.Value));
        Assert.Equal(
            new[] { (FundingPoolKind.CoreFlexible, 0, PlanType.PlanManaged, 1250.50m), (FundingPoolKind.Stated, 15, PlanType.AgencyManaged, 5000m) },
            ava.Pools!.Select(p => (p.Kind!.Value, p.PaceCategory, p.ManagementType!.Value, p.Periods!.Single().PlanAmount!.Value)));
        Assert.All(ava.Pools!, p => Assert.Equal((new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30)), (p.Periods![0].PeriodStart!.Value, p.Periods[0].PeriodEnd!.Value)));
        Assert.Equal("Categories 01 to 04 are one Core (flexible) pool in ODIP: this plan's plan-managed Core comes to $1,250.50.", plans[0].Warnings.Single());
        Assert.Equal(plans[0].Warnings, plans[1].Warnings);
        Assert.Empty(plans[2].Warnings);
        Assert.Empty(plans[3].Warnings);
    }

    [Fact]
    public void A_known_NDIS_number_on_a_row_naming_someone_else_imports_with_a_warning()
    {
        var plans = Checked(NoPlans,
            Line("430000001", "Core", "Self managed", "100", first: "Ben", last: "Lee"),
            Line("430000001", "15", "Self managed", "100", first: "ava", last: "STONE", dob: "01/01/1980"));

        Assert.All(plans, p => Assert.Equal(ImportRowStatus.Ready, p.Status));
        Assert.Equal("The file names Ben Lee for this NDIS number, which is Ava Stone in ODIP. Check the number.", plans[0].Warnings.Single());
        Assert.Equal("The file's date of birth for this NDIS number isn't Ava Stone's in ODIP. Check the number.", plans[1].Warnings.Single());
    }

    [Fact]
    public void An_NDIS_number_that_matches_nobody_is_refused_and_never_falls_back_to_the_name()
    {
        var plans = Checked(NoPlans,
            Line("430000009", "Core", "Self managed", "100", first: "Ava", last: "Stone", dob: "03/04/1990"),
            Line("", "Core", "Self managed", "100", first: "Cal", last: "Wu", dob: "01/01/1980"));

        Assert.Equal("No participant in ODIP has this NDIS number. Import or add them first.", plans[0].Reasons.Single());
        Assert.Equal("No participant in ODIP has this name and date of birth. Import or add them first.", plans[1].Reasons.Single());
    }

    [Fact]
    public void Two_participants_with_the_same_name_and_birthday_need_the_NDIS_number()
    {
        var plans = Read(Line("", "Core", "Self managed", "100", first: "Jo", last: "Ng", dob: "01/01/2000"));
        ImportFundingRows.Match(plans, [new(Guid.NewGuid(), null, "Jo", "Ng", new DateOnly(2000, 1, 1)), new(Guid.NewGuid(), null, "JO", "NG", new DateOnly(2000, 1, 1))]);
        Assert.Equal("2 participants in ODIP have this name and date of birth. Add their NDIS number to the row.", plans.Single().Reasons.Single());
    }

    [Fact]
    public void One_bad_row_refuses_every_row_of_its_plan()
    {
        var plans = Checked(NoPlans,
            Line("430000001", "Core", "Plan managed", "1000"),
            Line("430000001", "15", "Plan managed", "lots"),
            Line("430000001", "18", "Self managed", "100"),
            Line("", "Core", "Self managed", "300", first: "Ben", last: "Lee", dob: "02/01/1985"));

        Assert.Equal(new[] { ImportRowStatus.Invalid, ImportRowStatus.Invalid, ImportRowStatus.Skipped, ImportRowStatus.Ready }, plans.Select(p => p.Status));
        Assert.Equal("Row 3 of this plan can't be imported, so the whole plan is left out.", plans[0].Reasons.Single());
        Assert.Equal("Amount must be a number of dollars, like 12500.00.", plans[1].Reasons.Single());
        Assert.Equal(Ben, ImportFundingRows.Plans(plans).Single().ParticipantId);
    }

    [Fact]
    public void A_row_whose_plan_dates_cant_be_read_keeps_that_participants_plans_out()
    {
        var plans = Checked(NoPlans,
            Line("430000001", "Core", "Plan managed", "1000"),
            Line("430000001", "15", "Plan managed", "500", end: "31/02/2027"),
            Line("", "Core", "Self managed", "300", first: "Ben", last: "Lee", dob: "02/01/1985"));

        Assert.Equal("Row 3 for this participant can't be imported, so their plans in this file are left out.", plans[0].Reasons.Single());
        Assert.Equal("Plan end isn't a real date.", plans[1].Reasons.Single());
        Assert.Equal(Ben, ImportFundingRows.Plans(plans).Single().ParticipantId);
    }

    [Fact]
    public void Core_as_a_total_and_as_categories_in_one_plan_is_refused_not_added_twice()
    {
        var plans = Checked(NoPlans,
            Line("430000001", "Core", "Plan managed", "1000"),
            Line("430000001", "01", "Plan managed", "600"),
            Line("430000001", "01", "Self managed", "50"));

        Assert.Equal("Row 2 gives Core for this plan too. Give Core as one amount, or as categories 01 to 04, not both.", plans[1].Reasons.Single());
        Assert.Equal("Row 3 of this plan can't be imported, so the whole plan is left out.", plans[0].Reasons.Single());
        Assert.Equal(ImportRowStatus.Invalid, plans[2].Status);
        Assert.Empty(ImportFundingRows.Plans(plans));
    }

    [Fact]
    public void The_same_category_and_management_twice_in_one_plan_is_refused()
    {
        var plans = Checked(NoPlans, Line("430000001", "15", "Plan managed", "100"), Line("430000001", "15", "Plan-managed", "200"));
        Assert.Equal("Row 2 has the same category and management for this plan.", plans[1].Reasons.Single());
        Assert.Empty(ImportFundingRows.Plans(plans));
    }

    [Fact]
    public void A_plan_that_overlaps_one_already_in_ODIP_is_refused_not_replaced()
    {
        var plans = Checked([(Ava, new DateOnly(2026, 1, 1), new DateOnly(2026, 7, 1))], Line("430000001", "Core", "Plan managed", "1000"));
        Assert.Equal("This participant already has a plan in ODIP from 1 Jan 2026 to 1 Jul 2026, which overlaps these dates. Change that plan on their Funding tab, or leave these rows out.",
            plans.Single().Reasons.Single());
    }

    [Fact]
    public void A_plan_that_overlaps_an_earlier_plan_in_the_file_is_refused()
    {
        var plans = Checked(NoPlans,
            Line("430000001", "Core", "Plan managed", "1000"),
            Line("430000001", "Core", "Plan managed", "800", start: "01/01/2027", end: "31/12/2027"),
            Line("430000001", "Core", "Plan managed", "900", start: "01/07/2027", end: "30/06/2028"));

        Assert.Equal(ImportRowStatus.Ready, plans[0].Status);
        Assert.Equal("This plan overlaps the plan on row 2 for the same participant.", plans[1].Reasons.Single());
        // Row 4 overlaps only the refused plan on row 3, so it stands.
        Assert.Equal(ImportRowStatus.Ready, plans[2].Status);
        Assert.Equal(2, ImportFundingRows.Plans(plans).Count);
    }

    [Fact]
    public void The_plan_screens_validator_has_the_last_word() =>
        Assert.Equal("The plan runs 1096 days. A plan can be at most 800 days long.",
            Checked(NoPlans, Line("430000001", "Core", "Plan managed", "1000", end: "30/06/2029")).Single().Reasons.Single());
}
