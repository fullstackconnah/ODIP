using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>Every audit row names the organisation it belongs to, so the Deleted records list can show an organisation only its own deletions.</summary>
public class AuditInterceptorTenantTests
{
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid B = Guid.NewGuid();

    private static DbContextOptions<OdipDbContext> Options(params IInterceptor[] extra) => new DbContextOptionsBuilder<OdipDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .AddInterceptors([new AuditInterceptor(new HttpContextAccessor()), .. extra])
        .Options;

    // A SuperAdmin context (no query filter in the way) acting in `ambient`: A when viewing as A, null when not viewing an organisation.
    private static OdipDbContext Db(DbContextOptions<OdipDbContext> options, Guid? ambient)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(ambient);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(options, tenant.Object);
    }

    private static async Task<AuditLog> DeletedRowAsync<T>(Guid? ambient, T entity) where T : class
    {
        var options = Options();
        await using (var seed = Db(options, ambient)) { seed.Add(entity); await seed.SaveChangesAsync(); }
        await using (var db = Db(options, ambient))
        {
            db.Remove(await db.FindAsync<T>(db.Entry(entity).Property("Id").CurrentValue));
            await db.SaveChangesAsync();
        }
        await using var check = Db(options, ambient);
        return await check.AuditLogs.SingleAsync(a => a.Action == AuditAction.Deleted);
    }

    private static ParticipantRiskEntry Risk(Guid tenant) => new() { Id = Guid.NewGuid(), TenantId = tenant, Description = "Choking risk" };

    [Fact]
    public async Task A_deleted_tenant_row_takes_its_own_tenant_not_the_one_the_request_views_as()
    {
        Assert.Equal(B, (await DeletedRowAsync(A, Risk(B))).TenantId);
    }

    [Fact]
    public async Task A_deleted_tenant_row_keeps_its_own_tenant_when_no_organisation_is_in_scope()
    {
        Assert.Equal(B, (await DeletedRowAsync(null, Risk(B))).TenantId);
    }

    [Fact]
    public async Task A_row_without_a_tenant_column_takes_the_requests_tenant()
    {
        var availability = new StaffAvailability { Id = Guid.NewGuid(), UserId = Guid.NewGuid(), AvailabilityType = AvailabilityType.Unavailable };
        Assert.Equal(A, (await DeletedRowAsync(A, availability)).TenantId);
    }

    [Fact]
    public async Task A_row_without_a_tenant_column_gets_null_when_no_organisation_is_in_scope()
    {
        var availability = new StaffAvailability { Id = Guid.NewGuid(), UserId = Guid.NewGuid(), AvailabilityType = AvailabilityType.Unavailable };
        Assert.Null((await DeletedRowAsync(null, availability)).TenantId);
    }

    [Fact]
    public async Task A_nullable_own_tenant_that_is_null_stays_null()
    {
        Assert.Null((await DeletedRowAsync(A, new TripClaim { Id = Guid.NewGuid(), TenantId = null })).TenantId);
    }

    [Fact]
    public async Task Global_tables_get_no_tenant()
    {
        var entry = new WhatsNewEntry { Id = Guid.NewGuid(), Key = "k", Title = "t", Body = "b" };
        Assert.Null((await DeletedRowAsync(A, entry)).TenantId);

        // C1: the maintained holiday rows are global like PublicHoliday.
        var holiday = new PublicHolidayOverride { Id = Guid.NewGuid(), Name = "Show day", Source = "test" };
        Assert.Null((await DeletedRowAsync(A, holiday)).TenantId);
    }

    [Fact]
    public async Task A_created_row_carries_the_tenant_the_save_stamped_on_its_entity()
    {
        var options = Options();
        await using (var db = Db(options, A))
        {
            db.Add(new ParticipantRiskEntry { Id = Guid.NewGuid(), Description = "x" });
            await db.SaveChangesAsync();
        }
        await using var check = Db(options, A);
        Assert.Equal(A, (await check.AuditLogs.SingleAsync()).TenantId);
    }

    [Fact]
    public async Task A_hand_written_row_takes_the_requests_tenant_but_a_global_one_stays_null()
    {
        var options = Options();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("fullName", "Admin")], "Test"));
        await using (var db = Db(options, A))
        {
            db.AuditLogs.Add(SettingChangeAudit.ForFieldChange("ProviderSettings", Guid.NewGuid(), "Name", "a", "b", principal));
            db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = nameof(EarlyAccessRequest), EntityId = Guid.NewGuid(), Action = AuditAction.Updated });
            await db.SaveChangesAsync();
        }
        await using var check = Db(options, A);
        Assert.Equal(A, (await check.AuditLogs.SingleAsync(a => a.EntityType == "ProviderSettings")).TenantId);
        Assert.Null((await check.AuditLogs.SingleAsync(a => a.EntityType == nameof(EarlyAccessRequest))).TenantId);
    }

    [Fact]
    public async Task A_demo_save_stamps_the_demo_tenant_on_an_added_row()
    {
        var options = Options(new DemoAuditStampInterceptor(new DemoAuditStamps()));
        await using (var db = Db(options, A))
        {
            db.Add(Risk(A));
            await db.SaveChangesAsync();
        }
        await using var check = Db(options, A);
        Assert.Equal(A, (await check.AuditLogs.SingleAsync()).TenantId);
    }
}
