using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportStaffRowsTests
{
    private static readonly string[] Headers = ["First name", "Last name", "Email", "Mobile", "Role", "Position", "First aid", "First aid expiry"];

    private static List<ImportRowPlan> Build(params string[][] rows) =>
        ImportStaffRows.Build(new ImportTable(Headers, rows.Select((cells, i) => new ImportRow(i + 2, cells)).ToList()), ImportFields.AutoMatch(ImportKind.Staff, Headers));

    [Fact]
    public void A_complete_row_is_ready_with_its_dto_and_a_normalised_key()
    {
        var plan = Build(["Jo", "Ng", " Jo.Ng@Own.Example.com ", "0412 345 678", "coordinator", "Team leader", "yes", "30/06/2027"]).Single();
        Assert.Equal(ImportRowStatus.Ready, plan.Status);
        Assert.Equal("jo.ng@own.example.com", plan.DuplicateKey);
        var dto = plan.Staff!;
        Assert.Equal((UserRole.Coordinator, Position.TeamLeader, true, new DateOnly(2027, 6, 30)), (dto.Role, dto.Position, dto.IsFirstAidQualified, dto.FirstAidExpiryDate!.Value));
    }

    [Fact]
    public void A_blank_role_is_a_support_worker_and_admin_roles_are_refused()
    {
        Assert.Equal(UserRole.SupportWorker, Build(["Jo", "Ng", "jo@own.example.com", "", "", "", "", ""]).Single().Staff!.Role);
        var plan = Build(["Jo", "Ng", "jo@own.example.com", "", "Administrator", "", "", ""]).Single();
        Assert.Equal("Admin can't be given through an import. Import them with another role, then change it on the Staff page.", plan.Reasons.Single());
    }

    [Fact]
    public void Staff_preview_refuses_a_mobile_the_database_cannot_hold()
    {
        var plan = Build(["Jo", "Ng", "jo@own.example.com", new string('1', 21), "", "", "", ""]).Single();
        Assert.Equal("Mobile is longer than 20 characters.", plan.Reasons.Single());
        Assert.Equal(ImportRowStatus.Ready, Build(["Jo", "Ng", "jo@own.example.com", new string('1', 20), "", "", "", ""]).Single().Status);
    }

    [Fact]
    public void Required_fields_and_bad_values_are_listed()
    {
        var plan = Build(["", "Ng", "not-an-email", "", "boss", "", "maybe", "04/23/2027"]).Single();
        Assert.Contains("First name is required.", plan.Reasons);
        Assert.Contains("Email isn't a valid email address.", plan.Reasons);
        Assert.Contains("Role must be Support worker, Coordinator or Read only.", plan.Reasons);
        Assert.Contains("First aid must be yes or no.", plan.Reasons);
        Assert.Contains(plan.Reasons, r => r.StartsWith("First aid expiry: this column has month-first dates"));
    }

    [Fact]
    public void The_template_example_row_is_skipped()
    {
        var plan = Build([ImportParticipantRows.ExampleFirstName, ImportParticipantRows.ExampleLastName, "example@example.com", "", "", "", "", ""]).Single();
        Assert.Equal((ImportRowStatus.Skipped, "This is the template's example row."), (plan.Status, plan.SkipReason));
    }
}
