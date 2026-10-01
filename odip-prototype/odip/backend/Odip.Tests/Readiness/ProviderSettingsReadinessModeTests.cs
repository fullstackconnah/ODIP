using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Readiness;

/// <summary>
/// The per-organisation readiness mode on ProviderSettings: who may change it, that it is tenant
/// scoped, that it changes only when the request carries it, that undefined values are refused,
/// and that a change writes exactly ONE audit row (field, old, new, actor) and never audits the
/// whole entity, which holds the organisation's bank details.
/// </summary>
public class ProviderSettingsReadinessModeTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    private static readonly Guid AdminId = Guid.Parse("dddddddd-0000-0000-0000-0000000000ad");

    private static ClaimsPrincipal AdminPrincipal() => new(new ClaimsIdentity(
        new[] { new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim("fullName", "Ada Admin") }, "Test"));

    private static (OdipDbContext db, ProviderSettingsController controller) Create(Guid? tenantId, bool isSuperAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);

        // The REAL audit interceptor is wired in, so "does not audit the whole entity" is proven
        // against the mechanism that would otherwise do it.
        var principal = AdminPrincipal();
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = principal });

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        var db = new OdipDbContext(options, tenant.Object);

        var controller = new ProviderSettingsController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } }
        };
        return (db, controller);
    }

    private static ProviderSettings SeedSettings(OdipDbContext db, Guid tenantId, ParticipantReadinessMode mode = ParticipantReadinessMode.Warn)
    {
        var s = new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org",
            Address = "1 St", BankAccountName = "Acme Pty Ltd", BSB = "123-456", AccountNumber = "98765432",
            ParticipantReadinessMode = mode,
        };
        db.ProviderSettings.Add(s);
        db.SaveChanges();
        db.AuditLogs.RemoveRange(db.AuditLogs.ToList()); // start every test with an empty audit trail
        db.SaveChanges();
        return s;
    }

    private static UpsertProviderSettingsDto Dto(ParticipantReadinessMode? mode = null) => new()
    {
        RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "VIC",
        BankAccountName = "Acme Pty Ltd", BSB = "123-456", AccountNumber = "98765432",
        ParticipantReadinessMode = mode,
    };

    private static async Task<ParticipantReadinessMode> StoredMode(OdipDbContext db, Guid tenantId) =>
        (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync(s => s.TenantId == tenantId)).ParticipantReadinessMode;

    // ── Reads ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_ReturnsTheModeOfTheCallersOrganisation_WarnByDefault()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA);
        SeedSettings(db, TenantB, ParticipantReadinessMode.Enforce);

        var result = await controller.Get(CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ParticipantReadinessMode.Warn, body.Data!.ParticipantReadinessMode);
    }

    [Fact]
    public void Dto_SerialisesTheModeAsAString_AndAnAbsentModeDeserialisesToNull()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Converters = { new JsonStringEnumConverter() },
        };
        using var read = JsonDocument.Parse(JsonSerializer.Serialize(new ProviderSettingsDto { ParticipantReadinessMode = ParticipantReadinessMode.Enforce }, options));
        Assert.Equal("Enforce", read.RootElement.GetProperty("participantReadinessMode").GetString());

        // The PUT body from an older client, or a tab that did not touch the control, has no field.
        Assert.Null(JsonSerializer.Deserialize<UpsertProviderSettingsDto>("""{"registrationNumber":"R"}""", options)!.ParticipantReadinessMode);
        Assert.Equal(ParticipantReadinessMode.Enforce,
            JsonSerializer.Deserialize<UpsertProviderSettingsDto>("""{"participantReadinessMode":"Enforce"}""", options)!.ParticipantReadinessMode);
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<UpsertProviderSettingsDto>("""{"participantReadinessMode":"Strict"}""", options));
    }

    // ── Changing it ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Upsert_AdminChangesTheMode_WritesExactlyOneAuditRow_AndNeverAuditsTheWholeEntity()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        var settings = SeedSettings(db, TenantA);

        // The same request ALSO edits the bank details: those are the fields that must never reach AuditLog.
        var dto = Dto(ParticipantReadinessMode.Enforce) with { BankAccountName = "New Bank Name", BSB = "999-999", AccountNumber = "11112222" };
        var result = await controller.Upsert(dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ParticipantReadinessMode.Enforce, await StoredMode(db, TenantA));

        var row = Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal("ProviderSettings", row.EntityType);
        Assert.Equal(settings.Id, row.EntityId);
        Assert.Equal(AuditAction.Updated, row.Action);
        Assert.Equal(AdminId, row.ChangedById);
        Assert.Equal("Ada Admin", row.ChangedByName);

        using var changes = JsonDocument.Parse(row.Changes);
        var change = Assert.Single(changes.RootElement.EnumerateArray());
        Assert.Equal("ParticipantReadinessMode", change.GetProperty("Field").GetString());
        Assert.Equal("Warn", change.GetProperty("Old").GetString());
        Assert.Equal("Enforce", change.GetProperty("New").GetString());

        foreach (var secret in new[] { "Acme", "New Bank Name", "123-456", "999-999", "98765432", "11112222", "BankAccountName", "BSB", "AccountNumber" })
            Assert.DoesNotContain(secret, row.Changes);
    }

    [Fact]
    public async Task Upsert_ChangingOnlyOtherFields_WritesNoAuditRowAtAll()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA);

        await controller.Upsert(Dto() with { BSB = "555-555", ManagerName = "Priya" }, CancellationToken.None);

        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task Upsert_WithoutTheModeField_NeverTouchesTheStoredMode_SoAStaleTabCannotRevertIt()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA, ParticipantReadinessMode.Enforce);

        var result = await controller.Upsert(Dto(mode: null) with { ManagerPhone = "0412345678" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ParticipantReadinessMode.Enforce, await StoredMode(db, TenantA));
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task Upsert_SendingTheSameModeAgain_IsANoOp_WithNoAuditRow()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA, ParticipantReadinessMode.Enforce);

        await controller.Upsert(Dto(ParticipantReadinessMode.Enforce), CancellationToken.None);

        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task Upsert_EnforceBackToWarn_IsAuditedWithTheOldAndNewValues()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA, ParticipantReadinessMode.Enforce);

        await controller.Upsert(Dto(ParticipantReadinessMode.Warn), CancellationToken.None);

        Assert.Equal(ParticipantReadinessMode.Warn, await StoredMode(db, TenantA));
        using var changes = JsonDocument.Parse((await db.AuditLogs.SingleAsync()).Changes);
        var change = changes.RootElement[0];
        Assert.Equal("Enforce", change.GetProperty("Old").GetString());
        Assert.Equal("Warn", change.GetProperty("New").GetString());
    }

    [Fact]
    public async Task Upsert_FirstEverSave_ChoosingEnforce_CreatesTheRowAndAuditsTheChangeFromTheDefault()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;

        var result = await controller.Upsert(Dto(ParticipantReadinessMode.Enforce), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ParticipantReadinessMode.Enforce, await StoredMode(db, TenantA));
        using var changes = JsonDocument.Parse((await db.AuditLogs.SingleAsync()).Changes);
        Assert.Equal("Warn", changes.RootElement[0].GetProperty("Old").GetString());
    }

    [Theory]
    [InlineData(99)]
    [InlineData(-1)]
    [InlineData(2)]
    public async Task Upsert_UndefinedMode_IsRejected_AndNothingIsWritten(int undefined)
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA, ParticipantReadinessMode.Enforce);

        var result = await controller.Upsert(Dto((ParticipantReadinessMode)undefined) with { ManagerName = "Should not save" }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.False(body.Success);
        Assert.Equal(ParticipantReadinessMode.Enforce, await StoredMode(db, TenantA));
        Assert.Null((await db.ProviderSettings.SingleAsync()).ManagerName);
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    // ── Tenant scope and who may do it ──────────────────────────────────────

    [Fact]
    public async Task Upsert_IsTenantScoped_AnAdminOfOneOrganisationCannotChangeAnothersMode()
    {
        var (db, controller) = Create(TenantA, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA);
        SeedSettings(db, TenantB);

        await controller.Upsert(Dto(ParticipantReadinessMode.Enforce), CancellationToken.None);

        Assert.Equal(ParticipantReadinessMode.Enforce, await StoredMode(db, TenantA));
        Assert.Equal(ParticipantReadinessMode.Warn, await StoredMode(db, TenantB));
    }

    [Fact]
    public async Task Upsert_SuperAdminViewingAsATenant_CanChangeThatTenantsMode()
    {
        // View-as is TenantId set and IsSuperAdmin false (CurrentTenant), exactly an Admin's scope.
        var (db, controller) = Create(TenantB, isSuperAdmin: false);
        using var _ = db;
        SeedSettings(db, TenantA);
        SeedSettings(db, TenantB);

        var result = await controller.Upsert(Dto(ParticipantReadinessMode.Enforce), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ParticipantReadinessMode.Enforce, await StoredMode(db, TenantB));
        Assert.Equal(ParticipantReadinessMode.Warn, await StoredMode(db, TenantA));
    }

    [Fact]
    public async Task Upsert_SuperAdminWithNoViewAsTenant_CannotChangeTheMode_ButOtherFieldsStillSave()
    {
        var (db, controller) = Create(tenantId: null, isSuperAdmin: true);
        using var _ = db;
        SeedSettings(db, TenantA);

        var refused = await controller.Upsert(Dto(ParticipantReadinessMode.Enforce), CancellationToken.None);
        var allowed = await controller.Upsert(Dto() with { ManagerName = "Still works" }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(refused.Result).Value);
        Assert.Contains("view as", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.IsType<OkObjectResult>(allowed.Result);
        Assert.Equal(ParticipantReadinessMode.Warn, await StoredMode(db, TenantA));
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public void Upsert_IsRestrictedToAdminAndSuperAdmin_WhileCoordinatorsMayOnlyRead()
    {
        var upsert = typeof(ProviderSettingsController).GetMethod(nameof(ProviderSettingsController.Upsert))!;
        var method = Assert.Single(upsert.GetCustomAttributes<AuthorizeAttribute>(inherit: true));
        Assert.Equal("SuperAdmin,Admin", method.Roles);
        Assert.DoesNotContain("Coordinator", method.Roles!);

        var onClass = Assert.Single(typeof(ProviderSettingsController).GetCustomAttributes<AuthorizeAttribute>());
        Assert.Contains("Coordinator", onClass.Roles!);
        var get = typeof(ProviderSettingsController).GetMethod(nameof(ProviderSettingsController.Get))!;
        Assert.Empty(get.GetCustomAttributes<AuthorizeAttribute>(inherit: true));
    }

    // ── Audit scope guard, model and migration ──────────────────────────────

    [Fact]
    public void ProviderSettings_IsDeliberatelyNotAnAuditedEntity_BecauseItHoldsBankDetails()
    {
        // If this fails, someone added ProviderSettings to AuditedEntities: the interceptor would then
        // copy BankAccountName, BSB and AccountNumber into AuditLog on every settings save.
        Assert.DoesNotContain(typeof(ProviderSettings), AuditedEntities.Types);
    }

    [Fact]
    public void Model_StoresTheModeAsANotNullColumnWithAConstantWarnDefault()
    {
        using var db = Create(TenantA, false).db;
        var property = db.Model.FindEntityType(typeof(ProviderSettings))!.FindProperty(nameof(ProviderSettings.ParticipantReadinessMode))!;

        Assert.False(property.IsNullable);
        Assert.Equal(ParticipantReadinessMode.Warn, property.GetDefaultValue());
        Assert.Equal(0, (int)ParticipantReadinessMode.Warn); // the persisted default
    }

    [Fact]
    public void Migration_AddsTheColumnNotNullWithDefaultZero_AndIsDiscoveredByTheContext()
    {
        var migrationType = typeof(OdipDbContext).Assembly.GetTypes()
            .Single(t => t.Name == "AddParticipantReadinessMode" && typeof(Migration).IsAssignableFrom(t));
        var migration = (Migration)Activator.CreateInstance(migrationType)!;

        // Deploy safety: one AddColumn, NOT NULL, constant default 0 (= Warn), nothing destructive, no data rewrite.
        var op = Assert.Single(migration.UpOperations);
        var add = Assert.IsType<AddColumnOperation>(op);
        Assert.Equal("ProviderSettings", add.Table);
        Assert.Equal("ParticipantReadinessMode", add.Name);
        Assert.False(add.IsNullable);
        Assert.Equal(0, add.DefaultValue);
        Assert.Equal(typeof(int), add.ClrType);
        var down = Assert.IsType<DropColumnOperation>(Assert.Single(migration.DownOperations));
        Assert.Equal("ParticipantReadinessMode", down.Name);

        var tenant = new Mock<ICurrentTenant>();
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_migration_discovery_test;Username=postgres;Password=postgres").Options;
        using var db = new OdipDbContext(options, tenant.Object);
        Assert.Contains(db.Database.GetMigrations(), id => id.EndsWith("_AddParticipantReadinessMode", StringComparison.Ordinal));
    }
}
