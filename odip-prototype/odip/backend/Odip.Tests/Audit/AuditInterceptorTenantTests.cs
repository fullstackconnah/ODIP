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

    private static readonly Guid Home = Guid.NewGuid();

    // `ambient` is the organisation in scope: A when viewing as A (IsSuperAdmin cleared, as CurrentTenant does under view-as); null is an unscoped
    // SuperAdmin, whose token still carries a home tenant.
    private static OdipDbContext Db(DbContextOptions<OdipDbContext> options, Guid? ambient)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(ambient ?? Home);
        tenant.Setup(t => t.IsSuperAdmin).Returns(ambient is null);
        return new OdipDbContext(options, tenant.Object);
    }

    private static async Task<AuditLog> DeletedRowAsync<T>(Guid? ambient, T entity) where T : class
    {
        var options = Options();
        await using (var seed = Db(options, ambient)) { seed.Add(entity); await seed.SaveChangesAsync(); }
        await using (var db = Db(options, ambient))
        {
            db.Remove(entity); // the seeded instance: a scoped context would not find a row of another organisation through its query filter
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
    public async Task Rows_without_a_tenant_column_get_no_tenant_for_an_unscoped_SuperAdmin_whose_token_has_a_home_tenant()
    {
        var assignment = new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = Guid.NewGuid(), UserId = Guid.NewGuid() };
        Assert.Null((await DeletedRowAsync(null, assignment)).TenantId);

        var options = Options();
        await using (var db = Db(options, null))
        {
            db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "StaffAssignment", EntityId = Guid.NewGuid(), Action = AuditAction.Created });
            await db.SaveChangesAsync();
        }
        await using var check = Db(options, null);
        Assert.Null((await check.AuditLogs.SingleAsync()).TenantId);
    }

    [Fact]
    public async Task An_entity_with_an_empty_tenant_id_takes_the_requests_tenant()
    {
        Assert.Equal(A, (await DeletedRowAsync(A, new TripClaim { Id = Guid.NewGuid(), TenantId = Guid.Empty })).TenantId);
    }

    // H76-2: a claim with a null TenantId was deleted into an audit row no organisation could list under Deleted records.
    [Fact]
    public async Task A_nullable_own_tenant_that_is_null_takes_the_requests_tenant()
    {
        Assert.Equal(A, (await DeletedRowAsync(A, new TripClaim { Id = Guid.NewGuid(), TenantId = null })).TenantId);
    }

    [Fact]
    public async Task A_claim_with_a_tenant_keeps_it_under_a_view_as_of_that_organisation()
    {
        Assert.Equal(A, (await DeletedRowAsync(A, new TripClaim { Id = Guid.NewGuid(), TenantId = A })).TenantId);
    }

    // P60-D2: the case above passes whether TenantOf reads the claim or always returns the ambient tenant; this one needs the claim's own value.
    [Fact]
    public async Task A_claim_of_another_organisation_keeps_its_own_tenant_under_a_view_as()
    {
        Assert.Equal(B, (await DeletedRowAsync(A, new TripClaim { Id = Guid.NewGuid(), TenantId = B })).TenantId);
    }

    // P60-D3: an old claim with no tenant, deleted by an unscoped SuperAdmin, has no organisation to fall back to.
    [Fact]
    public async Task A_claim_with_no_tenant_deleted_with_no_organisation_in_scope_gets_a_null_audit_tenant()
    {
        Assert.Null((await DeletedRowAsync(null, new TripClaim { Id = Guid.NewGuid(), TenantId = null })).TenantId);
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
