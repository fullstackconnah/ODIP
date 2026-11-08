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
using Odip.Tests.Support;

namespace Odip.Tests.Contacts;

/// <summary>Controller-level coverage for <see cref="PersonsController"/> (CONTACT-01), using the
/// same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as ParticipantRiskEntriesControllerTests.</summary>
public class PersonsControllerTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId) => TestDb.ForTenant(dbName, tenantId);

    private static CreatePersonDto CreateDto(string firstName = "Karen", string lastName = "Johnson") => new()
    {
        FirstName = firstName, LastName = lastName, Mobile = "0412 345 001", Email = "karen.johnson@email.com.au",
    };

    [Fact]
    public async Task Create_Valid_SavesAndReturnsDto()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new PersonsController(db);

        var result = await controller.Create(CreateDto(), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PersonDto>>(created.Value);
        Assert.True(body.Success);
        Assert.Equal("Karen", body.Data!.FirstName);
        Assert.Equal("Karen Johnson", body.Data.FullName);
        Assert.Equal(0, body.Data.ActiveRoleCount);
    }

    [Fact]
    public async Task Create_BothNamesBlank_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new PersonsController(db);

        var result = await controller.Create(new CreatePersonDto { FirstName = "  ", LastName = "" }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetAll_SearchMatchesName()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        db.People.AddRange(
            new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" },
            new Person { Id = Guid.NewGuid(), FirstName = "David", LastName = "Brown" });
        db.SaveChanges();
        var controller = new PersonsController(db);

        var result = await controller.GetAll("Karen", CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<PersonDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var person = Assert.Single(body.Data!);
        Assert.Equal("Karen", person.FirstName);
    }

    [Fact]
    public async Task GetAll_ActiveRoleCount_CountsOnlyActiveRoles()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson" };
        db.Participants.Add(participant);
        db.People.Add(person);
        db.ParticipantContactRoles.AddRange(
            new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id, RoleType = ContactRoleType.NextOfKin, Status = ContactRoleStatus.Active },
            new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id, RoleType = ContactRoleType.EmergencyContact, Status = ContactRoleStatus.Expired });
        db.SaveChanges();
        var controller = new PersonsController(db);

        var result = await controller.GetAll(null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<PersonDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(1, Assert.Single(body.Data!).ActiveRoleCount);
    }

    [Fact]
    public async Task Update_EntryMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new PersonsController(db);

        var result = await controller.Update(Guid.NewGuid(), new UpdatePersonDto { FirstName = "A", LastName = "B" }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Valid_UpdatesFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson", Mobile = "0412 000 000" };
        db.People.Add(person);
        db.SaveChanges();
        var controller = new PersonsController(db);

        var result = await controller.Update(person.Id, new UpdatePersonDto { FirstName = "Karen", LastName = "Johnson", Mobile = "0412 999 999" }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PersonDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("0412 999 999", body.Data!.Mobile);
    }

    // 02:00 UTC on 8 Nov 2026 is 13:00 on 8 Nov in Sydney, so tomorrow there is 9 Nov.
    private sealed class FixedClock : TimeProvider { public override DateTimeOffset GetUtcNow() => new(2026, 11, 8, 2, 0, 0, TimeSpan.Zero); }

    private static CreatePersonDto Contact(string? email = null, DateOnly? dob = null) => new() { FirstName = "Karen", LastName = "Johnson", Email = email, DateOfBirth = dob };

    [Theory]
    [InlineData("x")]
    [InlineData("karen@")]
    public async Task Create_InvalidEmail_IsRefusedAndSavesNothing(string email)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        var result = await new PersonsController(db, null, new FixedClock()).Create(Contact(email), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Enter an email address like name@example.com.", Assert.Single(Assert.IsType<ApiResponse<PersonDto>>(bad.Value).Errors!));
        Assert.Empty(db.People);
    }

    [Theory]
    [InlineData("karen@example.com")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Create_ValidOrBlankEmail_Saves(string? email)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        var result = await new PersonsController(db, null, new FixedClock()).Create(Contact(email), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal(email, Assert.Single(db.People).Email);
    }

    [Fact]
    public async Task Create_DateOfBirthTomorrowInSydney_IsRefusedAndSavesNothing_TodaySaves()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new PersonsController(db, null, new FixedClock());

        var tomorrow = await controller.Create(Contact(dob: new DateOnly(2026, 11, 9)), CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(tomorrow.Result);
        Assert.Equal("Choose a date of birth that isn't in the future.", Assert.Single(Assert.IsType<ApiResponse<PersonDto>>(bad.Value).Errors!));
        Assert.Empty(db.People);

        var today = await controller.Create(Contact(dob: new DateOnly(2026, 11, 8)), CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(today.Result);
        Assert.Single(db.People);
    }

    [Fact]
    public async Task Update_ChangedToAnInvalidEmailOrFutureDob_IsRefusedAndKeepsTheStoredRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson", Email = "karen@example.com" };
        db.People.Add(person);
        db.SaveChanges();
        var controller = new PersonsController(db, null, new FixedClock());

        Assert.IsType<BadRequestObjectResult>((await controller.Update(person.Id, new UpdatePersonDto { FirstName = "Karen", LastName = "Johnson", Email = "nope" }, CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.Update(person.Id, new UpdatePersonDto { FirstName = "Karen", LastName = "Johnson", Email = "karen@example.com", DateOfBirth = new DateOnly(2026, 11, 9) }, CancellationToken.None)).Result);

        var stored = await db.People.AsNoTracking().SingleAsync();
        Assert.Equal(("karen@example.com", null), (stored.Email, stored.DateOfBirth));
    }

    [Fact]
    public async Task Update_NotesOnly_SavesWhenTheStoredEmailIsAlreadyInvalid()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Karen", LastName = "Johnson", Email = "legacy-not-an-email" };
        db.People.Add(person);
        db.SaveChanges();
        var controller = new PersonsController(db, null, new FixedClock());

        var result = await controller.Update(person.Id, new UpdatePersonDto { FirstName = "Karen", LastName = "Johnson", Email = "legacy-not-an-email", Notes = "Prefers texts" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var stored = await db.People.AsNoTracking().SingleAsync();
        Assert.Equal(("legacy-not-an-email", "Prefers texts"), (stored.Email, stored.Notes));
    }

    [Fact]
    public async Task GetAll_TenantScoped_DoesNotReturnOtherTenantsPeople()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        using (var seedDb = CreateDb(dbName))
        {
            seedDb.People.AddRange(
                new Person { Id = Guid.NewGuid(), TenantId = tenantA, FirstName = "Karen", LastName = "Johnson" },
                new Person { Id = Guid.NewGuid(), TenantId = tenantB, FirstName = "David", LastName = "Brown" });
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantA);
        var controller = new PersonsController(scopedDb);

        var result = await controller.GetAll(null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<PersonDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var person = Assert.Single(body.Data!);
        Assert.Equal("Karen", person.FirstName);
    }

    [Fact]
    public async Task Create_TenantScoped_AutoAssignsTenantIdFromCurrentTenant()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        using var scopedDb = CreateTenantScopedDb(dbName, tenantId);
        var controller = new PersonsController(scopedDb);

        var result = await controller.Create(CreateDto(), CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(result.Result);

        using var verifyDb = CreateDb(dbName);
        var saved = await verifyDb.People.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(tenantId, saved.TenantId);
    }
}
