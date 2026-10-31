using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
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

    private static UpsertProviderSettingsDto Form(string account, DateTime? expected, string? zone = null) => new()
    {
        RegistrationNumber = "REG123", ABN = "12345678901", OrganisationName = "Test Org", Address = "1 Test St", State = "VIC",
        AccountNumber = account, ExpectedUpdatedAt = expected, TimeZoneId = zone,
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

    private sealed class FixedClock(DateTime utc) : TimeProvider { public override DateTimeOffset GetUtcNow() => new(utc, TimeSpan.Zero); }

    // 14:30 UTC on 31 Oct is 1 Nov in Sydney and still 31 Oct in Perth: the saved zone decides, read through the real query.
    [SkippableFact]
    public async Task Today_follows_the_saved_zone_and_falls_back_to_the_State()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            seed.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Test Org", State = "NSW", TimeZoneId = "Australia/Perth" });
            await seed.SaveChangesAsync();
        }
        var clock = new FixedClock(new DateTime(2026, 10, 31, 14, 30, 0, DateTimeKind.Utc));

        { var (db, _) = Request(tenantId); await using var _d = db; Assert.Equal(new DateOnly(2026, 10, 31), await ProviderTimeZoneResolver.TodayAsync(db, tenantId, clock, CancellationToken.None)); }

        { var (db, _) = Request(tenantId); await using var _d = db; (await db.ProviderSettings.SingleAsync()).TimeZoneId = null; await db.SaveChangesAsync(); }
        { var (db, _) = Request(tenantId); await using var _d = db; Assert.Equal(new DateOnly(2026, 11, 1), await ProviderTimeZoneResolver.TodayAsync(db, tenantId, clock, CancellationToken.None)); }
    }

    [SkippableFact]
    public async Task A_zone_change_on_a_stale_form_is_a_409_with_no_change_and_no_audit_row()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            seed.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Test Org", State = "VIC", AccountNumber = "111" });
            await seed.SaveChangesAsync();
        }
        DateTime loaded;
        { var (db, c) = Request(tenantId); await using var _ = db; loaded = await LoadedAsync(c); }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Upsert(Form("222", loaded), CancellationToken.None)).Result); }

        var stale = Form("222", loaded, "Australia/Perth");
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<ConflictObjectResult>((await c.Upsert(stale, CancellationToken.None)).Result); }

        var (check, _c) = Request(tenantId);
        await using (check)
        {
            Assert.Null((await check.ProviderSettings.SingleAsync()).TimeZoneId);
            Assert.Empty(await check.AuditLogs.Where(a => a.Changes.Contains("TimeZoneId")).ToListAsync());
        }
    }
}
