using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>H41-1: a Plan managed participant is billed to the plan manager on the Contacts tab (an active PlanManager contact role), not to themselves.</summary>
[Collection(InvoicePdfs.Name)]
public class InvoiceBillToRoleTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static void AddRole(InvoiceKit kit, Participant p, string first, string organisation, DateOnly? start = null, ContactRoleStatus status = ContactRoleStatus.Active, ContactRoleType type = ContactRoleType.PlanManager)
    {
        var person = new Person { Id = Guid.NewGuid(), TenantId = kit.TenantId, FirstName = first, LastName = "Roles", Organisation = organisation, Email = $"{first}@roles.example", AddressLine = "9 Role Rd", Suburb = "Perth", State = "WA", Postcode = "6000" };
        kit.Db.People.Add(person);
        kit.Db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = kit.TenantId, ParticipantId = p.Id, PersonId = person.Id, RoleType = type, StartDate = start, Status = status });
        kit.Db.SaveChanges();
    }

    private static async Task<Invoice> PreviewOf(InvoiceKit kit, Participant p)
    {
        kit.Settings();
        var claim = kit.ShiftClaim(p, TripClaimStatus.Draft, 100m);
        return Assert.Single(await kit.Service.PreviewSnapshotsAsync(claim.Id, Ct));
    }

    [Fact]
    public async Task PlanManaged_WithOnlyAContactRole_IsBilledToThatPlanManager_OnPreviewAndIssue()
    {
        var kit = Create();
        kit.Settings();
        var p = kit.Person("Sam", "Lee", PlanType.PlanManaged);
        AddRole(kit, p, "Rhea", "Role Plans");
        var claim = kit.ShiftClaim(p, TripClaimStatus.Draft, 100m);

        var preview = Assert.Single(await kit.Service.PreviewSnapshotsAsync(claim.Id, Ct));
        Assert.Equal(("Rhea Roles — Role Plans", "9 Role Rd, Perth, WA, 6000", "Rhea@roles.example"), (preview.BillToName, preview.BillToAddress, preview.BillToEmail));

        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));
        var row = await kit.Db.Invoices.AsNoTracking().SingleAsync(i => i.TripClaimId == claim.Id);
        Assert.Equal(("Rhea Roles — Role Plans", "9 Role Rd, Perth, WA, 6000", "Rhea@roles.example"), (row.BillToName, row.BillToAddress, row.BillToEmail));
    }

    [Fact]
    public async Task PlanManaged_WithNeither_IsBilledToTheParticipant()
    {
        var kit = Create();
        var p = kit.Person("Sam", "Lee", PlanType.PlanManaged);
        AddRole(kit, p, "Gina", "Guardians", type: ContactRoleType.Guardian);
        AddRole(kit, p, "Old", "Gone Plans", status: ContactRoleStatus.Expired);
        var inv = await PreviewOf(kit, p);
        Assert.Equal(("Sam Lee", "", null), (inv.BillToName, inv.BillToAddress, inv.BillToEmail));
    }

    [Fact]
    public async Task PlanManaged_LegacyContactWins_OverARole()
    {
        var kit = Create();
        var p = kit.Person("Sam", "Lee", PlanType.PlanManaged, planManager: PlanManager());
        AddRole(kit, p, "Rhea", "Role Plans");
        Assert.Equal("Pat Manager — Plan Co", (await PreviewOf(kit, p)).BillToName);
    }

    [Fact]
    public async Task PlanManaged_SeveralRoles_PicksTheMostRecentlyStarted()
    {
        var kit = Create();
        var p = kit.Person("Sam", "Lee", PlanType.PlanManaged);
        AddRole(kit, p, "Older", "Old Co", new DateOnly(2025, 1, 1));
        AddRole(kit, p, "Newer", "New Co", new DateOnly(2026, 1, 1));
        Assert.Equal("Newer Roles — New Co", (await PreviewOf(kit, p)).BillToName);
    }

    [Theory]
    [InlineData(PlanType.SelfManaged)]
    public async Task SelfManaged_WithAPlanManagerRole_IsStillBilledToTheParticipant(PlanType planType)
    {
        var kit = Create();
        var p = kit.Person("Bea", "Bee", planType);
        AddRole(kit, p, "Rhea", "Role Plans");
        Assert.Equal("Bea Bee", (await PreviewOf(kit, p)).BillToName);
    }
}
