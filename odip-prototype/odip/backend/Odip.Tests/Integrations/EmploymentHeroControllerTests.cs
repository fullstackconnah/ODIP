using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;
using static Odip.Tests.Integrations.StubHttpHandler;

namespace Odip.Tests.Integrations;

/// <summary>The Employment Hero card's API. The key is checked with one call, stored encrypted and never sent back. Each organisation sees only its own connection.</summary>
public class EmploymentHeroControllerTests
{
    private static EmploymentHeroController Controller(OdipDbContext db, Guid? tenantId, StubHttpHandler eh, IntegrationKeyProtector? keys = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        return new EmploymentHeroController(db, tenant.Object, keys ?? Keys, Client(eh), Sync(eh, keys), Clock())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } },
        };
    }

    private static async Task<(OdipDbContext Db, Guid Tenant)> OrganisationAsync(bool connected)
    {
        var tenant = Guid.NewGuid();
        var db = Db(Guid.NewGuid().ToString(), tenant);
        if (connected) await ConnectAsync(db, tenant);
        else
        {
            db.Tenants.Add(new Tenant { Id = tenant, Name = "Acme Care", EmailDomain = "acme.org.au" });
            await db.SaveChangesAsync();
        }
        return (db, tenant);
    }

    private static T Data<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    /// <summary>The status code and the one error of a refusal, whatever the type of its envelope.</summary>
    private static (int Status, string Error) Refusal<T>(ActionResult<T> result)
    {
        var refusal = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        var errors = (List<string>)refusal.Value!.GetType().GetProperty("Errors")!.GetValue(refusal.Value)!;
        return (refusal.StatusCode ?? 0, Assert.Single(errors));
    }

    private static StubHttpHandler Business777() => new StubHttpHandler().On("/api/v2/business/777", HttpStatusCode.OK, new { id = 777, name = "Acme Care" });

    [Fact]
    public async Task Status_says_whether_integrations_are_set_up_and_whether_the_organisation_is_connected()
    {
        var (db, tenant) = await OrganisationAsync(connected: false);
        await using var _ = db;

        var status = Data(await Controller(db, tenant, Eh()).Status(CancellationToken.None));
        var off = Data(await Controller(db, tenant, Eh(), IntegrationKeyProtectorTests.Protector(null)).Status(CancellationToken.None));

        Assert.Equal((true, false), (status.Configured, status.Connected));
        Assert.Equal((false, false), (off.Configured, off.Connected));
    }

    [Fact]
    public async Task Connecting_is_refused_when_the_server_has_no_master_key()
    {
        var (db, tenant) = await OrganisationAsync(connected: false);
        await using var _ = db;
        var eh = Business777();

        var result = await Controller(db, tenant, eh, IntegrationKeyProtectorTests.Protector(null)).Connect(new EmploymentHeroConnectDto(ApiKey, "777"), CancellationToken.None);

        Assert.Equal((409, IntegrationKeyProtector.NotConfiguredMessage), Refusal(result));
        Assert.Empty(db.EmploymentHeroConnections);
        Assert.Empty(eh.Requests);
    }

    [Fact]
    public async Task Connect_checks_key_and_business_with_one_EH_call_stores_the_key_encrypted_and_never_returns_it()
    {
        var (db, tenant) = await OrganisationAsync(connected: false);
        await using var _ = db;
        var eh = Business777();

        var result = await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto($"  {ApiKey} ", "777"), CancellationToken.None);

        var status = Data(result);
        Assert.Equal((true, "777", "Acme Care", "Ada Admin"), (status.Connected, status.BusinessId, status.BusinessName, status.ConnectedByName));
        Assert.Single(eh.Requests);
        Assert.DoesNotContain(ApiKey, JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result.Result).Value));
        var conn = await db.EmploymentHeroConnections.SingleAsync();
        Assert.Equal(ApiKey, Keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenant));
        Assert.Equal(ImportTestSupport.AdminId, conn.ConnectedById);
        var audit = await db.AuditLogs.SingleAsync(a => a.EntityType == nameof(EmploymentHeroConnection));
        Assert.Contains("API key", audit.Changes);
        Assert.Contains("changed", audit.Changes);
        Assert.DoesNotContain(ApiKey, audit.Changes);
        Assert.Equal("Ada Admin", audit.ChangedByName);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "Employment Hero didn't accept the API key. Check it in Employment Hero and connect again.")]
    [InlineData(HttpStatusCode.NotFound, "Employment Hero couldn't find that business or employee for this API key.")]
    public async Task A_refused_key_or_unknown_business_saves_nothing(HttpStatusCode answer, string error)
    {
        var (db, tenant) = await OrganisationAsync(connected: false);
        await using var _ = db;

        var result = await Controller(db, tenant, new StubHttpHandler().On("/api/v2/business/777", answer)).Connect(new EmploymentHeroConnectDto(ApiKey, "777"), CancellationToken.None);

        Assert.Equal((400, error), Refusal(result));
        Assert.Empty(db.EmploymentHeroConnections);
        Assert.Empty(db.AuditLogs.Where(a => a.EntityType == nameof(EmploymentHeroConnection)));
    }

    [Fact]
    public async Task Businesses_lists_what_the_pasted_key_can_see_and_stores_nothing()
    {
        var (db, tenant) = await OrganisationAsync(connected: false);
        await using var _ = db;
        var eh = new StubHttpHandler().On("/api/v2/business", HttpStatusCode.OK, new[] { new { id = 2, name = "Zeta Care" }, new { id = 1, name = "Acme Care" } });

        var businesses = Data(await Controller(db, tenant, eh).Businesses(new EmploymentHeroKeyDto(ApiKey), CancellationToken.None));

        Assert.Equal(new[] { new EmploymentHeroBusinessDto("1", "Acme Care"), new EmploymentHeroBusinessDto("2", "Zeta Care") }, businesses);
        Assert.Empty(db.EmploymentHeroConnections);
    }

    [Fact]
    public async Task Reconnecting_to_another_business_forgets_the_links_and_the_same_business_keeps_them()
    {
        var (db, tenant) = await OrganisationAsync(connected: true);
        await using var _ = db;
        var sam = EhFixture.Staff(tenant, "Sam", "Lee", "sam@acme.org.au", "101");
        db.Users.Add(sam);
        db.EmploymentHeroAttentions.Add(new EmploymentHeroAttention { Id = Guid.NewGuid(), TenantId = tenant, Key = "NotLinked:x", Name = "Jo", Reason = "r" });
        await db.SaveChangesAsync();
        var eh = Business777().On("/api/v2/business/888", HttpStatusCode.OK, new { id = 888, name = "Acme Care (new)" });

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "777"), CancellationToken.None);
        Assert.Equal("101", sam.ExternalPayrollId);

        await Controller(db, tenant, eh).Connect(new EmploymentHeroConnectDto(ApiKey, "888"), CancellationToken.None);
        Assert.Null(sam.ExternalPayrollId);
        Assert.Null((await db.Users.SingleAsync(u => u.FirstName == "Ada")).ExternalPayrollId);
        Assert.Empty(db.EmploymentHeroAttentions);
        Assert.Equal("888", (await db.EmploymentHeroConnections.SingleAsync()).BusinessId);
    }

    [Fact]
    public async Task Disconnect_deletes_the_connection_and_its_items_and_keeps_the_links()
    {
        var (db, tenant) = await OrganisationAsync(connected: true);
        await using var _ = db;
        db.EmploymentHeroAttentions.Add(new EmploymentHeroAttention { Id = Guid.NewGuid(), TenantId = tenant, Key = "NotLinked:x", Name = "Jo", Reason = "r" });
        await db.SaveChangesAsync();

        var status = Data(await Controller(db, tenant, Eh()).Disconnect(CancellationToken.None));

        Assert.False(status.Connected);
        Assert.Empty(db.EmploymentHeroConnections);
        Assert.Empty(db.EmploymentHeroAttentions);
        Assert.Equal("1", (await db.Users.SingleAsync(u => u.FirstName == "Ada")).ExternalPayrollId);
        Assert.Contains("disconnected", (await db.AuditLogs.SingleAsync(a => a.EntityType == nameof(EmploymentHeroConnection))).Changes);
    }

    [Fact]
    public async Task Sync_now_runs_this_organisation_and_is_refused_when_not_connected()
    {
        var (db, tenant) = await OrganisationAsync(connected: true);
        await using var _ = db;
        var (other, otherTenant) = await OrganisationAsync(connected: false);
        await using var __ = other;

        var status = Data(await Controller(db, tenant, Eh(Employee(101, "Ana", "Ruiz", "ana@gmail.com"))).SyncNow(CancellationToken.None));
        var refused = await Controller(other, otherTenant, Eh()).SyncNow(CancellationToken.None);

        Assert.Equal((2, 0, (string?)null), (status.StaffLinked, status.StaffNotLinked, status.LastSyncError));
        Assert.NotNull(status.LastSyncAt);
        Assert.Equal((409, "Connect Employment Hero first."), Refusal(refused));
    }

    [Fact]
    public async Task An_unscoped_SuperAdmin_must_choose_an_organisation()
    {
        var (db, _) = await OrganisationAsync(connected: true);
        await using var __ = db;

        var result = await Controller(db, null, Eh()).Status(CancellationToken.None);

        Assert.Equal((400, EmploymentHeroController.ChooseOrganisation), Refusal(result));
    }

    [Fact]
    public async Task Another_organisations_connection_and_items_never_show()
    {
        var name = Guid.NewGuid().ToString();
        Guid mine = Guid.NewGuid(), theirs = Guid.NewGuid();
        await using (var setup = Db(name, theirs))
        {
            await ConnectAsync(setup, theirs);
            setup.EmploymentHeroAttentions.Add(new EmploymentHeroAttention { Id = Guid.NewGuid(), TenantId = theirs, Key = "NotLinked:x", Name = "Their person", Reason = "r" });
            await setup.SaveChangesAsync();
        }
        await using var db = Db(name, mine);

        var status = Data(await Controller(db, mine, Eh()).Status(CancellationToken.None));

        Assert.Equal((false, 0, 0), (status.Connected, status.StaffLinked, status.StaffNotLinked));
        Assert.Empty(status.Attention);
    }

    private static async Task<(OdipDbContext Db, Guid Tenant, User Jane, EmploymentHeroAttention Item)> WaitingJaneAsync()
    {
        var (db, tenant) = await OrganisationAsync(connected: true);
        var jane = EhFixture.Staff(tenant, "Jane", "Smith", "jane@gmail.com");
        var item = new EmploymentHeroAttention
        {
            Id = Guid.NewGuid(), TenantId = tenant, Key = $"NotLinked:{jane.Id}", Kind = EmploymentHeroAttentionKind.NotLinked, UserId = jane.Id,
            ExternalEmployeeId = "301", Name = "Jane Smith", Reason = "No Employment Hero employee has their email.",
        };
        db.Users.Add(jane);
        db.EmploymentHeroAttentions.Add(item);
        await db.SaveChangesAsync();
        return (db, tenant, jane, item);
    }

    [Fact]
    public async Task The_picker_lists_only_EH_employees_nobody_here_is_linked_to()
    {
        var (db, tenant, _, _) = await WaitingJaneAsync();
        await using var __ = db;

        var employees = Data(await Controller(db, tenant, Eh(Employee(301, "Jane", "Smith", "jane.smith@acme.org.au"))).UnlinkedEmployees(CancellationToken.None));

        Assert.Equal(new[] { new EmploymentHeroEmployeeDto("301", "Jane Smith", "jane.smith@acme.org.au") }, employees);   // Ada (EH id 1) is linked
    }

    [Fact]
    public async Task Link_ties_the_waiting_person_to_the_EH_employee_and_clears_the_item()
    {
        var (db, tenant, jane, item) = await WaitingJaneAsync();
        await using var _ = db;
        var eh = new StubHttpHandler().On("/api/v2/business/777/employee/301/details", HttpStatusCode.OK, Employee(301, "Jane", "Smith", "jane.smith@acme.org.au"));

        var status = Data(await Controller(db, tenant, eh).Link(item.Id, new EmploymentHeroLinkDto("301"), CancellationToken.None));

        Assert.Equal("301", jane.ExternalPayrollId);
        Assert.Empty(status.Attention);
        Assert.Empty(db.EmploymentHeroAttentions);
    }

    [Fact]
    public async Task Link_refuses_an_EH_employee_already_linked_or_unknown_to_EH()
    {
        var (db, tenant, jane, item) = await WaitingJaneAsync();
        await using var _ = db;
        var eh = new StubHttpHandler();   // EH answers 404 for employee 999

        var taken = await Controller(db, tenant, eh).Link(item.Id, new EmploymentHeroLinkDto("1"), CancellationToken.None);   // Ada's
        var unknown = await Controller(db, tenant, eh).Link(item.Id, new EmploymentHeroLinkDto("999"), CancellationToken.None);

        Assert.Equal((409, "That Employment Hero employee is already linked to someone in ODIP."), Refusal(taken));
        Assert.Equal((400, "Employment Hero couldn't find that business or employee for this API key."), Refusal(unknown));
        Assert.Null(jane.ExternalPayrollId);
        Assert.Single(db.EmploymentHeroAttentions);
    }

    [Fact]
    public async Task Leave_unlinked_hides_the_item_and_the_next_sync_keeps_it_hidden()
    {
        var (db, tenant, jane, item) = await WaitingJaneAsync();
        await using var _ = db;

        var dismissed = Data(await Controller(db, tenant, Eh()).Dismiss(item.Id, CancellationToken.None));
        var afterSync = Data(await Controller(db, tenant, Eh()).SyncNow(CancellationToken.None));

        Assert.Empty(dismissed.Attention);
        Assert.Empty(afterSync.Attention);
        Assert.Null(jane.ExternalPayrollId);
        Assert.Equal(1, afterSync.StaffNotLinked);
    }

    [Fact]
    public async Task Another_organisations_item_cannot_be_linked_or_dismissed()
    {
        var (db, _, _, item) = await WaitingJaneAsync();
        await using var __ = db;
        // Another organisation's Admin. The controller's own organisation check is under test here; in production the query filter is a second wall.
        var stranger = Guid.NewGuid();

        var link = await Controller(db, stranger, Eh()).Link(item.Id, new EmploymentHeroLinkDto("301"), CancellationToken.None);
        var dismiss = await Controller(db, stranger, Eh()).Dismiss(item.Id, CancellationToken.None);

        Assert.Equal(404, Refusal(link).Status);
        Assert.Equal(404, Refusal(dismiss).Status);
        Assert.Null((await db.EmploymentHeroAttentions.SingleAsync()).DismissedAt);
    }

    /// <summary>A save the database refuses, as the payroll-id index does when the sync linked the same EH employee a moment earlier.</summary>
    private sealed class RefusingSave : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            throw new DbUpdateException("duplicate key value violates unique constraint \"IX_Users_TenantId_ExternalPayrollId\"");
    }

    [Fact]
    public async Task A_link_that_loses_a_race_with_the_sync_answers_409_not_500()
    {
        var name = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        Guid itemId;
        await using (var setup = Db(name, tenant))
        {
            await ConnectAsync(setup, tenant);
            var jane = EhFixture.Staff(tenant, "Jane", "Smith", "jane@gmail.com");
            var item = new EmploymentHeroAttention
            {
                Id = Guid.NewGuid(), TenantId = tenant, Key = $"NotLinked:{jane.Id}", Kind = EmploymentHeroAttentionKind.NotLinked, UserId = jane.Id,
                Name = "Jane Smith", Reason = "No Employment Hero employee has their email.",
            };
            setup.Users.Add(jane);
            setup.EmploymentHeroAttentions.Add(item);
            await setup.SaveChangesAsync();
            itemId = item.Id;
        }
        await using var racing = new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).AddInterceptors(new RefusingSave()).Options, ImportTestSupport.Tenant(tenant));
        var eh = new StubHttpHandler().On("/api/v2/business/777/employee/301/details", HttpStatusCode.OK, Employee(301, "Jane", "Smith", "jane.smith@acme.org.au"));

        var result = await Controller(racing, tenant, eh).Link(itemId, new EmploymentHeroLinkDto("301"), CancellationToken.None);

        Assert.Equal((409, "That Employment Hero employee is already linked to someone in ODIP."), Refusal(result));
    }
}
