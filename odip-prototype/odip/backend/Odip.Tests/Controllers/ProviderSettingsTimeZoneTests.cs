using System.Reflection;
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
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Settings PR 2a: the organisation's time zone on ProviderSettings. Allow-list, role, tenant scope, "null = leave" echo and the single audit row.</summary>
public class ProviderSettingsTimeZoneTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    private static readonly Guid AdminId = Guid.Parse("dddddddd-0000-0000-0000-0000000000ad");
    private const string Refusal = "Choose a time zone from the list.";

    private static (OdipDbContext db, ProviderSettingsController controller) Create(Guid? tenantId, bool isSuperAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim("fullName", "Ada Admin")], "Test"));
        return (db, new ProviderSettingsController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } });
    }

    private static void Seed(OdipDbContext db, Guid tenantId, string state = "NSW", string? zone = null)
    {
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St",
            State = state, TimeZoneId = zone,
        });
        db.SaveChanges();
    }

    private static UpsertProviderSettingsDto Dto(string? zone = null, string state = "NSW") => new()
    {
        RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = state, TimeZoneId = zone,
    };

    private static async Task<string?> Stored(OdipDbContext db, Guid tenantId) =>
        (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync(s => s.TenantId == tenantId)).TimeZoneId;

    [Theory]
    [InlineData("Australia/Lord_Howe")]
    [InlineData("Australia/Broken_Hill")]
    [InlineData("Europe/London")]
    [InlineData("australia/perth")]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Upsert_AZoneOffTheList_Is400WithTheSentence_AndNothingIsWritten(string zone)
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        Seed(db, TenantA, zone: "Australia/Brisbane");

        var result = await controller.Upsert(Dto(zone), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Equal(Refusal, body.Errors![0]);
        Assert.Equal("Australia/Brisbane", await Stored(db, TenantA));
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Theory]
    [InlineData("Australia/Sydney")]
    [InlineData("Australia/Melbourne")]
    [InlineData("Australia/Hobart")]
    [InlineData("Australia/Brisbane")]
    [InlineData("Australia/Adelaide")]
    [InlineData("Australia/Perth")]
    [InlineData("Australia/Darwin")]
    public async Task Upsert_EachOfTheSevenZones_IsAccepted_AndStored(string zone)
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        Seed(db, TenantA, zone: "Australia/Brisbane");

        Assert.IsType<OkObjectResult>((await controller.Upsert(Dto(zone), CancellationToken.None)).Result);
        Assert.Equal(zone, await Stored(db, TenantA));
    }

    [Fact]
    public void Upsert_StaysAdminOnly()
    {
        var upsert = typeof(ProviderSettingsController).GetMethod(nameof(ProviderSettingsController.Upsert))!;
        Assert.Equal("SuperAdmin,Admin", Assert.Single(upsert.GetCustomAttributes<AuthorizeAttribute>(inherit: true)).Roles);
    }

    [Fact]
    public async Task Upsert_ChangesOnlyTheCallersOrganisation()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        Seed(db, TenantA, zone: "Australia/Brisbane");
        Seed(db, TenantB, zone: "Australia/Darwin");

        await controller.Upsert(Dto("Australia/Perth"), CancellationToken.None);

        Assert.Equal("Australia/Perth", await Stored(db, TenantA));
        Assert.Equal("Australia/Darwin", await Stored(db, TenantB));
    }

    [Fact]
    public async Task Upsert_SuperAdminWithNoOrganisation_Is400_AndWritesNothing()
    {
        var (db, controller) = Create(tenantId: null, isSuperAdmin: true);
        using var _ = db;
        Seed(db, TenantA, zone: "Australia/Brisbane");

        Assert.IsType<BadRequestObjectResult>((await controller.Upsert(Dto("Australia/Perth"), CancellationToken.None)).Result);
        Assert.Equal("Australia/Brisbane", await Stored(db, TenantA));
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    private static (string Old, string New) OnlyChange(AuditLog row)
    {
        var change = Assert.Single(JsonSerializer.Deserialize<JsonElement>(row.Changes).EnumerateArray().ToList());
        Assert.Equal("TimeZoneId", change.GetProperty("Field").GetString());
        return (change.GetProperty("Old").GetString()!, change.GetProperty("New").GetString()!);
    }

    [Fact]
    public async Task Upsert_AZoneChange_WritesOneAuditRow_WithTheEffectiveOldZone_AndTheActor_AndNoneOnARepeat()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        Seed(db, TenantA, "NSW", zone: null);

        await controller.Upsert(Dto("Australia/Perth"), CancellationToken.None);

        var row = Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal("ProviderSettings", row.EntityType);
        Assert.Equal(AdminId, row.ChangedById);
        Assert.Equal(("Australia/Sydney", "Australia/Perth"), OnlyChange(row));

        await controller.Upsert(Dto("Australia/Perth"), CancellationToken.None);   // the same zone again
        await controller.Upsert(Dto(null), CancellationToken.None);                // not sent
        Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal("Australia/Perth", await Stored(db, TenantA));
    }

    [Fact]
    public async Task Upsert_StoringTheStatesOwnDefaultOnANullRow_MovesNothing_SoWritesNoAuditRow()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        Seed(db, TenantA, "NSW", zone: null);

        await controller.Upsert(Dto("Australia/Sydney"), CancellationToken.None);

        Assert.Equal("Australia/Sydney", await Stored(db, TenantA));
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task Upsert_AFirstEverSave_AuditsFromTheSydneyFallback_NotTheEntitysDefaultState()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;

        await controller.Upsert(Dto("Australia/Perth"), CancellationToken.None);

        Assert.Equal(("Australia/Sydney", "Australia/Perth"), OnlyChange(Assert.Single(await db.AuditLogs.ToListAsync())));
    }

    [Fact]
    public async Task Upsert_AnEchoWithoutAZone_LeavesTheStoredZone()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        Seed(db, TenantA, "NSW", zone: "Australia/Perth");

        await controller.Upsert(Dto(null) with { ManagerName = "Pat" }, CancellationToken.None);

        Assert.Equal("Australia/Perth", await Stored(db, TenantA));
        Assert.Equal("Pat", (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).ManagerName);
    }

    [Fact]
    public async Task Get_ReturnsTheStoredZone_NullWhenUnset_NeverTheDerivedDefault()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        Seed(db, TenantA, "WA", zone: null);
        Assert.Null(await ZoneFromGet(controller));

        (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).TimeZoneId = "Australia/Perth";
        await db.SaveChangesAsync();
        Assert.Equal("Australia/Perth", await ZoneFromGet(controller));
    }

    private static async Task<string?> ZoneFromGet(ProviderSettingsController c) =>
        Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>((await c.Get(CancellationToken.None)).Result).Value).Data!.TimeZoneId;
}
