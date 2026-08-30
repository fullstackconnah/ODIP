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

    private static CreateParticipantRoutineDto CreateDto(
        string title = "Morning routine", string description = "Wake gently, offer a warm drink.",
        RoutineCategory category = RoutineCategory.PersonalCare, DayOfWeek? dayOfWeek = null,
        TimeOnly? startTime = null, TimeOnly? endTime = null, bool isCritical = false, bool isActive = true) => new()
    {
        Title = title,
        Description = description,
        Category = category,
        DayOfWeek = dayOfWeek,
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
        Assert.Null(body.Data.DayOfWeek);

        var saved = await db.ParticipantRoutines.SingleAsync();
        Assert.Equal(participant.Id, saved.ParticipantId);
        Assert.True(saved.IsCritical);
    }

    [Fact]
    public async Task Create_WithDayAndTimeWindow_PersistsThem()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var controller = new ParticipantRoutinesController(db);

        var dto = CreateDto(
            title: "Saturday swimming", category: RoutineCategory.Activity,
            dayOfWeek: DayOfWeek.Saturday, startTime: new TimeOnly(9, 30), endTime: new TimeOnly(11, 30));

        var result = await controller.Create(participant.Id, dto, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantRoutineDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(DayOfWeek.Saturday, body.Data!.DayOfWeek);
        Assert.Equal(new TimeOnly(9, 30), body.Data.StartTime);
        Assert.Equal(new TimeOnly(11, 30), body.Data.EndTime);
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

        var dto = new UpdateParticipantRoutineDto { Title = "t", Description = "d" };
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
            DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(9, 0),
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
        Assert.Equal(DayOfWeek.Monday, saved.DayOfWeek);
        Assert.False(saved.IsActive);
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
    public async Task Delete_Valid_RemovesRowFromDatabase()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var routine = new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "To delete", Description = "d" };
        db.ParticipantRoutines.Add(routine);
        db.SaveChanges();

        var controller = new ParticipantRoutinesController(db);
        var result = await controller.Delete(routine.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<bool>>(ok.Value);
        Assert.True(body.Success);
        Assert.True(body.Data);

        Assert.False(await db.ParticipantRoutines.AnyAsync(r => r.Id == routine.Id));
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
