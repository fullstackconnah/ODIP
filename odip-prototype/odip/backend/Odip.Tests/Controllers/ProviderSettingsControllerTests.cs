using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// MED-02: the tenant-scoped primary manager contact (name + phone) on ProviderSettings — CRUD
/// and display only, no consumer yet (MED-01 reads it later). Same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern as ParticipantsControllerTests.
/// </summary>
public class ProviderSettingsControllerTests
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

    private static UpsertProviderSettingsDto MinimalUpsertDto() => new()
    {
        RegistrationNumber = "REG123",
        ABN = "12345678901",
        OrganisationName = "Test Org",
        Address = "1 Test St",
        State = "VIC",
    };

    [Fact]
    public async Task Get_NoRowYet_ReturnsNullData()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        var result = await controller.Get(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto?>>(ok.Value);
        Assert.Null(body.Data);
    }

    [Fact]
    public async Task Upsert_ManagerNameAndPhone_RoundTripThroughGet()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        var dto = MinimalUpsertDto() with { ManagerName = "Priya Sharma", ManagerPhone = "0412345007" };
        var upsertResult = await controller.Upsert(dto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(upsertResult.Result);

        var getResult = await controller.Get(CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal("Priya Sharma", body.Data!.ManagerName);
        Assert.Equal("0412345007", body.Data.ManagerPhone);
    }

    [Fact]
    public async Task Upsert_WithoutManagerFields_LeavesThemNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        var upsertResult = await controller.Upsert(MinimalUpsertDto(), CancellationToken.None);
        Assert.IsType<OkObjectResult>(upsertResult.Result);

        var getResult = await controller.Get(CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Null(body.Data!.ManagerName);
        Assert.Null(body.Data.ManagerPhone);
    }

    [Fact]
    public async Task Upsert_ExistingRow_UpdatesManagerContactInPlace()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        await controller.Upsert(MinimalUpsertDto() with { ManagerName = "Old Name", ManagerPhone = "0000000000" }, CancellationToken.None);
        await controller.Upsert(MinimalUpsertDto() with { ManagerName = "New Name", ManagerPhone = "0412345678" }, CancellationToken.None);

        Assert.Equal(1, await db.ProviderSettings.CountAsync());

        var getResult = await controller.Get(CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal("New Name", body.Data!.ManagerName);
        Assert.Equal("0412345678", body.Data.ManagerPhone);
    }
}
