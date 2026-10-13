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
        Assert.Equal("Contact 1 won't be imported: a plan manager needs a plan-managed participant, and the plan type isn't imported.", plan.Warnings.Single());
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
}
