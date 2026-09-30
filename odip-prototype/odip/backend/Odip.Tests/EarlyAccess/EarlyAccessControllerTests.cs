using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.EarlyAccess;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// POST /api/public/early-access at the controller level (EF InMemory). The wire-level contract — status
/// codes, headers, body size, rate limiting — is covered against a real Kestrel host in
/// <see cref="EarlyAccessHttpTests"/>; the Postgres-only behaviour (unique index, races) in
/// <see cref="EarlyAccessPostgresTests"/>.
/// </summary>
public class EarlyAccessControllerTests
{
    private static OdipDbContext CreateDb(string? databaseName = null, ICurrentTenant? tenant = null)
    {
        if (tenant is null)
        {
            // A public request carries no principal: null tenant, not a SuperAdmin. Any tenant query filter
            // applied to these rows would therefore hide ALL of them — the tests below rely on that.
            var anonymous = new Mock<ICurrentTenant>();
            anonymous.Setup(t => t.TenantId).Returns((Guid?)null);
            anonymous.Setup(t => t.IsSuperAdmin).Returns(false);
            tenant = anonymous.Object;
        }

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant);
    }

    private static EarlyAccessController MakeController(
        OdipDbContext db, IEarlyAccessNotifier? notifier = null, HttpContext? http = null)
    {
        var controller = new EarlyAccessController(
            new EarlyAccessService(db, new CapturingLogger<EarlyAccessService>()),
            notifier ?? Mock.Of<IEarlyAccessNotifier>(),
            new CapturingLogger<EarlyAccessController>());
        controller.ControllerContext = new ControllerContext { HttpContext = http ?? new DefaultHttpContext() };
        return controller;
    }

    private static EarlyAccessRequestDto Valid(string email = "jane@example.com") => new()
    {
        Name = "Jane Citizen",
        Organisation = "Sample Support Co",
        Email = email,
        Website = "",
    };

    private static void AssertReceived(IActionResult result)
    {
        var accepted = Assert.IsType<AcceptedResult>(result);
        Assert.Equal(StatusCodes.Status202Accepted, accepted.StatusCode);
        var body = Assert.IsType<EarlyAccessReceivedDto>(accepted.Value);
        Assert.Equal("received", body.Status);
    }

    // ── Happy path ─────────────────────────────────────────────

    [Fact]
    public async Task ValidRequest_Returns202_AndStoresOneRow()
    {
        using var db = CreateDb();

        var result = await MakeController(db).Submit(new EarlyAccessRequestDto
        {
            Name = "  Jane Citizen ",
            Organisation = " Sample Support Co",
            Email = "  Jane.Citizen@Example.COM ",
        }, CancellationToken.None);

        AssertReceived(result);
        var row = await db.EarlyAccessRequests.SingleAsync();
        Assert.Equal("Jane Citizen", row.Name);
        Assert.Equal("Sample Support Co", row.Organisation);
        Assert.Equal("jane.citizen@example.com", row.Email);
        Assert.Equal(1, row.RequestCount);
        Assert.NotEqual(Guid.Empty, row.Id);
        Assert.Equal(row.CreatedAtUtc, row.LastRequestedAtUtc);
        Assert.InRange(row.CreatedAtUtc, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddSeconds(5));
    }

    [Fact]
    public void Response_SerialisesTo_StatusReceived()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(
            EarlyAccessReceivedDto.Received, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        Assert.Equal("{\"status\":\"received\"}", json);
    }

    // ── Duplicates: never revealed, counted ────────────────────

    [Fact]
    public async Task DuplicateEmail_Returns202_KeepsOneRow_AndCountsBothRequests()
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = CreateDb(dbName))
            AssertReceived(await MakeController(db).Submit(Valid("jane@example.com"), CancellationToken.None));

        // Backdate the first request so "LastRequestedAtUtc moved" is observable.
        var first = DateTime.UtcNow.AddDays(-3);
        using (var db = CreateDb(dbName))
        {
            var row = await db.EarlyAccessRequests.SingleAsync();
            row.CreatedAtUtc = first;
            row.LastRequestedAtUtc = first;
            await db.SaveChangesAsync();
        }

        // Same address, different case and padding, and a different name/organisation.
        using (var db = CreateDb(dbName))
        {
            var again = new EarlyAccessRequestDto { Name = "Someone Else", Organisation = "Other Org", Email = "  JANE@Example.com  " };
            AssertReceived(await MakeController(db).Submit(again, CancellationToken.None));
        }

        using (var db = CreateDb(dbName))
        {
            var row = await db.EarlyAccessRequests.SingleAsync();
            Assert.Equal(2, row.RequestCount);
            Assert.Equal(first, row.CreatedAtUtc);
            Assert.True(row.LastRequestedAtUtc > first.AddDays(2), "LastRequestedAtUtc should move to now");
            // First submission wins: a repeat cannot overwrite what is on file.
            Assert.Equal("Jane Citizen", row.Name);
            Assert.Equal("Sample Support Co", row.Organisation);
        }
    }

    [Fact]
    public async Task DuplicateAndFirstTimeResponses_AreIndistinguishable()
    {
        var dbName = Guid.NewGuid().ToString();
        using var db1 = CreateDb(dbName);
        using var db2 = CreateDb(dbName);
        var first = Assert.IsType<AcceptedResult>(await MakeController(db1).Submit(Valid(), CancellationToken.None));
        var second = Assert.IsType<AcceptedResult>(await MakeController(db2).Submit(Valid(), CancellationToken.None));

        Assert.Equal(first.StatusCode, second.StatusCode);
        Assert.Equal(first.Value, second.Value);
        Assert.Equal(first.Location, second.Location);
    }

    [Fact]
    public async Task ManyRepeats_KeepCounting()
    {
        var dbName = Guid.NewGuid().ToString();
        for (var i = 0; i < 4; i++)
        {
            using var db = CreateDb(dbName);
            AssertReceived(await MakeController(db).Submit(Valid(), CancellationToken.None));
        }

        using var check = CreateDb(dbName);
        Assert.Equal(4, (await check.EarlyAccessRequests.SingleAsync()).RequestCount);
    }

    [Fact]
    public async Task DifferentEmails_AreDifferentRows()
    {
        using var db = CreateDb();
        var controller = MakeController(db);

        AssertReceived(await controller.Submit(Valid("a@example.com"), CancellationToken.None));
        AssertReceived(await controller.Submit(Valid("b@example.com"), CancellationToken.None));

        Assert.Equal(2, await db.EarlyAccessRequests.CountAsync());
    }

    // ── Honeypot ───────────────────────────────────────────────

    [Theory]
    [InlineData("https://spam.example")]
    [InlineData("x")]
    public async Task FilledHoneypot_Returns202_AndStoresNothing_AndNeverNotifies(string website)
    {
        using var db = CreateDb();
        var notifier = new Mock<IEarlyAccessNotifier>();
        var dto = Valid();
        dto.Website = website;

        var result = await MakeController(db, notifier.Object).Submit(dto, CancellationToken.None);

        AssertReceived(result);
        Assert.Empty(db.EarlyAccessRequests);
        notifier.Verify(n => n.NotifyNewRequest(It.IsAny<EarlyAccessNotification>()), Times.Never);
    }

    [Fact]
    public async Task FilledHoneypot_WithOtherwiseInvalidFields_StillGets202_NotAnErrorABotCanLearnFrom()
    {
        using var db = CreateDb();

        var result = await MakeController(db).Submit(
            new EarlyAccessRequestDto { Name = "", Organisation = null, Email = "not-an-email", Website = "http://bot" },
            CancellationToken.None);

        AssertReceived(result);
        Assert.Empty(db.EarlyAccessRequests);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task EmptyOrBlankHoneypot_IsNormalTraffic(string? website)
    {
        using var db = CreateDb();
        var dto = Valid();
        dto.Website = website;

        AssertReceived(await MakeController(db).Submit(dto, CancellationToken.None));

        Assert.Single(db.EarlyAccessRequests);
    }

    // ── Validation ─────────────────────────────────────────────

    [Fact]
    public async Task InvalidFields_Return400_NamingEachField_AndStoreNothing()
    {
        using var db = CreateDb();

        var result = await MakeController(db).Submit(
            new EarlyAccessRequestDto { Name = " ", Organisation = new string('o', 151), Email = "nope" }, CancellationToken.None);

        var problem = AssertValidationProblem(result);
        Assert.Equal(new[] { "email", "name", "organisation" }, problem.Errors.Keys.OrderBy(k => k, StringComparer.Ordinal));
        Assert.All(problem.Errors.Values, messages => Assert.NotEmpty(messages));
        Assert.Empty(db.EarlyAccessRequests);
    }

    [Theory]
    [InlineData("name")]
    [InlineData("organisation")]
    [InlineData("email")]
    public async Task EachInvalidField_IsNamedOnItsOwn(string field)
    {
        using var db = CreateDb();
        var dto = Valid();
        switch (field)
        {
            case "name": dto.Name = ""; break;
            case "organisation": dto.Organisation = "   "; break;
            default: dto.Email = "jane@"; break;
        }

        var problem = AssertValidationProblem(await MakeController(db).Submit(dto, CancellationToken.None));

        Assert.Equal(field, Assert.Single(problem.Errors.Keys));
        Assert.Empty(db.EarlyAccessRequests);
    }

    [Fact]
    public async Task MissingBody_Returns400_ForEveryField()
    {
        using var db = CreateDb();

        var problem = AssertValidationProblem(await MakeController(db).Submit(null, CancellationToken.None));

        Assert.Equal(3, problem.Errors.Count);
        Assert.Empty(db.EarlyAccessRequests);
    }

    [Fact]
    public async Task ARepeatWithAnInvalidField_DoesNotBumpTheCount()
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = CreateDb(dbName))
            await MakeController(db).Submit(Valid(), CancellationToken.None);

        using (var db = CreateDb(dbName))
        {
            var dto = Valid();
            dto.Name = "";
            AssertValidationProblem(await MakeController(db).Submit(dto, CancellationToken.None));
        }

        using var check = CreateDb(dbName);
        Assert.Equal(1, (await check.EarlyAccessRequests.SingleAsync()).RequestCount);
    }

    private static ValidationProblemDetails AssertValidationProblem(IActionResult result)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, objectResult.StatusCode);
        var problem = Assert.IsType<ValidationProblemDetails>(objectResult.Value);
        Assert.Equal(StatusCodes.Status400BadRequest, problem.Status);
        return problem;
    }

    // ── Notification wiring ────────────────────────────────────

    [Fact]
    public async Task FirstSubmission_NotifiesOnce_WithTheNormalisedValues_AndRepeatsDoNot()
    {
        var dbName = Guid.NewGuid().ToString();
        var notifier = new Mock<IEarlyAccessNotifier>();

        using (var db = CreateDb(dbName))
            await MakeController(db, notifier.Object).Submit(
                new EarlyAccessRequestDto { Name = " Jane ", Organisation = "Org", Email = "JANE@Example.com" }, CancellationToken.None);
        using (var db = CreateDb(dbName))
            await MakeController(db, notifier.Object).Submit(Valid("jane@example.com"), CancellationToken.None);

        notifier.Verify(n => n.NotifyNewRequest(It.Is<EarlyAccessNotification>(x =>
            x.Name == "Jane" && x.Organisation == "Org" && x.Email == "jane@example.com")), Times.Once);
        notifier.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task ANotifierThatThrows_DoesNotFailAStoredRequest()
    {
        using var db = CreateDb();
        var notifier = new Mock<IEarlyAccessNotifier>();
        notifier.Setup(n => n.NotifyNewRequest(It.IsAny<EarlyAccessNotification>())).Throws(new InvalidOperationException("mail bug"));

        var result = await MakeController(db, notifier.Object).Submit(Valid(), CancellationToken.None);

        AssertReceived(result);
        Assert.Single(db.EarlyAccessRequests);
    }

    [Fact]
    public async Task AStorageFailure_IsAGeneric500_EvenForAnInvalidOperationException()
    {
        // ExceptionHandlingMiddleware would turn an InvalidOperationException into a 400; the contract says 500.
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new ThrowOnSave(new InvalidOperationException("transient fault details")))
            .Options;
        using var db = new OdipDbContext(options, TenantContext(null, false));

        var result = await MakeController(db).Submit(Valid(), CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status500InternalServerError, objectResult.StatusCode);
        var body = Assert.IsType<ApiResponse<object>>(objectResult.Value);
        Assert.False(body.Success);
        Assert.DoesNotContain("transient fault details", string.Join(' ', body.Errors ?? new List<string>()));
    }

    private sealed class ThrowOnSave : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
    {
        private readonly Exception _exception;

        public ThrowOnSave(Exception exception) => _exception = exception;

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
            Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result,
            CancellationToken cancellationToken = default) => throw _exception;
    }

    [Fact]
    public async Task InvalidRequest_NeverNotifies()
    {
        using var db = CreateDb();
        var notifier = new Mock<IEarlyAccessNotifier>();
        var dto = Valid();
        dto.Email = "bad";

        await MakeController(db, notifier.Object).Submit(dto, CancellationToken.None);

        notifier.VerifyNoOtherCalls();
    }

    // ── Tenant filters and view-as headers do not apply ────────

    [Fact]
    public void EarlyAccessRequest_IsNotTenantScoped_InTheModel()
    {
        using var db = CreateDb();
        var entity = db.Model.FindEntityType(typeof(EarlyAccessRequest))!;

        Assert.False(typeof(ITenantEntity).IsAssignableFrom(typeof(EarlyAccessRequest)));
        Assert.Null(entity.FindProperty("TenantId"));
        Assert.Null(entity.GetQueryFilter());
    }

    [Theory]
    [InlineData("tenant")]
    [InlineData("superadmin")]
    [InlineData("anonymous")]
    public async Task StoredRows_AreVisibleAndCounted_WhateverTheTenantContext(string firstContext)
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = TenantContext(tenantId: Guid.NewGuid(), superAdmin: false);
        var tenantB = TenantContext(tenantId: Guid.NewGuid(), superAdmin: false);
        var first = firstContext switch
        {
            "tenant" => tenantA,
            "superadmin" => TenantContext(tenantId: null, superAdmin: true),
            _ => TenantContext(tenantId: null, superAdmin: false),
        };

        using (var db = CreateDb(dbName, first))
            AssertReceived(await MakeController(db).Submit(Valid(), CancellationToken.None));
        // The same address again, through a different tenant's context: one row, count 2.
        using (var db = CreateDb(dbName, tenantB))
            AssertReceived(await MakeController(db).Submit(Valid(), CancellationToken.None));

        foreach (var context in new[] { tenantA, tenantB, TenantContext(null, true), TenantContext(null, false) })
        {
            using var db = CreateDb(dbName, context);
            var row = await db.EarlyAccessRequests.SingleAsync();
            Assert.Equal(2, row.RequestCount);
        }
    }

    [Fact]
    public async Task SuperAdminViewAsHeaders_AreIgnored()
    {
        // The real CurrentTenant, fed a SuperAdmin principal plus X-View-As-Tenant / X-View-As-User, exactly as the
        // API builds it for a request. It would scope every ITenantEntity query to that tenant; this table must not care.
        var dbName = Guid.NewGuid().ToString();
        var viewAsTenant = Guid.NewGuid();

        var http = new DefaultHttpContext();
        http.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
            new[] { new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, "SuperAdmin") }, "test"));
        http.Request.Headers["X-View-As-Tenant"] = viewAsTenant.ToString();
        http.Request.Headers["X-View-As-User"] = Guid.NewGuid().ToString();
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(http);
        var viewAs = new CurrentTenant(accessor.Object);
        Assert.Equal(viewAsTenant, viewAs.TenantId); // precondition: view-as really is in force
        Assert.False(viewAs.IsSuperAdmin);

        using (var db = CreateDb(dbName, viewAs))
            AssertReceived(await MakeController(db, http: http).Submit(Valid(), CancellationToken.None));
        using (var db = CreateDb(dbName, viewAs))
            AssertReceived(await MakeController(db, http: http).Submit(Valid(), CancellationToken.None));

        // A plain anonymous context sees the same single row, with both submissions counted.
        using var anonymous = CreateDb(dbName);
        var row = await anonymous.EarlyAccessRequests.SingleAsync();
        Assert.Equal(2, row.RequestCount);
    }

    private static ICurrentTenant TenantContext(Guid? tenantId, bool superAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return tenant.Object;
    }

    // ── Wiring: the attributes the pipeline relies on ──────────

    [Fact]
    public void Controller_IsAnonymous_AtTheContractRoute()
    {
        var type = typeof(EarlyAccessController);

        Assert.NotNull(type.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(type.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Equal("api/public/early-access", type.GetCustomAttribute<RouteAttribute>()!.Template);
    }

    [Fact]
    public void SubmitAction_IsPostOnly_JsonOnly_LimitedTo4KB_AndUnderTheEarlyAccessRateLimiter()
    {
        var action = typeof(EarlyAccessController).GetMethod(nameof(EarlyAccessController.Submit))!;

        Assert.NotNull(action.GetCustomAttribute<HttpPostAttribute>());
        Assert.NotNull(action.GetCustomAttribute<EarlyAccessRateLimitAttribute>());
        Assert.Equal(new[] { "application/json" }, action.GetCustomAttribute<ConsumesAttribute>()!.ContentTypes);
        // RequestSizeLimitAttribute keeps its limit in a private field; read the constructor argument instead.
        var limit = action.CustomAttributes.Single(a => a.AttributeType == typeof(RequestSizeLimitAttribute))
            .ConstructorArguments.Single().Value;
        Assert.Equal(4096L, Convert.ToInt64(limit));
        Assert.Equal(4096, EarlyAccessController.MaxBodyBytes);
    }

    [Fact]
    public void NoOtherActionOnTheController_IsRateLimitExempt()
    {
        // Every public method that is an HTTP action must carry the marker, or it would bypass the limiter.
        var actions = typeof(EarlyAccessController)
            .GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

        Assert.All(actions, a => Assert.NotNull(a.GetCustomAttribute<EarlyAccessRateLimitAttribute>()));
    }
}
