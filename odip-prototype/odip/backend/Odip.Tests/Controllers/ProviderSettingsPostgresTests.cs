using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The provider settings version against a real PostgreSQL: the UpdatedAt concurrency token and its microsecond rounding, which EF InMemory cannot check.</summary>
public class ProviderSettingsPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ProviderSettingsPostgresTests(PostgresFixture pg) => _pg = pg;

    private (OdipDbContext Db, ProviderSettingsController Controller) Request(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, tenant.Object);
        return (db, new ProviderSettingsController(db, tenant.Object));
    }

    private static UpsertProviderSettingsDto Form(string account, DateTime? expected) => new()
    {
        RegistrationNumber = "REG123", ABN = "12345678901", OrganisationName = "Test Org", Address = "1 Test St", State = "VIC",
        AccountNumber = account, ExpectedUpdatedAt = expected,
    };

    private static async Task<DateTime> LoadedAsync(ProviderSettingsController c) =>
        Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>((await c.Get(CancellationToken.None)).Result).Value).Data!.UpdatedAt;

    [SkippableFact]
    public async Task Two_forms_on_one_row_the_second_save_is_a_409_and_the_first_account_number_stays()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            seed.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Test Org", AccountNumber = "111" });
            await seed.SaveChangesAsync();
        }
        DateTime loadedA, loadedB;
        { var (db, c) = Request(tenantId); await using var _ = db; loadedA = await LoadedAsync(c); }
        { var (db, c) = Request(tenantId); await using var _ = db; loadedB = await LoadedAsync(c); }

        // The version a GET sends must match the stored one exactly (whole microseconds), or the first save would already be a 409.
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Upsert(Form("222", loadedA), CancellationToken.None)).Result); }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<ConflictObjectResult>((await c.Upsert(Form("111", loadedB), CancellationToken.None)).Result); }

        var (check, _c) = Request(tenantId);
        await using (check)
            Assert.Equal("222", (await check.ProviderSettings.SingleAsync()).AccountNumber);
    }
}
