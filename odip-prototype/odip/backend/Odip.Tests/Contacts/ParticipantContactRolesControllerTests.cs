using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Contacts;

/// <summary>Controller-level coverage for <see cref="ParticipantContactRolesController"/>
/// (CONTACT-01/02/03), using the same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as
/// ParticipantRiskEntriesControllerTests.</summary>
public class ParticipantContactRolesControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db, PlanType planType = PlanType.SelfManaged, DateOnly? dob = null)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, PlanType = planType, DateOfBirth = dob };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static CreateParticipantContactRoleDto NewPersonDto(
        ContactRoleType roleType = ContactRoleType.NextOfKin, bool isPrimary = false, bool? registeredProviderFlag = null) => new()
    {
        NewPersonFirstName = "Karen", NewPersonLastName = "Johnson", RoleType = roleType, IsPrimary = isPrimary, RegisteredProviderFlag = registeredProviderFlag,
    };

    // ── Create ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ParticipantMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantContactRolesController(db);

        var result = await controller.Create(Guid.NewGuid(), NewPersonDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_NewPerson_CreatesPersonAndRole()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantContactRolesController(db);

        var result = await controller.Create(participant.Id, NewPersonDto(ContactRoleType.NextOfKin, isPrimary: true), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantContactRoleDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Success);
        Assert.Equal("Karen Johnson", body.Data!.PersonFullName);
        Assert.True(body.Data.IsPrimary);
        Assert.Equal(1, await db.People.CountAsync());
    }

    [Fact]
    public async Task Create_ExistingPersonNotFound_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantContactRolesController(db);

        var dto = new CreateParticipantContactRoleDto { PersonId = Guid.NewGuid(), RoleType = ContactRoleType.NextOfKin };
        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_PlanManagerForNonPlanManagedParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, PlanType.SelfManaged);
        var controller = new ParticipantContactRolesController(db);

        var result = await controller.Create(participant.Id, NewPersonDto(ContactRoleType.PlanManager), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.False(await db.ParticipantContactRoles.AnyAsync());
    }

    [Fact]
    public async Task Create_PlanManagerForPlanManagedParticipant_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, PlanType.PlanManaged);
        var controller = new ParticipantContactRolesController(db);

        var result = await controller.Create(participant.Id, NewPersonDto(ContactRoleType.PlanManager), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_SecondActivePlanManager_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, PlanType.PlanManaged);
        var controller = new ParticipantContactRolesController(db);
        await controller.Create(participant.Id, NewPersonDto(ContactRoleType.PlanManager), CancellationToken.None);

        var result = await controller.Create(participant.Id, NewPersonDto(ContactRoleType.PlanManager), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(1, await db.ParticipantContactRoles.CountAsync());
    }

    [Fact]
    public async Task Create_ProviderContactForAgencyManagedWithoutRegisteredFlag_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, PlanType.AgencyManaged);
        var controller = new ParticipantContactRolesController(db);

        var result = await controller.Create(participant.Id, NewPersonDto(ContactRoleType.ProviderContact, registeredProviderFlag: false), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ── List ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetForParticipant_OnlyReturnsRowsForThatParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participantA = SeedParticipant(db);
        var participantB = SeedParticipant(db);
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.People.Add(person);
        db.ParticipantContactRoles.AddRange(
            new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participantA.Id, PersonId = person.Id, RoleType = ContactRoleType.NextOfKin },
            new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participantB.Id, PersonId = person.Id, RoleType = ContactRoleType.EmergencyContact });
        db.SaveChanges();

        var controller = new ParticipantContactRolesController(db);
        var result = await controller.GetForParticipant(participantA.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantContactRoleDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var role = Assert.Single(body.Data!);
        Assert.Equal(ContactRoleType.NextOfKin, role.RoleType);
    }

    // ── Update ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_EntryMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantContactRolesController(db);

        var dto = new UpdateParticipantContactRoleDto { RoleType = ContactRoleType.NextOfKin };
        var result = await controller.Update(Guid.NewGuid(), dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Valid_UpdatesFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.People.Add(person);
        var role = new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id, RoleType = ContactRoleType.NextOfKin, RelationshipToParticipant = "Mother" };
        db.ParticipantContactRoles.Add(role);
        db.SaveChanges();

        var controller = new ParticipantContactRolesController(db);
        var dto = new UpdateParticipantContactRoleDto { RoleType = ContactRoleType.NextOfKin, RelationshipToParticipant = "Grandmother", IsPrimary = true };
        var result = await controller.Update(role.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantContactRoleDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Grandmother", body.Data!.RelationshipToParticipant);
        Assert.True(body.Data.IsPrimary);
    }

    [Fact]
    public async Task Update_ToPlanManagerForNonPlanManagedParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, PlanType.SelfManaged);
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.People.Add(person);
        var role = new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id, RoleType = ContactRoleType.NextOfKin };
        db.ParticipantContactRoles.Add(role);
        db.SaveChanges();

        var controller = new ParticipantContactRolesController(db);
        var dto = new UpdateParticipantContactRoleDto { RoleType = ContactRoleType.PlanManager };
        var result = await controller.Update(role.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ── Delete ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_EntryMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantContactRolesController(db);

        var result = await controller.Delete(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Delete_Valid_RemovesRoleButKeepsPerson()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.People.Add(person);
        var role = new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id, RoleType = ContactRoleType.NextOfKin };
        db.ParticipantContactRoles.Add(role);
        db.SaveChanges();

        var controller = new ParticipantContactRolesController(db);
        var result = await controller.Delete(role.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data);
        Assert.False(await db.ParticipantContactRoles.AnyAsync(r => r.Id == role.Id));
        Assert.True(await db.People.AnyAsync(p => p.Id == person.Id));
    }

    // ── Tenant scoping ───────────────────────────────────────────────────

    [Fact]
    public async Task Create_TenantScoped_AutoAssignsTenantIdFromCurrentTenant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();

        Guid participantId;
        using (var seedDb = CreateDb(dbName))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            seedDb.Participants.Add(participant);
            participantId = participant.Id;
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantId);
        var controller = new ParticipantContactRolesController(scopedDb);

        var result = await controller.Create(participantId, NewPersonDto(), CancellationToken.None);
        Assert.IsType<OkObjectResult>(result.Result);

        using var verifyDb = CreateDb(dbName);
        var savedRole = await verifyDb.ParticipantContactRoles.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(tenantId, savedRole.TenantId);
        var savedPerson = await verifyDb.People.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(tenantId, savedPerson.TenantId);
    }
}
