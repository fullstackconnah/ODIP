using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Controllers;

/// <summary>
/// MED-02: the tenant-scoped primary manager contact (name + phone) on ProviderSettings — CRUD
/// and display only, no consumer yet (MED-01 reads it later). Same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern as ParticipantsControllerTests.
/// </summary>
public class ProviderSettingsControllerTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    private static UpsertProviderSettingsDto MinimalUpsertDto() => new()
    {
        RegistrationNumber = "REG123",
        ABN = "12345678901",
        OrganisationName = "Test Org",
        Address = "1 Test St",
        State = "VIC",
    };

    [Fact]
    public async Task Get_NoRowYet_ReturnsNullData()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        var result = await controller.Get(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto?>>(ok.Value);
        Assert.Null(body.Data);
    }

    [Fact]
    public async Task Upsert_ManagerNameAndPhone_RoundTripThroughGet()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        var dto = MinimalUpsertDto() with { ManagerName = "Priya Sharma", ManagerPhone = "0412345007" };
        var upsertResult = await controller.Upsert(dto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(upsertResult.Result);

        var getResult = await controller.Get(CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal("Priya Sharma", body.Data!.ManagerName);
        Assert.Equal("0412345007", body.Data.ManagerPhone);
    }

    [Fact]
    public async Task Upsert_WithoutManagerFields_LeavesThemNull()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        var upsertResult = await controller.Upsert(MinimalUpsertDto(), CancellationToken.None);
        Assert.IsType<OkObjectResult>(upsertResult.Result);

        var getResult = await controller.Get(CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Null(body.Data!.ManagerName);
        Assert.Null(body.Data.ManagerPhone);
    }

    [Fact]
    public async Task Upsert_ExistingRow_UpdatesManagerContactInPlace()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        await controller.Upsert(MinimalUpsertDto() with { ManagerName = "Old Name", ManagerPhone = "0000000000" }, CancellationToken.None);
        await controller.Upsert(MinimalUpsertDto() with { ManagerName = "New Name", ManagerPhone = "0412345678" }, CancellationToken.None);

        Assert.Equal(1, await db.ProviderSettings.CountAsync());

        var getResult = await controller.Get(CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal("New Name", body.Data!.ManagerName);
        Assert.Equal("0412345678", body.Data.ManagerPhone);
    }

    // ── Medication Competency mode (Warn | Enforce), per tenant ──

    private static async Task<ProviderSettingsDto> ReadAsync(ProviderSettingsController controller)
    {
        var getResult = await controller.Get(CancellationToken.None);
        return Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value).Data!;
    }

    [Fact]
    public async Task CompetencyMode_FirstSaveWithoutIt_DefaultsToWarn()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        await controller.Upsert(MinimalUpsertDto(), CancellationToken.None);

        Assert.Equal(MedicationCompetencyMode.Warn, (await ReadAsync(controller)).MedicationCompetencyMode);
    }

    [Fact]
    public async Task CompetencyMode_RoundTripsThroughGet_BothWays()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);

        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);
        Assert.Equal(MedicationCompetencyMode.Enforce, (await ReadAsync(controller)).MedicationCompetencyMode);
        Assert.Equal(MedicationCompetencyMode.Enforce, (await db.ProviderSettings.SingleAsync()).MedicationCompetencyMode);

        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Warn }, CancellationToken.None);
        Assert.Equal(MedicationCompetencyMode.Warn, (await ReadAsync(controller)).MedicationCompetencyMode);
    }

    [Fact]
    public async Task CompetencyMode_SavingTheOtherFieldsWithoutIt_LeavesEnforceAlone()
    {
        // A client that does not know the setting (an older form, a script) must never reset Enforce to Warn by saving the rest.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ProviderSettingsController(db);
        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);

        await controller.Upsert(MinimalUpsertDto() with { OrganisationName = "Renamed Org", MedicationCompetencyMode = null }, CancellationToken.None);

        var settings = await ReadAsync(controller);
        Assert.Equal("Renamed Org", settings.OrganisationName);
        Assert.Equal(MedicationCompetencyMode.Enforce, settings.MedicationCompetencyMode);
    }

    // ── who changed the medication safety control: one audit row per real change (review 3 finding M1) ──

    private static readonly Guid AdminId = Guid.NewGuid();

    private static ProviderSettingsController ControllerAs(OdipDbContext db, Guid? actorId = null, string actorName = "Dana Admin") =>
        new(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim(ClaimTypes.NameIdentifier, (actorId ?? AdminId).ToString()), new Claim("fullName", actorName)], "Test")),
                },
            },
        };

    private static async Task<List<Odip.Domain.Entities.AuditLog>> AuditRowsAsync(OdipDbContext db) => await db.AuditLogs.ToListAsync();

    [Fact]
    public async Task CompetencyMode_AChange_WritesExactlyOneAuditRow_WithTheOldTheNewAndWho()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = ControllerAs(db);
        await controller.Upsert(MinimalUpsertDto(), CancellationToken.None);   // Warn, the default: no change yet

        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);

        var row = Assert.Single(await AuditRowsAsync(db));
        Assert.Equal("ProviderSettings", row.EntityType);
        Assert.Equal((await db.ProviderSettings.SingleAsync()).Id, row.EntityId);
        Assert.Equal(AuditAction.Updated, row.Action);
        Assert.Equal(AdminId, row.ChangedById);
        Assert.Equal("Dana Admin", row.ChangedByName);
        var change = Assert.Single(JsonSerializer.Deserialize<JsonElement>(row.Changes).EnumerateArray().ToList());
        Assert.Equal("MedicationCompetencyMode", change.GetProperty("Field").GetString());
        Assert.Equal("Warn", change.GetProperty("Old").GetString());
        Assert.Equal("Enforce", change.GetProperty("New").GetString());

        // and back again: a second row, the other way round
        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Warn }, CancellationToken.None);
        var rows = await AuditRowsAsync(db);
        Assert.Equal(2, rows.Count);
        var back = JsonSerializer.Deserialize<JsonElement>(rows.OrderBy(r => r.ChangedAt).Last().Changes).EnumerateArray().Single();
        Assert.Equal("Enforce", back.GetProperty("Old").GetString());
        Assert.Equal("Warn", back.GetProperty("New").GetString());
    }

    [Fact]
    public async Task CompetencyMode_NoChange_WritesNoAuditRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = ControllerAs(db);
        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);
        var afterTheChange = (await AuditRowsAsync(db)).Count;   // the one row for Warn -> Enforce on the first save

        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);             // the same value
        await controller.Upsert(MinimalUpsertDto() with { OrganisationName = "Renamed Org", MedicationCompetencyMode = null }, CancellationToken.None);       // not sent
        await controller.Upsert(MinimalUpsertDto() with { ManagerPhone = "0412345007" }, CancellationToken.None);                                             // other fields only

        Assert.Equal(1, afterTheChange);
        Assert.Equal(1, await db.AuditLogs.CountAsync());
        Assert.Equal(MedicationCompetencyMode.Enforce, (await db.ProviderSettings.SingleAsync()).MedicationCompetencyMode);
    }

    [Theory]
    [InlineData(null, 0)]
    [InlineData(MedicationCompetencyMode.Warn, 0)]
    [InlineData(MedicationCompetencyMode.Enforce, 1)]
    public async Task CompetencyMode_TheFirstSave_AuditsOnlyAChangeFromTheDefault(MedicationCompetencyMode? sent, int expectedRows)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        await ControllerAs(db).Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = sent }, CancellationToken.None);

        Assert.Equal(expectedRows, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task CompetencyMode_TheAuditRowNeverCarriesTheBankDetails_ProviderSettingsIsNotAnAuditedEntity()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = ControllerAs(db);

        await controller.Upsert(MinimalUpsertDto() with
        {
            BankAccountName = "Test Org Operating", BSB = "062-000", AccountNumber = "12345678", MedicationCompetencyMode = MedicationCompetencyMode.Enforce,
        }, CancellationToken.None);

        var row = Assert.Single(await AuditRowsAsync(db));
        Assert.DoesNotContain("12345678", row.Changes);
        Assert.DoesNotContain("062-000", row.Changes);
        Assert.DoesNotContain("Operating", row.Changes);
        Assert.DoesNotContain(typeof(Odip.Domain.Entities.ProviderSettings), AuditedEntities.Types);   // it holds bank details: never audit the whole entity
    }

    [Fact]
    public async Task CompetencyMode_WithNoSignedInUser_StillWorks_AndTheRowHasNoActor()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());

        await new ProviderSettingsController(db).Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);

        var row = Assert.Single(await AuditRowsAsync(db));
        Assert.Null(row.ChangedById);
        Assert.Null(row.ChangedByName);
    }

    [Theory]
    [InlineData(7)]
    [InlineData(-1)]
    public async Task CompetencyMode_AnUndefinedValue_Is400_AndNothingChanges(int value)
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = ControllerAs(db);
        await controller.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);

        var result = await controller.Upsert(MinimalUpsertDto() with { OrganisationName = "Changed", MedicationCompetencyMode = (MedicationCompetencyMode)value }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var stored = await db.ProviderSettings.SingleAsync();
        Assert.Equal(MedicationCompetencyMode.Enforce, stored.MedicationCompetencyMode);
        Assert.Equal("Test Org", stored.OrganisationName);   // nothing else was saved either
        Assert.Equal(1, await db.AuditLogs.CountAsync());   // only the earlier real change
    }

    [Fact]
    public void CompetencyMode_IsTheStringNameOnTheWire_BothDirections_UnderTheApisJsonPolicy()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);

        var written = JsonSerializer.Serialize(new ProviderSettingsDto { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, options);
        var sent = JsonSerializer.Deserialize<UpsertProviderSettingsDto>("{\"registrationNumber\":\"R\",\"medicationCompetencyMode\":\"Enforce\"}", options)!;
        var omitted = JsonSerializer.Deserialize<UpsertProviderSettingsDto>("{\"registrationNumber\":\"R\"}", options)!;

        Assert.Contains("\"medicationCompetencyMode\":\"Enforce\"", written);
        Assert.Equal(MedicationCompetencyMode.Enforce, sent.MedicationCompetencyMode);
        Assert.Null(omitted.MedicationCompetencyMode);   // absent = leave the setting as it is
    }

    [Fact]
    public void CompetencyMode_CanOnlyBeChangedByAnAdmin_ThePutIsAdminOnly()
    {
        var upsert = typeof(ProviderSettingsController).GetMethod(nameof(ProviderSettingsController.Upsert))!;

        var roles = upsert.GetCustomAttribute<AuthorizeAttribute>()!.Roles;

        Assert.Equal("SuperAdmin,Admin", roles);   // a Coordinator may READ the settings (class level) but not write them
    }

    [Fact]
    public async Task CompetencyMode_IsPerTenant_OneProviderEnforcingLeavesAnotherOnWarn()
    {
        var dbName = Guid.NewGuid().ToString();
        var (tenantA, tenantB) = (Guid.NewGuid(), Guid.NewGuid());
        OdipDbContext ContextFor(Guid tenantId)
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(tenantId);
            tenant.Setup(t => t.IsSuperAdmin).Returns(false);
            return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);
        }
        using var dbA = ContextFor(tenantA);
        using var dbB = ContextFor(tenantB);
        var controllerA = new ProviderSettingsController(dbA);
        var controllerB = new ProviderSettingsController(dbB);

        await controllerA.Upsert(MinimalUpsertDto() with { MedicationCompetencyMode = MedicationCompetencyMode.Enforce }, CancellationToken.None);
        await controllerB.Upsert(MinimalUpsertDto(), CancellationToken.None);

        Assert.Equal(MedicationCompetencyMode.Enforce, (await ReadAsync(controllerA)).MedicationCompetencyMode);
        Assert.Equal(MedicationCompetencyMode.Warn, (await ReadAsync(controllerB)).MedicationCompetencyMode);
    }
}
