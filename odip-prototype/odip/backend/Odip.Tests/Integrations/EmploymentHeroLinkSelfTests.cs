using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Imports;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;
using static Odip.Tests.Integrations.StubHttpHandler;

namespace Odip.Tests.Integrations;

/// <summary>
/// The link that decides whose payslips a person sees needs a second person: an Admin can't link their own account (403), and every link is audited
/// with who linked whom. The audit row comes from the existing User auditing; these tests pin it.
/// </summary>
public class EmploymentHeroLinkSelfTests
{
    /// <summary>A plain accessor: HttpContextAccessor keeps its context in an AsyncLocal, which an async setup method would not carry back to the test.</summary>
    private sealed class FixedAccessor(HttpContext http) : IHttpContextAccessor
    {
        public HttpContext? HttpContext { get; set; } = http;
    }

    private sealed record Setup(OdipDbContext Db, DefaultHttpContext Http, Guid Tenant, User Bea, User Ada, EmploymentHeroAttention Item, StubHttpHandler Eh);

    /// <summary>Acme is connected. Bea is an unlinked Admin (the id of ImportTestSupport.Admin()) with a NotLinked item; EH employee 77 exists. The db audits as the caller of <c>http</c>.</summary>
    private static async Task<Setup> AcmeAsync()
    {
        var name = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        User ada;
        await using (var seed = Db(name, tenant)) { await ConnectAsync(seed, tenant); ada = seed.Users.Single(u => u.FirstName == "Ada"); }
        var http = new DefaultHttpContext();
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name)
            .AddInterceptors(new AuditInterceptor(new FixedAccessor(http))).Options, ImportTestSupport.Tenant(tenant));
        var bea = EhFixture.Staff(tenant, "Bea", "Boss", "bea@gmail.com", null, UserRole.Admin);
        bea.Id = ImportTestSupport.AdminId;
        var item = new EmploymentHeroAttention
        {
            Id = Guid.NewGuid(), TenantId = tenant, Key = $"NotLinked:{bea.Id}", Kind = EmploymentHeroAttentionKind.NotLinked, UserId = bea.Id,
            ExternalEmployeeId = "77", Name = "Bea Boss", Reason = "No Employment Hero employee has their email.",
        };
        db.Users.Add(bea);
        db.EmploymentHeroAttentions.Add(item);
        await db.SaveChangesAsync();
        var eh = new StubHttpHandler().On("/api/v2/business/777/employee/77/details", HttpStatusCode.OK, Employee(77, "Bea", "Boss", "bea@acme.org.au"));
        return new Setup(db, http, tenant, bea, ada, item, eh);
    }

    private static EmploymentHeroController Controller(Setup s, ClaimsPrincipal caller)
    {
        s.Http.User = caller;
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(s.Tenant);
        return new EmploymentHeroController(s.Db, tenant.Object, Keys, Client(s.Eh), Sync(s.Eh), Clock()) { ControllerContext = new ControllerContext { HttpContext = s.Http } };
    }

    private static Task<List<AuditLog>> UpdatesOf(OdipDbContext db, Guid userId) =>
        db.AuditLogs.IgnoreQueryFilters().Where(a => a.EntityType == "User" && a.EntityId == userId && a.Action == AuditAction.Updated).ToListAsync();

    [Fact]
    public async Task An_Admin_linking_their_own_account_is_refused_and_nothing_is_written()
    {
        var s = await AcmeAsync();
        await using var _ = s.Db;

        var result = await Controller(s, ImportTestSupport.Admin()).Link(s.Item.Id, new EmploymentHeroLinkDto("77"), CancellationToken.None);

        var refusal = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(403, refusal.StatusCode);
        Assert.Equal(EmploymentHeroController.LinkOwnAccountMessage, Assert.Single(Assert.IsType<ApiResponse<EmploymentHeroStatusDto>>(refusal.Value).Errors!));
        Assert.Null((await s.Db.Users.SingleAsync(u => u.Id == s.Bea.Id)).ExternalPayrollId);
        Assert.True(await s.Db.EmploymentHeroAttentions.AnyAsync(a => a.Id == s.Item.Id));
        Assert.Empty(await UpdatesOf(s.Db, s.Bea.Id));
        Assert.Empty(s.Eh.Requests);
    }

    [Fact]
    public async Task Another_Admins_link_is_audited_and_payslips_follow_it()
    {
        var s = await AcmeAsync();
        await using var _ = s.Db;
        var ada = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin"), new Claim(ClaimTypes.NameIdentifier, s.Ada.Id.ToString()), new Claim("fullName", "Ada Admin")], "Test"));

        var result = await Controller(s, ada).Link(s.Item.Id, new EmploymentHeroLinkDto("77"), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var audit = Assert.Single(await UpdatesOf(s.Db, s.Bea.Id));
        Assert.Equal((s.Ada.Id, "Ada Admin"), (audit.ChangedById, audit.ChangedByName));
        Assert.Contains("ExternalPayrollId", audit.Changes);
        Assert.Contains("77", audit.Changes);
        // The payslips then follow the link: each person's own EH employee id, and no other.
        var ehPayslips = new StubHttpHandler();
        foreach (var (user, expected) in new[] { (s.Bea, "/api/v2/ess/77/document/payslip"), (s.Ada, "/api/v2/ess/1/document/payslip") })
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(s.Tenant);
            var payslips = new PortalPayslipsController(s.Db, tenant.Object, Keys, Client(ehPayslips))
            {
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.Id.ToString())], "Test")) } },
            };
            await payslips.List(CancellationToken.None);
            Assert.Equal(expected, ehPayslips.Requests[^1].RequestUri!.AbsolutePath);
        }
        Assert.Equal(2, ehPayslips.Requests.Count);
    }
}
