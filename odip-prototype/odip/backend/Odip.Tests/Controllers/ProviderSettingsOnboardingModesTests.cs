using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The "Onboarding checklist" setting (owner 2026-11-06): a per-organisation map of which optional checklist items show. The PUT changes it ONLY
/// when the request carries the map (every settings section echoes the row, so null can never mean reset); {} resets to the defaults; an unknown
/// key or a mode the key does not allow is a 400 that writes nothing; each real change is one single-field audit row.
/// </summary>
public class ProviderSettingsOnboardingModesTests
{
    private static readonly Guid TenantId = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000b");
    private static readonly Guid AdminId = Guid.Parse("dddddddd-0000-0000-0000-0000000000ae");
    private const string Defaults = "complaints=Required, rights=Required, myProvider=Required, budget=Off";

    private static (OdipDbContext Db, ProviderSettingsController Controller) Create(string? stored = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantId);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim("fullName", "Ada Admin")], "Test"));
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = principal });
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(accessor.Object)).Options, tenant.Object);
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St",
            BankAccountName = "Acme Pty Ltd", BSB = "123-456", AccountNumber = "98765432", OnboardingItemModes = stored,
        });
        db.SaveChanges();
        db.AuditLogs.RemoveRange(db.AuditLogs.ToList());
        db.SaveChanges();
        return (db, new ProviderSettingsController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } });
    }

    private static UpsertProviderSettingsDto Dto(Dictionary<string, string>? modes = null) => new()
    {
        RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "VIC",
        BankAccountName = "Acme Pty Ltd", BSB = "123-456", AccountNumber = "98765432", OnboardingItemModes = modes,
    };

    private static Dictionary<string, string> Map(string complaints = "Required", string rights = "Required", string myProvider = "Required", string budget = "Off") =>
        new() { ["complaints"] = complaints, ["rights"] = rights, ["myProvider"] = myProvider, ["budget"] = budget };

    private static async Task<Dictionary<string, string>> Got(ProviderSettingsController c) =>
        Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>((await c.Get(CancellationToken.None)).Result).Value).Data!.OnboardingItemModes;

    [Theory]
    [InlineData(null)]
    [InlineData("""{"budget":"Optional"}""")]
    public async Task Get_ReturnsTheFullEffectiveMap_DefaultsWhenNothingStored(string? stored)
    {
        var (_, c) = Create(stored);

        var map = await Got(c);

        Assert.Equal(4, map.Count);
        Assert.Equal(stored == null ? "Off" : "Optional", map["budget"]);
        Assert.Equal(["Required", "Required", "Required"], new[] { map["complaints"], map["rights"], map["myProvider"] });
    }

    [Theory]
    [InlineData("agreement", "Optional")]
    [InlineData("Complaints", "Optional")]
    public async Task Put_UnknownKey_Is400_AndWritesNothing(string key, string mode)
    {
        var (db, c) = Create();
        var map = Map(); map[key] = mode;

        Assert.IsType<BadRequestObjectResult>((await c.Upsert(Dto(map), CancellationToken.None)).Result);

        Assert.Null((await db.ProviderSettings.SingleAsync()).OnboardingItemModes);
        Assert.Empty(db.AuditLogs);
    }

    [Theory]
    [InlineData("budget", "Required")]
    [InlineData("complaints", "Off")]
    [InlineData("rights", "maybe")]
    [InlineData("myProvider", "")]
    public async Task Put_AModeNotAllowedForItsKey_Is400_AndWritesNothing(string key, string mode)
    {
        var (db, c) = Create();
        var map = Map(); map[key] = mode;

        Assert.IsType<BadRequestObjectResult>((await c.Upsert(Dto(map), CancellationToken.None)).Result);

        Assert.Null((await db.ProviderSettings.SingleAsync()).OnboardingItemModes);
        Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public async Task Put_WithoutTheMap_LeavesItAlone_AndWritesNoAuditRow()
    {
        var (db, c) = Create("""{"complaints":"Optional","rights":"Required","myProvider":"Required","budget":"Optional"}""");

        Assert.IsType<OkObjectResult>((await c.Upsert(Dto(null), CancellationToken.None)).Result);

        Assert.Equal("Optional", (await Got(c))["complaints"]);
        Assert.Equal("Optional", (await Got(c))["budget"]);
        Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public async Task Put_EmptyMap_ResetsToDefaults_StoresNull_AndAuditsOnce()
    {
        var (db, c) = Create("""{"complaints":"Optional","rights":"Required","myProvider":"Required","budget":"Off"}""");

        Assert.IsType<OkObjectResult>((await c.Upsert(Dto([]), CancellationToken.None)).Result);

        Assert.Null((await db.ProviderSettings.SingleAsync()).OnboardingItemModes);
        Assert.Single(db.AuditLogs);
    }

    [Fact]
    public async Task Put_AChange_WritesOneAuditRow_ReorderedOrSameMapWritesNone()
    {
        var (db, c) = Create();

        Assert.IsType<OkObjectResult>((await c.Upsert(Dto(Map(rights: "Optional", budget: "Optional")), CancellationToken.None)).Result);

        var row = Assert.Single(db.AuditLogs);
        Assert.Equal(AdminId, row.ChangedById);
        var change = Assert.Single(JsonSerializer.Deserialize<JsonElement>(row.Changes).EnumerateArray().ToList());
        Assert.Equal(nameof(ProviderSettings.OnboardingItemModes), change.GetProperty("Field").GetString());
        Assert.Equal(Defaults, change.GetProperty("Old").GetString());
        Assert.Equal("complaints=Required, rights=Optional, myProvider=Required, budget=Optional", change.GetProperty("New").GetString());
        Assert.DoesNotContain("98765432", row.Changes);

        db.AuditLogs.RemoveRange(db.AuditLogs.ToList()); db.SaveChanges();
        var reordered = new Dictionary<string, string> { ["budget"] = "Optional", ["myProvider"] = "Required", ["rights"] = "Optional", ["complaints"] = "Required" };
        Assert.IsType<OkObjectResult>((await c.Upsert(Dto(reordered), CancellationToken.None)).Result);
        Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public async Task Put_SettingTheDefaultsAgain_WritesNothingAndStoresNull()
    {
        var (db, c) = Create();

        Assert.IsType<OkObjectResult>((await c.Upsert(Dto(Map()), CancellationToken.None)).Result);

        Assert.Null((await db.ProviderSettings.SingleAsync()).OnboardingItemModes);
        Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public void Put_IsAdminOnly_ByTheExistingAttribute()
    {
        var attr = typeof(ProviderSettingsController).GetMethod(nameof(ProviderSettingsController.Upsert))!
            .GetCustomAttributes(typeof(AuthorizeAttribute), false).Cast<AuthorizeAttribute>().Single();
        Assert.Equal("SuperAdmin,Admin", attr.Roles);
    }

    [Fact]
    public void Effective_IgnoresAnUnknownKey_ABadValue_AndBadJson()
    {
        Assert.Equal("Optional", OnboardingItemModeRules.Effective("""{"rights":"Optional","zzz":"Optional","complaints":"Off"}""")["rights"]);
        Assert.Equal("Required", OnboardingItemModeRules.Effective("""{"complaints":"Off"}""")["complaints"]);
        Assert.Equal(OnboardingItemModeRules.Defaults, OnboardingItemModeRules.Effective("{{{"));
        Assert.Equal(OnboardingItemModeRules.Defaults, OnboardingItemModeRules.Effective(null));
        Assert.Null(OnboardingItemModeRules.Store(OnboardingItemModeRules.Defaults));
    }
}
