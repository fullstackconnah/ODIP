using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Tests for StaffController's DTO/entity mapping, focused on the WorkerScreeningNumber and
/// WorkerScreeningExpiryDate fields — the two columns that back RosterConflictService's expired
/// worker-screening check, which previously had no way to be entered or read through the API.
/// </summary>
public class StaffControllerTests
{
    private static OdipDbContext CreateDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public async Task Create_WithWorkerScreeningFields_PersistsAndReturnsThem()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var controller = new StaffController(db);

        var dto = new CreateStaffDto
        {
            FirstName = "Jane",
            LastName = "Doe",
            Role = StaffRole.SupportWorker,
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

        var saved = await db.Staff.SingleAsync(s => s.FirstName == "Jane" && s.LastName == "Doe");
        Assert.Equal("WWCC1234567", saved.WorkerScreeningNumber);
        Assert.Equal(new DateOnly(2027, 6, 30), saved.WorkerScreeningExpiryDate);
    }

    [Fact]
    public async Task Update_WithWorkerScreeningFields_RoundTripsThroughDtoAndEntity()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var controller = new StaffController(db);

        var createDto = new CreateStaffDto
        {
            FirstName = "John",
            LastName = "Smith",
            Role = StaffRole.SupportWorker,
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
            Role = StaffRole.SupportWorker,
            IsActive = true,
            WorkerScreeningNumber = "WWCC9876543",
            WorkerScreeningExpiryDate = new DateOnly(2028, 1, 15),
        };

        var updateResult = await controller.Update(staffId, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(ok.Value);
        Assert.Equal("WWCC9876543", body.Data!.WorkerScreeningNumber);
        Assert.Equal(new DateOnly(2028, 1, 15), body.Data!.WorkerScreeningExpiryDate);

        var reloaded = await db.Staff.SingleAsync(s => s.Id == staffId);
        Assert.Equal("WWCC9876543", reloaded.WorkerScreeningNumber);
        Assert.Equal(new DateOnly(2028, 1, 15), reloaded.WorkerScreeningExpiryDate);
    }
}
