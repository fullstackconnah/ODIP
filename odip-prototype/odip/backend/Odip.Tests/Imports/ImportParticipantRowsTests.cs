using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportParticipantRowsTests
{
    private static readonly string[] Headers =
        ["First name", "Last name", "Date of birth", "Gender", "NDIS number", "Postcode", "State", "Contact 1 name", "Contact 1 relationship"];

    private static List<ImportRowPlan> Build(params string[][] rows)
    {
        var table = new ImportTable(Headers, rows.Select((cells, i) => new ImportRow(i + 2, cells)).ToList());
        return ImportParticipantRows.Build(table, ImportFields.AutoMatch(ImportKind.Participants, Headers), new DateOnly(2026, 10, 13));
    }

    [Fact]
    public void A_complete_row_is_ready_with_its_dto()
    {
        var plan = Build(["Ava", "Stone", "03/04/1990", "female", "430 000 001", "2000", "nsw", "Ben Stone", "Next of kin"]).Single();

        Assert.Equal(ImportRowStatus.Ready, plan.Status);
        Assert.Equal("Ava Stone", plan.Name);
        Assert.Equal("430000001", plan.DuplicateKey);
        var dto = plan.Participant!;
        Assert.Equal((new DateOnly(1990, 4, 3), Gender.Female, "NSW", "2000", "430 000 001"), (dto.DateOfBirth!.Value, dto.Gender!.Value, dto.AddressState, dto.AddressPostcode, dto.NdisNumber));
        var contact = Assert.Single(dto.ContactRoles);
        Assert.Equal(("Ben", "Stone", ContactRoleType.NextOfKin), (contact.NewPersonFirstName, contact.NewPersonLastName, contact.RoleType));
        Assert.False(dto.IsDraft);
    }

    [Fact]
    public void Every_reason_is_listed_in_plain_words()
    {
        var plan = Build(["", "Stone", "31/02/1990", "robot", "", "12345", "Narnia", "", "Guardian"]).Single();

        Assert.Equal(ImportRowStatus.Invalid, plan.Status);
        Assert.Contains("Date of birth isn't a real date.", plan.Reasons);
        Assert.Contains("Gender must be Male, Female, Non-binary or Prefer not to say.", plan.Reasons);
        Assert.Contains("State must be NSW, VIC, QLD, SA, WA, TAS, NT or ACT.", plan.Reasons);
        Assert.Contains("Contact 1 needs a name.", plan.Reasons);
        Assert.Contains("First name is required.", plan.Reasons);
        Assert.Contains("Postcode must be exactly 4 digits.", plan.Reasons);
    }

    [Fact]
    public void A_month_first_date_column_refuses_every_slash_date_in_it()
    {
        var plans = Build(
            ["Ava", "Stone", "04/23/1990", "", "", "", "", "", ""],
            ["Ben", "Lee", "03/04/1991", "", "", "", "", "", ""],
            ["Cal", "Wu", "1991-04-03", "", "", "", "", "", ""]);

        Assert.Equal(new[] { ImportRowStatus.Invalid, ImportRowStatus.Invalid, ImportRowStatus.Ready }, plans.Select(p => p.Status));
        Assert.All(plans.Take(2), p => Assert.StartsWith("Date of birth: this column has month-first dates", p.Reasons.Single()));
    }

    [Fact]
    public void A_plan_manager_contact_is_dropped_with_a_warning_and_the_participant_stays_ready()
    {
        var plan = Build(["Ava", "Stone", "", "", "", "", "", "Pat Manager", "Plan manager"]).Single();

        Assert.Equal(ImportRowStatus.Ready, plan.Status);
        Assert.Empty(plan.Participant!.ContactRoles);
        Assert.Equal("Contact 1 won't be imported: a plan manager needs Plan type to be Plan managed.", plan.Warnings.Single());
    }

    [Fact]
    public void A_plan_nominee_for_a_child_is_refused_by_the_manual_rule()
    {
        var plan = Build(["Ava", "Stone", "01/01/2015", "", "", "", "", "Kim Stone", "Plan nominee"]).Single();
        Assert.Contains("Contact 1: Plan Nominee is not available for a participant under 18 — use Child Representative instead.", plan.Reasons);
    }

    [Fact]
    public void Gender_other_is_refused_because_its_self_description_is_not_imported()
    {
        var plan = Build(["Ava", "Stone", "", "Other", "", "", "", "", ""]).Single();
        Assert.Equal("Gender: Other needs a self-description, which the import can't take. Leave the cell blank and add it on the participant's profile.", plan.Reasons.Single());
    }

    [Fact]
    public void The_template_example_row_is_skipped()
    {
        var plan = Build([ImportParticipantRows.ExampleFirstName, ImportParticipantRows.ExampleLastName, "", "", "", "", "", "", ""]).Single();
        Assert.Equal((ImportRowStatus.Skipped, "This is the template's example row."), (plan.Status, plan.SkipReason));
    }

    [Fact]
    public void Lengths_the_API_would_refuse_are_reasons()
    {
        var plan = Build([new string('a', 101), "Stone", "", "", new string('9', 21), "", "", "", ""]).Single();
        Assert.Contains("First name is longer than 100 characters.", plan.Reasons);
        Assert.Contains("NDIS number is longer than 20 characters.", plan.Reasons);
    }

    [Fact]
    public void Rows_with_the_same_NDIS_number_in_one_file()
    {
        var plans = Build(
            ["Ava", "Stone", "", "", "430000001", "", "", "", ""],
            ["Ava", "Stone", "", "", "430 000 001", "", "", "", ""]);
        ImportRowPlan.MarkFileDuplicates(plans, "NDIS number");

        Assert.Equal(ImportRowStatus.Ready, plans[0].Status);
        Assert.Equal((ImportRowStatus.Invalid, "The same NDIS number is on row 2."), (plans[1].Status, plans[1].Reasons.Single()));
    }

    [Fact]
    public void Placeholder_NDIS_cells_are_not_keys_and_carry_a_warning()
    {
        var plans = Build(
            ["Ava", "Stone", "", "", "N/A", "", "", "", ""],
            ["Ben", "Stone", "", "", "N/A", "", "", "", ""],
            ["Cy", "Stone", "", "", "TBC", "", "", "", ""]);
        ImportRowPlan.MarkFileDuplicates(plans, "NDIS number");

        Assert.All(plans, p =>
        {
            Assert.Equal(ImportRowStatus.Ready, p.Status);
            Assert.Null(p.DuplicateKey);
            Assert.Equal("NDIS number isn't 9 digits, so it wasn't used to match anyone.", Assert.Single(p.Warnings));
        });
        Assert.Equal("N/A", plans[0].Participant!.NdisNumber);
    }

    [Fact]
    public void A_real_NDIS_number_has_no_warning()
    {
        var plan = Build(["Ava", "Stone", "", "", "430 000 001", "", "", "", ""]).Single();
        Assert.Empty(plan.Warnings);
    }

    private static readonly string[] PlanHeaders = ["First name", "Last name", "Plan type", "Plan start", "Plan end", "Contact 1 name", "Contact 1 relationship"];

    private static ImportRowPlan BuildOne(string[] headers, string[] cells) =>
        ImportParticipantRows.Build(new ImportTable(headers, [new ImportRow(2, cells)]), ImportFields.AutoMatch(ImportKind.Participants, headers), new DateOnly(2026, 10, 13)).Single();

    [Fact]
    public void The_plan_type_and_dates_reach_the_dto_and_a_plan_managed_participant_keeps_their_plan_manager()
    {
        var plan = BuildOne(PlanHeaders, ["Ava", "Stone", "Plan-managed", "01/07/2026", "2027-06-30", "Pat Manager", "Plan manager"]);

        Assert.Equal(ImportRowStatus.Ready, plan.Status);
        Assert.Empty(plan.Warnings);
        var dto = plan.Participant!;
        Assert.Equal((PlanType.PlanManaged, new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30)), (dto.PlanType, dto.PlanStartDate!.Value, dto.PlanEndDate!.Value));
        Assert.Equal(ContactRoleType.PlanManager, Assert.Single(dto.ContactRoles).RoleType);
    }

    [Fact]
    public void A_plan_manager_for_a_participant_whose_plan_type_is_not_plan_managed_is_refused_by_the_manual_rule()
    {
        var plan = BuildOne(PlanHeaders, ["Ava", "Stone", "Self managed", "", "", "Pat Manager", "Plan manager"]);
        Assert.Equal("Contact 1: Plan Manager contacts are only available for plan-managed participants.", plan.Reasons.Single());
    }

    [Fact]
    public void The_plan_columns_are_optional_but_what_is_given_must_be_right()
    {
        var blank = BuildOne(PlanHeaders, ["Ava", "Stone", "", "", "", "", ""]);
        Assert.Equal((ImportRowStatus.Ready, PlanType.SelfManaged), (blank.Status, blank.Participant!.PlanType));
        var plan = BuildOne(PlanHeaders, ["Ava", "Stone", "Family managed", "30/06/2027", "01/07/2026", "", ""]);
        Assert.Equal(new[] { "Plan end is before Plan start.", "Plan type must be Self managed, Plan managed or NDIA managed." }, plan.Reasons.OrderBy(r => r, StringComparer.Ordinal));
    }

    [Fact]
    public void A_month_first_plan_start_column_refuses_its_slash_dates()
    {
        string[] headers = ["First name", "Last name", "Plan start"];
        var table = new ImportTable(headers, [new ImportRow(2, ["Ava", "Stone", "07/31/2026"]), new ImportRow(3, ["Ben", "Lee", "01/07/2026"])]);
        var plans = ImportParticipantRows.Build(table, ImportFields.AutoMatch(ImportKind.Participants, headers), new DateOnly(2026, 10, 13));
        Assert.All(plans, p => Assert.StartsWith("Plan start: this column has month-first dates", p.Reasons.Single()));
    }
}
