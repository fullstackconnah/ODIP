using System.Collections.Concurrent;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;

namespace Odip.Tests.Integrations;

/// <summary>
/// Leave balances, read live from a fake EH. Each person sees their own (view-as included); an Admin sees their organisation's staff only;
/// every failure is one sentence in ODIP's words; nothing is saved, audited or logged.
/// </summary>
public class LeaveBalancesControllerTests
{
    private const string Path = "/api/v2/business/777/employee/42/leavebalances";

    private static LeaveBalancesController Controller(OdipDbContext db, Guid? tenantId, Guid callerId, StubHttpHandler eh, Guid? viewAs = null, bool superAdmin = false, IntegrationKeyProtector? keys = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAs);
        return new LeaveBalancesController(db, tenant.Object, keys ?? Keys, StubHttpHandler.Client(eh))
        {
            ControllerContext = new ControllerContext { HttpContext = HttpFor(callerId) },
        };
    }

    private static DefaultHttpContext HttpFor(Guid callerId) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerId.ToString()), new Claim(ClaimTypes.Role, "SupportWorker")], "Test")),
    };

    private static async Task<(OdipDbContext Db, string Name, Guid Tenant, User Sam)> OrganisationAsync(bool connected = true, string? payrollId = "42", IntegrationKeyProtector? keys = null)
    {
        var name = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        var db = Db(name, tenant);
        if (connected) await ConnectAsync(db, tenant, keys);
        else db.Tenants.Add(new Tenant { Id = tenant, Name = "Acme Care", EmailDomain = "acme.org.au" });
        var sam = EhFixture.Staff(tenant, "Sam", "Lee", "sam@acme.org.au", payrollId);
        db.Users.Add(sam);
        await db.SaveChangesAsync();
        return (db, name, tenant, sam);
    }

    private static StubHttpHandler Eh() => new StubHttpHandler().On(HttpMethod.Get, Path, HttpStatusCode.OK, new object[]
    {
        new { leaveCategoryName = "Personal leave", accruedAmount = 20.5, unitType = "Hours" },
        new { leaveCategoryName = "Annual leave", accruedAmount = 76.0, unitType = "Hours" },
        new { leaveCategoryName = (string?)null, accruedAmount = (double?)null, unitType = (string?)null },
    });

    private static T Data<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [Fact]
    public async Task Staff_see_their_own_balances_from_EH()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = Eh();

        var data = Data(await Controller(db, tenant, sam.Id, eh).Mine(CancellationToken.None));

        Assert.Equal(LeaveBalancesDto.Ready, data.Status);
        Assert.Equal([("Annual leave", 76.0m, "Hours"), ("Leave", 0m, "Hours"), ("Personal leave", 20.5m, "Hours")], data.Balances.Select(b => (b.Category, b.Amount, b.Unit)));
        Assert.Equal(1, eh.Requests.Count(r => r.RequestUri!.AbsolutePath == Path));
    }

    [Fact]
    public async Task Balances_follow_view_as_like_My_leave()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = Eh();

        var data = Data(await Controller(db, tenant, Guid.NewGuid(), eh, viewAs: sam.Id).Mine(CancellationToken.None));

        Assert.Equal(LeaveBalancesDto.Ready, data.Status);
        Assert.Single(eh.Requests, r => r.RequestUri!.AbsolutePath == Path);
    }

    [Theory]
    [InlineData(false, "42", LeaveBalancesDto.NotConnected)]
    [InlineData(true, null, LeaveBalancesDto.NotLinked)]
    public async Task Not_connected_and_not_linked_answer_without_calling_EH(bool connected, string? payrollId, string expected)
    {
        var (db, _, tenant, sam) = await OrganisationAsync(connected, payrollId);
        await using var _ = db;
        var eh = Eh();

        var data = Data(await Controller(db, tenant, sam.Id, eh).Mine(CancellationToken.None));

        Assert.Equal((expected, 0), (data.Status, data.Balances.Count));
        Assert.Empty(eh.Requests);
    }

    [Fact]
    public async Task An_unscoped_SuperAdmin_gets_NotConnected_from_both_routes_without_calling_EH()
    {
        var (db, _, _, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = Eh();
        var controller = Controller(db, null, sam.Id, eh, superAdmin: true);

        Assert.Equal(LeaveBalancesDto.NotConnected, Data(await controller.Mine(CancellationToken.None)).Status);
        Assert.Equal(LeaveBalancesDto.NotConnected, Data(await controller.ForStaff(Guid.NewGuid(), CancellationToken.None)).Status);
        Assert.Empty(eh.Requests);
    }

    [Fact]
    public async Task An_Admin_sees_their_own_staff_members_balances()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;

        var data = Data(await Controller(db, tenant, Guid.NewGuid(), Eh()).ForStaff(sam.Id, CancellationToken.None));

        Assert.Equal(LeaveBalancesDto.Ready, data.Status);
        Assert.Equal(3, data.Balances.Count);
    }

    [Fact]
    public async Task A_staff_member_of_another_organisation_is_404_and_calls_nobody()
    {
        var (theirDb, name, _, theirs) = await OrganisationAsync();
        await using var _ = theirDb;
        var mine = Guid.NewGuid();
        await using var db = Db(name, mine);
        await ConnectAsync(db, mine);
        var eh = Eh();

        var result = await Controller(db, mine, Guid.NewGuid(), eh).ForStaff(theirs.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Empty(eh.Requests);
    }

    [Theory]
    [InlineData("401")]
    [InlineData("404")]
    [InlineData("429")]
    [InlineData("500")]
    [InlineData("timeout")]
    [InlineData("key")]
    public async Task Any_EH_failure_is_503_in_the_spec_words(string failure)
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = failure switch
        {
            "timeout" => Eh(),
            "key" => Eh(),
            _ => new StubHttpHandler().On(HttpMethod.Get, Path, (HttpStatusCode)int.Parse(failure), new { detail = "Your key is wrong, Admin." }, retryAfter: failure == "429" ? TimeSpan.FromSeconds(1) : (TimeSpan?)null),
        };
        if (failure == "timeout") eh.BeforeAnswer = _ => throw new TaskCanceledException("timed out");

        var result = await Controller(db, tenant, sam.Id, eh, keys: failure == "key" ? IntegrationKeyProtectorTests.Protector(null) : null).Mine(CancellationToken.None);

        var refusal = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(503, refusal.StatusCode);
        Assert.Equal([LeaveBalancesController.UnavailableMessage], ((ApiResponse<LeaveBalancesDto>)refusal.Value!).Errors);
    }

    [Fact]
    public async Task Balances_are_never_saved_audited_or_logged()
    {
        var (db, name, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var auditBefore = await db.AuditLogs.IgnoreQueryFilters().CountAsync();

        await using (var readOnly = new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).AddInterceptors(new ThrowOnSave()).Options, Odip.Tests.Imports.ImportTestSupport.Tenant(tenant)))
        {
            var controller = Controller(readOnly, tenant, sam.Id, Eh());
            Assert.Equal(LeaveBalancesDto.Ready, Data(await controller.Mine(CancellationToken.None)).Status);
        }
        Assert.Equal(auditBefore, await db.AuditLogs.IgnoreQueryFilters().CountAsync());

        // The client is built the way Program.cs builds it, and the controller from the same provider, so a logger either class ever gains writes into the capture.
        var logs = new CapturedLogs();
        var tenantMock = new Mock<ICurrentTenant>();
        tenantMock.Setup(t => t.TenantId).Returns(tenant);
        var services = new ServiceCollection()
            .AddLogging(b => b.SetMinimumLevel(LogLevel.Trace).AddProvider(logs))
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .AddSingleton(db).AddSingleton(tenantMock.Object).AddSingleton(Keys);
        services.AddHttpClient<EmploymentHeroClient>(c => c.Timeout = TimeSpan.FromSeconds(30))
            .RedactLoggedHeaders(new[] { "Authorization" }).ConfigurePrimaryHttpMessageHandler(() => Eh());
        await using var provider = services.BuildServiceProvider();
        var logged = ActivatorUtilities.CreateInstance<LeaveBalancesController>(provider);
        logged.ControllerContext = new ControllerContext { HttpContext = HttpFor(sam.Id) };

        await logged.Mine(CancellationToken.None);

        Assert.NotEmpty(logs.Messages);   // HttpClient logs each request, so the capture is real
        Assert.DoesNotContain(logs.Messages, m => m.Contains(ApiKey) || m.Contains("76.0") || m.Contains("20.5"));
        Assert.DoesNotContain(typeof(LeaveBalancesController).GetConstructors().SelectMany(c => c.GetParameters()), p => p.ParameterType.Name.StartsWith("ILogger"));
    }

    [Fact]
    public void Any_signed_in_role_reaches_My_balances_and_only_Admins_reach_a_staff_members()
    {
        var type = typeof(LeaveBalancesController);
        var authorize = type.GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Null(authorize!.Roles);
        Assert.Null(type.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.All(type.GetMethods(), m => Assert.Null(m.GetCustomAttribute<AllowAnonymousAttribute>()));
        Assert.Null(type.GetMethod(nameof(LeaveBalancesController.Mine))!.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Equal("Admin,SuperAdmin", type.GetMethod(nameof(LeaveBalancesController.ForStaff))!.GetCustomAttribute<AuthorizeAttribute>()!.Roles);
    }

    private sealed class ThrowOnSave : SaveChangesInterceptor
    {
        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result) => throw new InvalidOperationException("saved");
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("saved");
    }

    /// <summary>Every log entry the provider writes (copied from PortalPayslipsControllerTests, where it is private).</summary>
    private sealed class CapturedLogs : ILoggerProvider
    {
        private readonly ConcurrentQueue<string> _messages = new();
        public IReadOnlyCollection<string> Messages => _messages;
        public ILogger CreateLogger(string categoryName) => new Logger(this);
        public void Dispose() { }

        private sealed class Logger(CapturedLogs logs) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                logs._messages.Enqueue(formatter(state, exception));
        }
    }
}
