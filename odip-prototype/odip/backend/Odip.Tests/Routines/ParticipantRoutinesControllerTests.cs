using System.Reflection;
using Microsoft.AspNetCore.Authorization;
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

namespace Odip.Tests.Routines;

/// <summary>
/// Controller-level coverage for the Participant Routines API slice
/// (ParticipantRoutinesController), using the same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern as ParticipantNotesControllerTests/MedicationsControllerTests.
/// </summary>
public class ParticipantRoutinesControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    /// <summary>Tenant-scoped (non-SuperAdmin) context — mirrors StaffControllerTests/FieldRegistryControllerTests.</summary>
    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    /// <summary>Every day, Monday-first — the "every day" wire shape (a full 7-element list, not null/empty).</summary>
    private static readonly IReadOnlyList<DayOfWeek> AllDays = ParticipantRoutineDayMapper.ToDayList(ParticipantRoutineDays.All);

    private static CreateParticipantRoutineDto CreateDto(
        string title = "Morning routine", string description = "Wake gently, offer a warm drink.",
        RoutineCategory category = RoutineCategory.PersonalCare, IReadOnlyList<DayOfWeek>? days = null,
        TimeOnly? startTime = null, TimeOnly? endTime = null, bool isCritical = false, bool isActive = true) => new()
    {
        Title = title,
        Description = description,
        Category = category,
        Days = days ?? AllDays,
        StartTime = startTime,
        EndTime = endTime,
        IsCritical = isCritical,
        IsActive = isActive,
    };

    // ── Create ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ParticipantMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantRoutinesController(db);

        var result = await controller.Create(Guid.NewGuid(), CreateDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_Valid_SavesAndReturnsDto()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRoutinesController(db);

        var dto = CreateDto(
            title: "Epilepsy medication window", category: RoutineCategory.Medication,
            isCritical: true);

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantRoutineDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Epilepsy medication window", body.Data!.Title);
        Assert.Equal(participant.Id, body.Data.ParticipantId);
        Assert.Equal(RoutineCategory.Medication, body.Data.Category);
        Assert.True(body.Data.IsCritical);
        Assert.Equal(AllDays, body.Data.Days);

        var saved = await db.ParticipantRoutines.SingleAsync();
        Assert.Equal(participant.Id, saved.ParticipantId);
        Assert.True(saved.IsCritical);
        Assert.Equal(ParticipantRoutineDays.All, saved.Days);
    }

    [Fact]
    public async Task Create_WithSingleDayAndTimeWindow_PersistsThem()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRoutinesController(db);

        var dto = CreateDto(
            title: "Saturday swimming", category: RoutineCategory.Activity,
            days: new[] { DayOfWeek.Saturday }, startTime: new TimeOnly(9, 30), endTime: new TimeOnly(11, 30));

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRoutineDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new[] { DayOfWeek.Saturday }, body.Data!.Days);
        Assert.Equal(new TimeOnly(9, 30), body.Data.StartTime);
        Assert.Equal(new TimeOnly(11, 30), body.Data.EndTime);
    }

    [Fact]
    public async Task Create_WithMultipleButNotAllDays_PersistsAndRoundTripsExactSet()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRoutinesController(db);

        // Mon/Wed/Fri — the spec's own example of "some tasks could be every other day."
        var dto = CreateDto(days: new[] { DayOfWeek.Monday, DayOfWeek.Wednesday, DayOfWeek.Friday });

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRoutineDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new[] { DayOfWeek.Monday, DayOfWeek.Wednesday, DayOfWeek.Friday }, body.Data!.Days);

        var saved = await db.ParticipantRoutines.SingleAsync();
        Assert.Equal(
            ParticipantRoutineDays.Monday | ParticipantRoutineDays.Wednesday | ParticipantRoutineDays.Friday,
            saved.Days);
    }

    [Fact]
    public async Task Create_EmptyDays_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRoutinesController(db);

        var dto = CreateDto(days: Array.Empty<DayOfWeek>());

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantRoutineDto>>(bad.Value);
        Assert.False(body.Success);
        Assert.False(await db.ParticipantRoutines.AnyAsync());
    }

    // ── List / filtering ─────────────────────────────────────────────────

    [Fact]
    public async Task GetForParticipant_DefaultExcludesInactive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.ParticipantRoutines.AddRange(
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Active routine", Description = "d", IsActive = true },
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Inactive routine", Description = "d", IsActive = false });
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var result = await controller.GetForParticipant(participant.Id, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRoutineDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var routine = Assert.Single(body.Data!);
        Assert.Equal("Active routine", routine.Title);
    }

    [Fact]
    public async Task GetForParticipant_IncludeInactiveTrue_ReturnsBoth()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.ParticipantRoutines.AddRange(
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Active routine", Description = "d", IsActive = true },
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Inactive routine", Description = "d", IsActive = false });
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var result = await controller.GetForParticipant(participant.Id, includeInactive: true, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRoutineDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.Count);
    }

    [Fact]
    public async Task GetForParticipant_OrdersCriticalFirst()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.ParticipantRoutines.AddRange(
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Not critical", Description = "d", IsActive = true, IsCritical = false },
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Critical", Description = "d", IsActive = true, IsCritical = true });
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var result = await controller.GetForParticipant(participant.Id, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRoutineDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Critical", body.Data![0].Title);
    }

    [Fact]
    public async Task GetForParticipant_OnlyReturnsRowsForThatParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participantA = SeedParticipant(db, "Sophie", "Brown");
        var participantB = SeedParticipant(db, "Harrison", "Lee");
        db.ParticipantRoutines.AddRange(
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participantA.Id, Title = "A's routine", Description = "d", IsActive = true },
            new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participantB.Id, Title = "B's routine", Description = "d", IsActive = true });
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var result = await controller.GetForParticipant(participantA.Id, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRoutineDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var routine = Assert.Single(body.Data!);
        Assert.Equal("A's routine", routine.Title);
    }

    // ── Update ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_RoutineMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantRoutinesController(db);

        // Days must be non-empty so this exercises the "routine not found" path specifically,
        // not the (also BadRequest-returning) empty-days validation checked separately below.
        var dto = new UpdateParticipantRoutineDto { Title = "t", Description = "d", Days = AllDays };
        var result = await controller.Update(Guid.NewGuid(), dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Valid_UpdatesFieldsIncludingCriticalAndInactive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var routine = new ParticipantRoutine
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Original", Description = "Original desc",
            Category = RoutineCategory.Other, IsCritical = false, IsActive = true,
        };
        db.ParticipantRoutines.Add(routine);
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var dto = new UpdateParticipantRoutineDto
        {
            Title = "Updated", Description = "Updated desc", Category = RoutineCategory.Mobility,
            Days = new[] { DayOfWeek.Monday }, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(9, 0),
            IsCritical = true, IsActive = false,
        };

        var result = await controller.Update(routine.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantRoutineDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Updated", body.Data!.Title);
        Assert.Equal(RoutineCategory.Mobility, body.Data.Category);
        Assert.True(body.Data.IsCritical);
        Assert.False(body.Data.IsActive);

        var saved = await db.ParticipantRoutines.SingleAsync();
        Assert.Equal("Updated desc", saved.Description);
        Assert.Equal(ParticipantRoutineDays.Monday, saved.Days);
        Assert.False(saved.IsActive);
    }

    [Fact]
    public async Task Update_EmptyDays_ReturnsBadRequestAndDoesNotModifyRoutine()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var routine = new ParticipantRoutine
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Original", Description = "Original desc",
            Category = RoutineCategory.Other, Days = ParticipantRoutineDays.Monday, IsActive = true,
        };
        db.ParticipantRoutines.Add(routine);
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var dto = new UpdateParticipantRoutineDto
        {
            Title = "Updated", Description = "Updated desc", Category = RoutineCategory.Mobility,
            Days = Array.Empty<DayOfWeek>(),
        };

        var result = await controller.Update(routine.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ParticipantRoutineDto>>(bad.Value);
        Assert.False(body.Success);

        var saved = await db.ParticipantRoutines.SingleAsync();
        Assert.Equal("Original", saved.Title);
        Assert.Equal(ParticipantRoutineDays.Monday, saved.Days);
    }

    // ── Delete ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_RoutineMissing_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantRoutinesController(db);

        var result = await controller.Delete(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Delete_Valid_RetiresTheRoutine_TheRowStaysWithIsActiveFalse()
    {
        // A routine that has been ticked on a shift is part of that shift's record, so DELETE retires it (IsActive = false) rather than removing the row.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var routine = new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "To delete", Description = "d", UpdatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
        db.ParticipantRoutines.Add(routine);
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var result = await controller.Delete(routine.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<bool>>(ok.Value);
        Assert.True(body.Success);
        Assert.True(body.Data);

        var stored = await db.ParticipantRoutines.SingleAsync(r => r.Id == routine.Id);   // the row is still there
        Assert.False(stored.IsActive);
        Assert.True(stored.UpdatedAt > new DateTime(2026, 1, 1));
    }

    [Fact]
    public async Task ARetiredRoutine_DropsOutOfTheDefaultList_ButIncludeInactiveStillShowsIt()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var routine = new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "To delete", Description = "d" };
        db.ParticipantRoutines.Add(routine);
        db.SaveChanges();
        var controller = new ParticipantRoutinesController(db);
        await controller.Delete(routine.Id, CancellationToken.None);

        var defaultList = await controller.GetForParticipant(participant.Id, includeInactive: false, CancellationToken.None);
        var fullList = await controller.GetForParticipant(participant.Id, includeInactive: true, CancellationToken.None);

        Assert.Empty(Assert.IsType<ApiResponse<List<ParticipantRoutineDto>>>(Assert.IsType<OkObjectResult>(defaultList.Result).Value).Data!);
        var retired = Assert.Single(Assert.IsType<ApiResponse<List<ParticipantRoutineDto>>>(Assert.IsType<OkObjectResult>(fullList.Result).Value).Data!);
        Assert.False(retired.IsActive);
    }

    [Fact]
    public async Task Delete_AnAlreadyRetiredRoutine_IsAnIdempotentOk_AndIsNotTouchedAgain()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var retiredAt = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var routine = new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Old", Description = "d", IsActive = false, UpdatedAt = retiredAt };
        db.ParticipantRoutines.Add(routine);
        db.SaveChanges();

        var result = await new ParticipantRoutinesController(db).Delete(routine.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(retiredAt, (await db.ParticipantRoutines.SingleAsync()).UpdatedAt);
    }

    [Fact]
    public void Delete_IsForAdminsAndCoordinatorsOnly_ASupportWorkerCanAddAndEditARoutineButNotRemoveOne()
    {
        string RolesOf(string action) =>
            typeof(ParticipantRoutinesController).GetMethod(action)!.GetCustomAttribute<AuthorizeAttribute>()!.Roles!;

        Assert.Equal("Admin,Coordinator,SuperAdmin", RolesOf(nameof(ParticipantRoutinesController.Delete)));
        Assert.DoesNotContain("SupportWorker", RolesOf(nameof(ParticipantRoutinesController.Delete)));
        Assert.Contains("SupportWorker", RolesOf(nameof(ParticipantRoutinesController.Create)));   // unchanged
        Assert.Contains("SupportWorker", RolesOf(nameof(ParticipantRoutinesController.Update)));
    }

    [Fact]
    public async Task Delete_AnotherTenantsRoutine_Is404_AndIsNotRetired()
    {
        var dbName = Guid.NewGuid().ToString();
        var (tenantA, tenantB) = (Guid.NewGuid(), Guid.NewGuid());
        Guid routineId;
        using (var seedDb = CreateDb(dbName))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantB, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            var routine = new ParticipantRoutine { Id = Guid.NewGuid(), TenantId = tenantB, ParticipantId = participant.Id, Title = "Tenant B routine", Description = "d", IsActive = true };
            seedDb.Participants.Add(participant);
            seedDb.ParticipantRoutines.Add(routine);
            seedDb.SaveChanges();
            routineId = routine.Id;
        }

        using (var scopedDb = CreateTenantScopedDb(dbName, tenantA))
        {
            var result = await new ParticipantRoutinesController(scopedDb).Delete(routineId, CancellationToken.None);
            Assert.IsType<NotFoundObjectResult>(result.Result);
        }

        using var verify = CreateDb(dbName);
        Assert.True((await verify.ParticipantRoutines.IgnoreQueryFilters().SingleAsync()).IsActive);
    }

    // ── Tenant scoping ───────────────────────────────────────────────────

    [Fact]
    public async Task GetForParticipant_TenantScoped_DoesNotReturnOtherTenantsRoutines()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        // Seed both tenants' data as SuperAdmin (bypasses query filters) so both rows exist,
        // sharing the same underlying InMemory database by name.
        Guid participantId;
        using (var seedDb = CreateDb(dbName))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantA, FirstName = "Sophie", LastName = "Brown", IsActive = true };
            seedDb.Participants.Add(participant);
            participantId = participant.Id;
            seedDb.ParticipantRoutines.AddRange(
                new ParticipantRoutine { Id = Guid.NewGuid(), TenantId = tenantA, ParticipantId = participantId, Title = "Tenant A routine", Description = "d", IsActive = true },
                new ParticipantRoutine { Id = Guid.NewGuid(), TenantId = tenantB, ParticipantId = participantId, Title = "Tenant B routine", Description = "d", IsActive = true });
            seedDb.SaveChanges();
        }

        // Read back as a non-SuperAdmin user scoped to tenant A.
        using var scopedDb = CreateTenantScopedDb(dbName, tenantA);
        var controller = new ParticipantRoutinesController(scopedDb);

        var result = await controller.GetForParticipant(participantId, includeInactive: false, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<ParticipantRoutineDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var routine = Assert.Single(body.Data!);
        Assert.Equal("Tenant A routine", routine.Title);
    }

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
        var controller = new ParticipantRoutinesController(scopedDb);

        var result = await controller.Create(participantId, CreateDto(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);

        using var verifyDb = CreateDb(dbName);
        var saved = await verifyDb.ParticipantRoutines.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(tenantId, saved.TenantId);
    }
}
