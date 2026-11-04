using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Controllers;

/// <summary>
/// Tests for StaffController's DTO/entity mapping, focused on the WorkerScreeningNumber and
/// WorkerScreeningExpiryDate fields — the two columns that back RosterConflictService's expired
/// worker-screening check, which previously had no way to be entered or read through the API.
/// </summary>
public class StaffControllerTests
{
    private static OdipDbContext CreateDb(string dbName, Guid tenantId) => TestDb.ForTenant(dbName, tenantId);

    // The screening number is only returned to managers (StaffScreeningMask), so these tests call as an Admin.
    private static ControllerContext AdminContext() => new()
    {
        HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, "Admin") }, "test")) },
    };

    [Fact]
    public async Task Create_WithWorkerScreeningFields_PersistsAndReturnsThem()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var controller = new StaffController(db) { ControllerContext = AdminContext() };

        var dto = new CreateStaffDto
        {
            FirstName = "Jane",
            LastName = "Doe",
            Email = "jane.doe@example.com",
            Position = Position.SupportWorker,
            IsActive = true,
            WorkerScreeningNumber = "WWCC1234567",
            WorkerScreeningExpiryDate = new DateOnly(2027, 6, 30),
        };

        var result = await controller.Create(dto, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(created.Value);
        Assert.True(body.Success);
        Assert.Equal("WWCC1234567", body.Data!.WorkerScreeningNumber);
        Assert.Equal(new DateOnly(2027, 6, 30), body.Data!.WorkerScreeningExpiryDate);

        var saved = await db.Users.SingleAsync(s => s.FirstName == "Jane" && s.LastName == "Doe");
        Assert.Equal("WWCC1234567", saved.WorkerScreeningNumber);
        Assert.Equal(new DateOnly(2027, 6, 30), saved.WorkerScreeningExpiryDate);
    }

    [Fact]
    public async Task EmploymentType_RoundTripsThroughCreateUpdateAndGet_AndIsNullWhenNotSet()
    {
        using var db = CreateDb(Guid.NewGuid().ToString(), Guid.NewGuid());
        var controller = new StaffController(db) { ControllerContext = AdminContext() };

        var created = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<CreatedAtActionResult>((await controller.Create(
            new CreateStaffDto { FirstName = "Cass", LastName = "Hart", Email = "cass.hart@example.com", Position = Position.SupportWorker, IsActive = true, EmploymentType = EmploymentType.Casual },
            CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(EmploymentType.Casual, created.EmploymentType);
        Assert.Equal(EmploymentType.Casual, (await db.Users.SingleAsync(u => u.Id == created.Id)).EmploymentType);

        var updated = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Id,
            new UpdateStaffDto { FirstName = "Cass", LastName = "Hart", Email = "cass.hart@example.com", Position = Position.SupportWorker, IsActive = true, EmploymentType = EmploymentType.PartTime },
            CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(EmploymentType.PartTime, updated.EmploymentType);

        var fetched = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.GetById(created.Id, CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(EmploymentType.PartTime, fetched.EmploymentType);

        var unset = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Id,
            new UpdateStaffDto { FirstName = "Cass", LastName = "Hart", Email = "cass.hart@example.com", Position = Position.SupportWorker, IsActive = true },
            CancellationToken.None)).Result).Value).Data!;
        Assert.Null(unset.EmploymentType);
    }

    [Fact]
    public async Task Update_WithWorkerScreeningFields_RoundTripsThroughDtoAndEntity()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var controller = new StaffController(db) { ControllerContext = AdminContext() };

        var createDto = new CreateStaffDto
        {
            FirstName = "John",
            LastName = "Smith",
            Email = "john.smith@example.com",
            Position = Position.SupportWorker,
            IsActive = true,
        };
        var createResult = await controller.Create(createDto, CancellationToken.None);
        var createdBody = Assert.IsType<ApiResponse<StaffDetailDto>>(
            Assert.IsType<CreatedAtActionResult>(createResult.Result).Value);
        var staffId = createdBody.Data!.Id;

        var updateDto = new UpdateStaffDto
        {
            FirstName = "John",
            LastName = "Smith",
            Email = "john.smith@example.com",
            Position = Position.SupportWorker,
            IsActive = true,
            WorkerScreeningNumber = "WWCC9876543",
            WorkerScreeningExpiryDate = new DateOnly(2028, 1, 15),
        };

        var updateResult = await controller.Update(staffId, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(ok.Value);
        Assert.Equal("WWCC9876543", body.Data!.WorkerScreeningNumber);
        Assert.Equal(new DateOnly(2028, 1, 15), body.Data!.WorkerScreeningExpiryDate);

        var reloaded = await db.Users.SingleAsync(s => s.Id == staffId);
        Assert.Equal("WWCC9876543", reloaded.WorkerScreeningNumber);
        Assert.Equal(new DateOnly(2028, 1, 15), reloaded.WorkerScreeningExpiryDate);
    }

    [Fact]
    public async Task Update_KeepsEmploymentTypeWhenSent_ClearsItWhenNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString(), Guid.NewGuid());
        var controller = new StaffController(db) { ControllerContext = AdminContext() };

        var created = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<CreatedAtActionResult>((await controller.Create(
            new CreateStaffDto { FirstName = "Pia", LastName = "Doyle", Email = "pia.doyle@example.com", Position = Position.SupportWorker, IsActive = true, EmploymentType = EmploymentType.PartTime },
            CancellationToken.None)).Result).Value).Data!;

        var kept = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Id,
            new UpdateStaffDto { FirstName = "Pia", LastName = "Doyle", Email = "pia.doyle@example.com", Position = Position.SupportWorker, IsActive = false, EmploymentType = EmploymentType.PartTime },
            CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(EmploymentType.PartTime, kept.EmploymentType);
        Assert.Equal(EmploymentType.PartTime, (await db.Users.SingleAsync(u => u.Id == created.Id)).EmploymentType);

        var cleared = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Id,
            new UpdateStaffDto { FirstName = "Pia", LastName = "Doyle", Email = "pia.doyle@example.com", Position = Position.SupportWorker, IsActive = false, EmploymentType = null },
            CancellationToken.None)).Result).Value).Data!;
        Assert.Null(cleared.EmploymentType);
        Assert.Null((await db.Users.SingleAsync(u => u.Id == created.Id)).EmploymentType);
    }

    private static UpdateStaffDto GoalDto(decimal? goal) => new()
    {
        FirstName = "Gail", LastName = "Hours", Email = "gail.hours@example.com", Position = Position.SupportWorker, IsActive = true, GoalWeeklyHours = goal,
    };

    [Fact]
    public async Task GoalWeeklyHours_IsSavedReadAndCleared_OnCreateAndUpdate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString(), Guid.NewGuid());
        var controller = new StaffController(db) { ControllerContext = AdminContext() };
        var created = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<CreatedAtActionResult>((await controller.Create(GoalDto(24.5m), default)).Result).Value);
        Assert.Equal(24.5m, created.Data!.GoalWeeklyHours);

        var saved = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Data.Id, GoalDto(38m), default)).Result).Value);
        Assert.Equal(38m, saved.Data!.GoalWeeklyHours);
        Assert.Equal(38m, (await db.Users.SingleAsync(s => s.Id == created.Data.Id)).GoalWeeklyHours);

        var cleared = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Data.Id, GoalDto(null), default)).Result).Value);
        Assert.Null(cleared.Data!.GoalWeeklyHours);
        Assert.Null((await db.Users.SingleAsync(s => s.Id == created.Data.Id)).GoalWeeklyHours);
    }

    [Theory]
    [InlineData(81)]
    [InlineData(-1)]
    [InlineData(20.25)]
    public async Task GoalWeeklyHours_OutsideZeroToEightyInHalfHours_Is400_AndChangesNothing(double goal)
    {
        using var db = CreateDb(Guid.NewGuid().ToString(), Guid.NewGuid());
        var controller = new StaffController(db) { ControllerContext = AdminContext() };
        var created = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<CreatedAtActionResult>((await controller.Create(GoalDto(30m), default)).Result).Value);

        Assert.IsType<BadRequestObjectResult>((await controller.Update(created.Data!.Id, GoalDto((decimal)goal), default)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.Create(GoalDto((decimal)goal), default)).Result);
        Assert.Equal(30m, (await db.Users.SingleAsync(s => s.Id == created.Data.Id)).GoalWeeklyHours);
    }

    [Fact]
    public async Task Update_LeavesTheEmploymentHeroStartDateAlone_AndEveryStaffResponseShowsIt()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var start = new DateOnly(2027, 2, 1);
        var staff = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, Username = "new.starter", Email = "new.starter@example.com",
            FirstName = "New", LastName = "Starter", Position = Position.SupportWorker, IsActive = true, EmploymentStartDate = start,
        };
        db.Users.Add(staff);
        await db.SaveChangesAsync();
        var controller = new StaffController(db) { ControllerContext = AdminContext() };

        var updated = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>(
            (await controller.Update(staff.Id, new UpdateStaffDto { FirstName = "New", LastName = "Starter", Email = "new.starter@example.com", Position = Position.SupportWorker, IsActive = true, Notes = "edited" }, CancellationToken.None)).Result).Value);
        var listed = Assert.IsType<ApiResponse<List<StaffListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAll(null, CancellationToken.None)).Result).Value);

        Assert.Equal(start, (await db.Users.SingleAsync(s => s.Id == staff.Id)).EmploymentStartDate);
        Assert.Equal(start, updated.Data!.EmploymentStartDate);
        Assert.Equal(start, Assert.Single(listed.Data!, s => s.LastName == "Starter").EmploymentStartDate);
    }

    [Fact]
    public async Task GetAll_FlagsHasExpiredQualifications_WhenOnlyWorkerScreeningHasExpired()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Username = "screened.worker",
            Email = "screened.worker@example.com",
            FirstName = "Screened",
            LastName = "Worker",
            IsActive = true,
            WorkerScreeningNumber = "WWCC-EXPIRED",
            WorkerScreeningExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1),
        });
        await db.SaveChangesAsync();
        var controller = new StaffController(db) { ControllerContext = AdminContext() };

        var result = await controller.GetAll(null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<StaffListDto>>>(ok.Value);
        var staff = Assert.Single(body.Data!, s => s.LastName == "Worker");
        Assert.True(staff.HasExpiredQualifications);
    }

    [Fact]
    public async Task Create_WithAnEmailUsedInAnotherTenant_ReturnsConflict()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            TenantId = Guid.NewGuid(),
            Username = "sam.lee",
            Email = "sam.lee@gmail.com",
            FirstName = "Sam",
            LastName = "Lee",
        });
        await db.SaveChangesAsync();
        var controller = new StaffController(db) { ControllerContext = AdminContext() };

        var result = await controller.Create(
            new CreateStaffDto { FirstName = "Sam", LastName = "Lee", Email = "Sam.Lee@gmail.com", Position = Position.SupportWorker },
            CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(conflict.Value);
        Assert.Equal("A user with this email already exists.", body.Errors![0]);
    }

    [Fact]
    public async Task Cpr_RoundTripsThroughUpdateAndGet_AndAnExpiredCprAloneFlagsTheListAndDetail()
    {
        using var db = CreateDb(Guid.NewGuid().ToString(), Guid.NewGuid());
        var controller = new StaffController(db) { ControllerContext = AdminContext() };
        var created = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<CreatedAtActionResult>((await controller.Create(
            new CreateStaffDto { FirstName = "Cora", LastName = "Pulse", Email = "cora.pulse@example.com", Position = Position.SupportWorker, IsActive = true },
            CancellationToken.None)).Result).Value).Data!;
        Assert.False(created.IsCprQualified);

        var current = new DateOnly(2027, 2, 1);
        var updated = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.Update(created.Id,
            new UpdateStaffDto { FirstName = "Cora", LastName = "Pulse", Email = "cora.pulse@example.com", Position = Position.SupportWorker, IsActive = true, IsCprQualified = true, CprExpiryDate = current },
            CancellationToken.None)).Result).Value).Data!;
        Assert.True(updated.IsCprQualified);
        var fetched = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.GetById(created.Id, CancellationToken.None)).Result).Value).Data!;
        Assert.Equal((true, current), (fetched.IsCprQualified, fetched.CprExpiryDate!.Value));
        Assert.False(fetched.HasExpiredQualifications);

        // Only the CPR has lapsed: the list's inline rule and the detail must both flag it.
        var user = await db.Users.SingleAsync(u => u.Id == created.Id);
        user.CprExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-3);
        await db.SaveChangesAsync();
        var listed = Assert.IsType<ApiResponse<List<StaffListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAll(null, CancellationToken.None)).Result).Value);
        Assert.True(Assert.Single(listed.Data!, s => s.LastName == "Pulse").HasExpiredQualifications);
        var detail = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.GetById(created.Id, CancellationToken.None)).Result).Value).Data!;
        Assert.True(detail.HasExpiredQualifications);
    }

    [Fact]
    public async Task Update_BuiltFromTheGetResponse_SavesTheCprExpiryAndKeepsTheFlag()
    {
        using var db = CreateDb(Guid.NewGuid().ToString(), Guid.NewGuid());
        var controller = new StaffController(db) { ControllerContext = AdminContext() };
        var created = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<CreatedAtActionResult>((await controller.Create(
            new CreateStaffDto { FirstName = "Cora", LastName = "Pulse", Email = "cora.pulse@example.com", Position = Position.SupportWorker, IsActive = true, IsCprQualified = true, CprExpiryDate = new DateOnly(2027, 2, 1) },
            CancellationToken.None)).Result).Value).Data!;
        var got = Assert.IsType<ApiResponse<StaffDetailDto>>(Assert.IsType<OkObjectResult>((await controller.GetById(created.Id, CancellationToken.None)).Result).Value).Data!;

        // The edit forms rebuild the whole update from the row they loaded and change one field.
        await controller.Update(created.Id, new UpdateStaffDto
        {
            FirstName = got.FirstName, LastName = got.LastName, Email = got.Email, Position = got.Position, IsActive = got.IsActive,
            IsCprQualified = got.IsCprQualified, CprExpiryDate = new DateOnly(2027, 6, 1), ManualHandlingExpiryDate = new DateOnly(2028, 1, 1),
        }, CancellationToken.None);

        var saved = await db.Users.SingleAsync(u => u.Id == created.Id);
        Assert.True(saved.IsCprQualified);
        Assert.Equal(new DateOnly(2027, 6, 1), saved.CprExpiryDate);
        Assert.Equal(new DateOnly(2028, 1, 1), saved.ManualHandlingExpiryDate);
    }
}
