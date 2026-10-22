using System.Collections.Concurrent;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
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
using Odip.Tests.Imports;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;

namespace Odip.Tests.Integrations;

/// <summary>
/// My payslips: the caller's own, from a fake EH. Each organisation and each person sees only their own; a SuperAdmin or view-as caller is refused;
/// nothing is saved, audited or logged; every answer says no-store.
/// </summary>
public class PortalPayslipsControllerTests
{
    private const string ListPath = "/api/v2/ess/42/document/payslip";
    private const string PdfPath = "/api/v2/ess/42/document/payslip/9001";
    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.7 payslip 1234.56 %%EOF");
    private static readonly string LongSchedule = new('S', 80);

    private static PortalPayslipsController Controller(OdipDbContext db, Guid tenantId, Guid callerId, StubHttpHandler eh, string role = "SupportWorker", Guid? viewAs = null, IntegrationKeyProtector? keys = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAs);
        return new PortalPayslipsController(db, tenant.Object, keys ?? Keys, StubHttpHandler.Client(eh))
        {
            ControllerContext = new ControllerContext { HttpContext = HttpFor(callerId, role) },
        };
    }

    private static DefaultHttpContext HttpFor(Guid callerId, string role) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerId.ToString()), new Claim(ClaimTypes.Role, role)], "Test")),
    };

    /// <summary>An organisation with Sam (support worker) linked to EH employee 42.</summary>
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

    /// <summary>Twelve payslips for employee 42, sent out of date order, each with figures and payer details that ODIP must never read. Row 9005 has an 80-character schedule.</summary>
    private static object[] ListBody() => new[] { 1, 12, 2, 11, 3, 10, 4, 9, 5, 8, 6, 7 }.Select(i =>
    {
        var paid = new DateTime(2026, 10, 8).AddDays(-14 * (12 - i));
        return (object)new
        {
            id = 9000 + i, employeeId = 42, paySchedule = i == 5 ? LongSchedule : "Fortnightly",
            datePaid = paid.ToString("s"), payPeriodStart = paid.AddDays(-16).ToString("s"), payPeriodEnd = paid.AddDays(-3).ToString("s"),
            netPay = 1234.56, payerName = "Acme Care", payerAbn = "12 345 678 901",
        };
    }).ToArray();

    private static StubHttpHandler Eh() =>
        new StubHttpHandler().On(ListPath, HttpStatusCode.OK, ListBody()).On(PdfPath, HttpStatusCode.OK, Convert.ToBase64String(Pdf));

    private static PortalPayslipsDto Data(ActionResult<ApiResponse<PortalPayslipsDto>> result) =>
        Assert.IsType<ApiResponse<PortalPayslipsDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    /// <summary>The status code and the one error of a refusal.</summary>
    private static (int Status, string Error) Refusal(IActionResult? result)
    {
        var refusal = Assert.IsAssignableFrom<ObjectResult>(result);
        var response = Assert.IsType<ApiResponse<bool>>(refusal.Value);
        return (refusal.StatusCode ?? 0, Assert.Single(response.Errors!));
    }

    private static void AssertNoStore(PortalPayslipsController c)
    {
        Assert.Equal("no-store", c.Response.Headers.CacheControl.ToString());
        Assert.Equal("no-cache", c.Response.Headers.Pragma.ToString());
    }

    [Fact]
    public async Task Lists_the_callers_payslips_newest_first_with_dates_only()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = Eh();

        var data = Data(await Controller(db, tenant, sam.Id, eh).List(CancellationToken.None));

        Assert.Equal("Ready", data.Status);
        Assert.Equal(12, data.Payslips.Count);
        for (var i = 1; i < 12; i++) Assert.True(data.Payslips[i - 1].DatePaid > data.Payslips[i].DatePaid);
        Assert.Equal(new PortalPayslipDto(9012, new DateOnly(2026, 10, 8), new DateOnly(2026, 9, 22), new DateOnly(2026, 10, 5), "Fortnightly"), data.Payslips[0]);
        Assert.Equal(LongSchedule, data.Payslips.Single(p => p.PayRunId == 9005).PaySchedule);
        var json = JsonSerializer.Serialize(data, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        foreach (var figure in new[] { "1234.56", "netPay", "payer", "12 345 678 901" }) Assert.DoesNotContain(figure, json);
        var request = Assert.Single(eh.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal(ListPath, request.RequestUri!.AbsolutePath);
        Assert.Equal(Convert.ToBase64String(Encoding.UTF8.GetBytes(ApiKey + ":")), request.Headers.Authorization!.Parameter);
    }

    [Fact]
    public async Task An_organisation_that_is_not_connected_answers_NotConnected_and_calls_nobody()
    {
        var (dbA, name, a, sam) = await OrganisationAsync(connected: false);
        await using var _ = dbA;
        var b = Guid.NewGuid();
        await using (var dbB = Db(name, b))
        {
            await ConnectAsync(dbB, b);
            dbB.Users.Add(EhFixture.Staff(b, "Zed", "Zee", "zed@acme.org.au", "42"));
            await dbB.SaveChangesAsync();
        }
        var eh = Eh();

        var data = Data(await Controller(dbA, a, sam.Id, eh).List(CancellationToken.None));

        Assert.Equal(("NotConnected", 0), (data.Status, data.Payslips.Count));
        Assert.Empty(eh.Requests);
    }

    [Fact]
    public async Task Staff_not_linked_answer_NotLinked_and_calls_nobody()
    {
        var (db, _, tenant, sam) = await OrganisationAsync(payrollId: null);
        await using var _ = db;
        var eh = Eh();

        var data = Data(await Controller(db, tenant, sam.Id, eh).List(CancellationToken.None));

        Assert.Equal(("NotLinked", 0), (data.Status, data.Payslips.Count));
        Assert.Empty(eh.Requests);
    }

    [Fact]
    public async Task A_caller_from_another_organisation_is_never_resolved()
    {
        var (dbA, name, a, _) = await OrganisationAsync();
        await using var _ = dbA;
        var b = Guid.NewGuid();
        User zed;
        await using (var dbB = Db(name, b))
        {
            await ConnectAsync(dbB, b);
            zed = EhFixture.Staff(b, "Zed", "Zee", "zed@other.org.au", "42");
            dbB.Users.Add(zed);
            await dbB.SaveChangesAsync();
        }
        var eh = Eh();
        var controller = Controller(dbA, a, zed.Id, eh);

        var list = Data(await controller.List(CancellationToken.None));
        var pdf = await controller.Pdf(9001, CancellationToken.None);

        Assert.Equal("NotLinked", list.Status);
        Assert.IsType<NotFoundObjectResult>(pdf);
        Assert.Empty(eh.Requests);
    }

    /// <summary>Two people in ONE organisation: Sam is linked to "42", Kim is not (or is "77"). Kim never sees Sam's payslips, whatever order the rows come back in.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("77")]
    public async Task A_colleague_in_the_same_organisation_never_reaches_anothers_payslips(string? kimsPayrollId)
    {
        var (db, _, tenant, _) = await OrganisationAsync();   // Sam, "42", is the first row
        await using var _ = db;
        var kim = EhFixture.Staff(tenant, "Kim", "Ng", "kim@acme.org.au", kimsPayrollId);
        db.Users.Add(kim);
        await db.SaveChangesAsync();
        var eh = Eh();
        var controller = Controller(db, tenant, kim.Id, eh);

        var list = Data(await controller.List(CancellationToken.None));
        var pdf = await controller.Pdf(9001, CancellationToken.None);

        Assert.DoesNotContain(eh.Requests, r => r.RequestUri!.AbsolutePath.Contains("/ess/42/"));
        Assert.Empty(list.Payslips);
        Assert.IsType<NotFoundObjectResult>(pdf);
        if (kimsPayrollId is null) { Assert.Equal("NotLinked", list.Status); Assert.Empty(eh.Requests); }
        else Assert.All(eh.Requests, r => Assert.StartsWith("/api/v2/ess/77/", r.RequestUri!.AbsolutePath));
    }

    [Fact]
    public async Task No_action_takes_a_person_from_the_client()
    {
        var actions = typeof(PortalPayslipsController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
        Assert.NotEmpty(actions);
        foreach (var parameter in actions.SelectMany(m => m.GetParameters()))
            Assert.True(parameter.ParameterType == typeof(CancellationToken) || (parameter.ParameterType == typeof(int) && parameter.Name == "payRunId"), $"{parameter.Member.Name}({parameter.Name})");

        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = Eh();
        var controller = Controller(db, tenant, sam.Id, eh);
        controller.HttpContext.Request.QueryString = new QueryString($"?userId={Guid.NewGuid()}&employeeId=99");

        await controller.List(CancellationToken.None);

        Assert.Equal(ListPath, Assert.Single(eh.Requests).RequestUri!.AbsolutePath);
    }

    [Theory]
    [InlineData("SuperAdmin", false)]
    [InlineData("SuperAdmin", true)]
    [InlineData("SupportWorker", true)]
    public async Task SuperAdmins_and_view_as_are_refused_and_call_nobody(string role, bool viewAsOther)
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        // The viewed user is a second, linked person: a resolver that honoured ViewAsUserId would reach Kim's EH record.
        var kim = EhFixture.Staff(tenant, "Kim", "Ng", "kim@acme.org.au", "77");
        db.Users.Add(kim);
        await db.SaveChangesAsync();
        var eh = Eh();
        var controller = Controller(db, tenant, sam.Id, eh, role, viewAsOther ? kim.Id : null);

        var list = await controller.List(CancellationToken.None);
        var pdf = await controller.Pdf(9001, CancellationToken.None);

        Assert.Equal((403, PortalPayslipsController.PrivateMessage), Refusal(list.Result));
        Assert.Equal((403, PortalPayslipsController.PrivateMessage), Refusal(pdf));
        Assert.Empty(eh.Requests);
        AssertNoStore(controller);
    }

    [Theory]
    [InlineData(500)]
    [InlineData(429)]
    [InlineData(0)]   // EH cannot be reached at all
    public async Task Employment_Hero_failures_answer_503_in_words_for_staff(int status)
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = status == 0 ? new StubHttpHandler().OnThrow(ListPath, new HttpRequestException()) : new StubHttpHandler().On(ListPath, (HttpStatusCode)status);

        var list = await Controller(db, tenant, sam.Id, eh).List(CancellationToken.None);

        var (code, error) = Refusal(list.Result);
        Assert.Equal((503, PortalPayslipsController.UnavailableMessage), (code, error));
    }

    [Fact]
    public async Task A_refused_key_asks_for_an_Admin_and_never_says_connect_again()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = new StubHttpHandler().On(ListPath, HttpStatusCode.Unauthorized);

        var list = await Controller(db, tenant, sam.Id, eh).List(CancellationToken.None);

        var (code, error) = Refusal(list.Result);
        Assert.Equal((503, PortalPayslipsController.NeedsAdminMessage), (code, error));
        Assert.DoesNotContain("connect again", error);
        Assert.DoesNotContain("next sync", error);
    }

    [Fact]
    public async Task An_unreadable_key_answers_NeedsAdmin_and_calls_nobody()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = Eh();
        var otherKeys = IntegrationKeyProtectorTests.Protector(IntegrationKeyProtectorTests.NewMasterKey());
        var controller = Controller(db, tenant, sam.Id, eh, keys: otherKeys);

        var list = await controller.List(CancellationToken.None);
        var pdf = await controller.Pdf(9001, CancellationToken.None);

        Assert.Equal((503, PortalPayslipsController.NeedsAdminMessage), Refusal(list.Result));
        Assert.Equal((503, PortalPayslipsController.NeedsAdminMessage), Refusal(pdf));
        Assert.Empty(eh.Requests);
    }

    [Fact]
    public async Task A_404_from_the_list_answers_NotLinked()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;

        var data = Data(await Controller(db, tenant, sam.Id, new StubHttpHandler()).List(CancellationToken.None));

        Assert.Equal(("NotLinked", 0), (data.Status, data.Payslips.Count));
    }

    [Fact]
    public async Task Opens_the_callers_payslip_as_a_pdf_that_is_never_cached()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = Eh();
        var controller = Controller(db, tenant, sam.Id, eh);

        var result = await controller.Pdf(9001, CancellationToken.None);

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal(Pdf, file.FileContents);
        Assert.True(string.IsNullOrEmpty(file.FileDownloadName));
        Assert.Equal(PdfPath, Assert.Single(eh.Requests).RequestUri!.AbsolutePath);
        AssertNoStore(controller);
    }

    [Fact]
    public async Task Something_that_is_not_a_pdf_is_never_served()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = new StubHttpHandler().On(PdfPath, HttpStatusCode.OK, Convert.ToBase64String(Encoding.ASCII.GetBytes("<html>")));

        var result = await Controller(db, tenant, sam.Id, eh).Pdf(9001, CancellationToken.None);

        Assert.IsNotType<FileContentResult>(result);
        Assert.Equal((503, PortalPayslipsController.UnavailableMessage), Refusal(result));
    }

    [Fact]
    public async Task A_payslip_Employment_Hero_no_longer_has_answers_404()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var eh = new StubHttpHandler();
        var controller = Controller(db, tenant, sam.Id, eh);

        var gone = await controller.Pdf(9001, CancellationToken.None);
        var requestsAfterGone = eh.Requests.Count;
        var zero = await controller.Pdf(0, CancellationToken.None);

        Assert.Equal((404, PortalPayslipsController.GoneMessage), Refusal(gone));
        Assert.Equal((404, PortalPayslipsController.GoneMessage), Refusal(zero));
        Assert.Equal(1, requestsAfterGone);
        Assert.Equal(requestsAfterGone, eh.Requests.Count);
    }

    [Theory]
    [InlineData("NotConnected")]
    [InlineData("NotLinked")]
    [InlineData("Forbidden")]
    [InlineData("Unavailable")]
    public async Task Every_answer_says_no_store(string answer)
    {
        var (db, _, tenant, sam) = await OrganisationAsync(connected: answer != "NotConnected", payrollId: answer == "NotLinked" ? null : "42");
        await using var _ = db;
        var eh = answer == "Unavailable" ? new StubHttpHandler().On(ListPath, HttpStatusCode.InternalServerError) : Eh();
        var controller = Controller(db, tenant, sam.Id, eh, answer == "Forbidden" ? "SuperAdmin" : "SupportWorker");

        await controller.List(CancellationToken.None);

        AssertNoStore(controller);
    }

    [Fact]
    public async Task Nothing_is_saved_audited_or_logged()
    {
        var (db, name, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var auditBefore = await db.AuditLogs.IgnoreQueryFilters().CountAsync();

        // (a) The database: a context that fails any save. Both actions still succeed, and no audit row appears.
        await using (var readOnly = new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).AddInterceptors(new ThrowOnSave()).Options, ImportTestSupport.Tenant(tenant)))
        {
            var controller = Controller(readOnly, tenant, sam.Id, Eh());
            Assert.Equal("Ready", Data(await controller.List(CancellationToken.None)).Status);
            Assert.IsType<FileContentResult>(await controller.Pdf(9001, CancellationToken.None));
        }
        Assert.Equal(auditBefore, await db.AuditLogs.IgnoreQueryFilters().CountAsync());

        // (b) The logs: the client is built the way Program.cs builds it (keep in step with Program.cs:245-246), and the controller from the same provider,
        // so a logger either class ever gains writes into the capture.
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
        var logged = ActivatorUtilities.CreateInstance<PortalPayslipsController>(provider);
        logged.ControllerContext = new ControllerContext { HttpContext = HttpFor(sam.Id, "SupportWorker") };

        await logged.List(CancellationToken.None);
        await logged.Pdf(9001, CancellationToken.None);

        Assert.NotEmpty(logs.Messages);   // HttpClient logs each request, so the capture is real
        // The real proof: the key and its Basic form are never logged (the redaction holds).
        foreach (var secret in new[] { ApiKey, Convert.ToBase64String(Encoding.UTF8.GetBytes(ApiKey + ":")) })
            Assert.DoesNotContain(logs.Messages, m => m.Contains(secret));
        // A tripwire, not proof (nothing logs bodies today): it fails if a logger is added later that writes the PDF or a figure.
        foreach (var payload in new[] { "%PDF", Convert.ToBase64String(Pdf), "1234.56" })
            Assert.DoesNotContain(logs.Messages, m => m.Contains(payload));
        Assert.DoesNotContain(typeof(PortalPayslipsController).GetConstructors().SelectMany(c => c.GetParameters()), p => p.ParameterType.Name.StartsWith("ILogger"));
    }

    [Fact]
    public async Task The_payslip_URL_is_logged_by_HttpClient_unless_the_EH_category_is_filtered_to_Warning()
    {
        var (db, _, tenant, sam) = await OrganisationAsync();
        await using var _ = db;
        var tenantMock = new Mock<ICurrentTenant>();
        tenantMock.Setup(t => t.TenantId).Returns(tenant);

        async Task<IReadOnlyCollection<string>> RunAsync(bool filtered)
        {
            var logs = new CapturedLogs();
            var services = new ServiceCollection()
                .AddLogging(b => { b.SetMinimumLevel(LogLevel.Trace).AddProvider(logs); if (filtered) b.QuietEmploymentHeroClient(); })
                .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
                .AddSingleton(db).AddSingleton(tenantMock.Object).AddSingleton(Keys);
            services.AddHttpClient<EmploymentHeroClient>(c => c.Timeout = TimeSpan.FromSeconds(30))
                .RedactLoggedHeaders(new[] { "Authorization" }).ConfigurePrimaryHttpMessageHandler(() => Eh());
            await using var provider = services.BuildServiceProvider();
            var controller = ActivatorUtilities.CreateInstance<PortalPayslipsController>(provider);
            controller.ControllerContext = new ControllerContext { HttpContext = HttpFor(sam.Id, "SupportWorker") };
            await controller.Pdf(9001, CancellationToken.None);
            return logs.Messages.ToArray();
        }

        Assert.Contains(await RunAsync(filtered: false), m => m.Contains("/document/payslip/9001"));   // the capture is real
        Assert.DoesNotContain(await RunAsync(filtered: true), m => m.Contains("/document/payslip"));
    }

    [Fact]
    public void Any_signed_in_role_reaches_it_and_nobody_anonymous()
    {
        var authorize = typeof(PortalPayslipsController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Null(authorize!.Roles);
        Assert.Null(typeof(PortalPayslipsController).GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.All(typeof(PortalPayslipsController).GetMethods(), m => Assert.Null(m.GetCustomAttribute<AllowAnonymousAttribute>()));
    }

    /// <summary>Fails any save, sync or async.</summary>
    private sealed class ThrowOnSave : SaveChangesInterceptor
    {
        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result) => throw new InvalidOperationException("saved");
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("saved");
    }

    /// <summary>Every log entry the provider writes.</summary>
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
