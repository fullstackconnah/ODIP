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

    // ── Fix-round finding 2: RoleType-change field clearing ─────────────────

    [Fact]
    public async Task Update_GuardianToNextOfKin_ClearsGuardianOnlyFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.People.Add(person);
        var role = new ParticipantContactRole
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id,
            RoleType = ContactRoleType.Guardian, AppointingTribunal = "QCAT",
            OrderScopeDomains = new() { "Health", "Financial" },
            OrderStartDate = new DateOnly(2026, 1, 1), OrderReviewDate = new DateOnly(2027, 1, 1), OrderEndDate = new DateOnly(2028, 1, 1),
        };
        db.ParticipantContactRoles.Add(role);
        db.SaveChanges();

        var controller = new ParticipantContactRolesController(db);
        var dto = new UpdateParticipantContactRoleDto
        {
            RoleType = ContactRoleType.NextOfKin,
            // A stale client payload could still carry the old Guardian fields — the server must
            // clear them regardless of what's sent here.
            AppointingTribunal = "QCAT", OrderScopeDomains = new() { "Health" },
            OrderStartDate = new DateOnly(2026, 1, 1), OrderReviewDate = new DateOnly(2027, 1, 1), OrderEndDate = new DateOnly(2028, 1, 1),
        };
        var result = await controller.Update(role.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantContactRoleDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ContactRoleType.NextOfKin, body.Data!.RoleType);
        Assert.Null(body.Data.AppointingTribunal);
        Assert.Empty(body.Data.OrderScopeDomains);
        Assert.Null(body.Data.OrderStartDate);
        Assert.Null(body.Data.OrderReviewDate);
        Assert.Null(body.Data.OrderEndDate);

        var reloaded = await db.ParticipantContactRoles.SingleAsync(r => r.Id == role.Id);
        Assert.Null(reloaded.AppointingTribunal);
        Assert.Empty(reloaded.OrderScopeDomains);
        Assert.Null(reloaded.OrderStartDate);
        Assert.Null(reloaded.OrderReviewDate);
        Assert.Null(reloaded.OrderEndDate);
    }

    [Fact]
    public async Task Update_NextOfKinToGuardian_PersistsTheNewGuardianFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.People.Add(person);
        var role = new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id, RoleType = ContactRoleType.NextOfKin };
        db.ParticipantContactRoles.Add(role);
        db.SaveChanges();

        var controller = new ParticipantContactRolesController(db);
        var dto = new UpdateParticipantContactRoleDto
        {
            RoleType = ContactRoleType.Guardian,
            AppointingTribunal = "VCAT", OrderScopeDomains = new() { "Accommodation" },
            OrderStartDate = new DateOnly(2026, 3, 1),
        };
        var result = await controller.Update(role.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantContactRoleDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ContactRoleType.Guardian, body.Data!.RoleType);
        Assert.Equal("VCAT", body.Data.AppointingTribunal);
        Assert.Equal(new[] { "Accommodation" }, body.Data.OrderScopeDomains);
        Assert.Equal(new DateOnly(2026, 3, 1), body.Data.OrderStartDate);
    }

    [Fact]
    public async Task Create_SetsIrrelevantFieldsNullEvenIfDtoCarriesThem()
    {
        // Defence in depth on the Create path too, not just Update — a caller sending
        // Guardian-only fields alongside a NextOfKin RoleType must not have them persisted.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantContactRolesController(db);

        var dto = new CreateParticipantContactRoleDto
        {
            NewPersonFirstName = "Karen", NewPersonLastName = "Johnson",
            RoleType = ContactRoleType.NextOfKin,
            AppointingTribunal = "QCAT", OrderScopeDomains = new() { "Legal" },
        };
        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantContactRoleDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(body.Data!.AppointingTribunal);
        Assert.Empty(body.Data.OrderScopeDomains);
    }

    // ── PF-5/PF-6 (SPEC-02): multi-role contacts ────────────────────────────

    [Fact]
    public async Task Create_TwoRolesForSamePersonAndParticipant_BothPersistIndependently()
    {
        // PF-5: "multiple roles" is multiple ParticipantContactRole rows sharing one PersonId —
        // no backend change is required to support it (the frontend just POSTs twice), but this
        // pins that the existing single-role endpoint really does allow it and keeps each row's
        // fields independent of the other.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, PlanType.PlanManaged);
        var controller = new ParticipantContactRolesController(db);

        var firstResult = await controller.Create(
            participant.Id,
            new CreateParticipantContactRoleDto
            {
                NewPersonFirstName = "Karen", NewPersonLastName = "Johnson",
                RoleType = ContactRoleType.PlanManager, OrganisationName = "Plan Partners",
            },
            CancellationToken.None);
        var firstBody = Assert.IsType<ApiResponse<ParticipantContactRoleDto>>(Assert.IsType<OkObjectResult>(firstResult.Result).Value);
        var personId = firstBody.Data!.PersonId;

        var secondResult = await controller.Create(
            participant.Id,
            new CreateParticipantContactRoleDto
            {
                PersonId = personId, RoleType = ContactRoleType.Specialist,
                Discipline = "Occupational Therapy", OrganisationName = "OT Clinic",
            },
            CancellationToken.None);
        var secondBody = Assert.IsType<ApiResponse<ParticipantContactRoleDto>>(Assert.IsType<OkObjectResult>(secondResult.Result).Value);

        Assert.Equal(1, await db.People.CountAsync());
        Assert.Equal(2, await db.ParticipantContactRoles.CountAsync(r => r.PersonId == personId));

        var roles = await db.ParticipantContactRoles.Where(r => r.PersonId == personId).ToListAsync();
        var planManagerRow = Assert.Single(roles, r => r.RoleType == ContactRoleType.PlanManager);
        var specialistRow = Assert.Single(roles, r => r.RoleType == ContactRoleType.Specialist);
        Assert.Equal("Plan Partners", planManagerRow.OrganisationName);
        Assert.Equal("OT Clinic", specialistRow.OrganisationName);
        Assert.Equal("Occupational Therapy", specialistRow.Discipline);
        Assert.NotEqual(secondBody.Data!.Id, firstBody.Data.Id);
    }

    [Fact]
    public async Task Create_NewPersonWithFullOptionalFields_PersistsAddressAndDateOfBirth()
    {
        // PF-6: "closing a small existing gap" — the new-person path now accepts the rest of
        // CreatePersonDto's optional fields, not just first/last name.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantContactRolesController(db);

        var dto = new CreateParticipantContactRoleDto
        {
            NewPersonFirstName = "Denise", NewPersonLastName = "Wilson",
            NewPersonAddressLine = "12 High St", NewPersonSuburb = "Northgate",
            NewPersonState = "QLD", NewPersonPostcode = "4013",
            NewPersonDateOfBirth = new DateOnly(1980, 5, 1),
            RoleType = ContactRoleType.NextOfKin,
        };
        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var person = await db.People.SingleAsync();
        Assert.Equal("12 High St", person.AddressLine);
        Assert.Equal("Northgate", person.Suburb);
        Assert.Equal("QLD", person.State);
        Assert.Equal("4013", person.Postcode);
        Assert.Equal(new DateOnly(1980, 5, 1), person.DateOfBirth);
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

    [Fact]
    public async Task Create_ParticipantInDifferentTenant_ReturnsNotFound()
    {
        // Fix-round finding 7: a request scoped to a participant belonging to a DIFFERENT tenant
        // must 404, not leak through — the mechanism is Participant's own global query filter
        // scoping `_db.Participants.FirstOrDefaultAsync` to the caller's ambient tenant, exactly
        // like Create_TenantScoped_AutoAssignsTenantIdFromCurrentTenant above proves the write
        // half of tenant scoping.
        var dbName = Guid.NewGuid().ToString();
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();

        Guid foreignParticipantId;
        using (var seedDb = CreateDb(dbName))
        {
            var foreignParticipant = new Participant { Id = Guid.NewGuid(), TenantId = tenantBId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            seedDb.Participants.Add(foreignParticipant);
            foreignParticipantId = foreignParticipant.Id;
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantAId);
        var controller = new ParticipantContactRolesController(scopedDb);

        var result = await controller.Create(foreignParticipantId, NewPersonDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
