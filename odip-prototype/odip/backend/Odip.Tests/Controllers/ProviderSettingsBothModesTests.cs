using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Provider Settings carries TWO per-organisation modes with the same contract: the participant readiness check and the medication competency
/// check. Each is applied, and audited, independently and only when the request carries it and it differs from the stored value; each change
/// writes exactly ONE single-field audit row (ProviderSettings holds the bank details, so it is not an audited entity); an undefined value, in
/// either, refuses the whole request before anything is written. The single-mode behaviour has its own tests
/// (<see cref="ProviderSettingsControllerTests"/> for the competency mode, ProviderSettingsReadinessModeTests for the readiness mode); these
/// cover the two together. The REAL audit interceptor is wired in, so "never audits the whole entity" is proven against the mechanism that
/// would otherwise do it.
/// </summary>
public class ProviderSettingsBothModesTests
{
    private static readonly Guid TenantId = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid AdminId = Guid.Parse("dddddddd-0000-0000-0000-0000000000ad");

    private static (OdipDbContext Db, ProviderSettingsController Controller) Create(
        ParticipantReadinessMode readiness, MedicationCompetencyMode competency, bool organisationInScope = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(organisationInScope ? TenantId : null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(!organisationInScope);

        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim("fullName", "Ada Admin")], "Test"));
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = principal });
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        var db = new OdipDbContext(options, tenant.Object);

        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St",
            BankAccountName = "Acme Pty Ltd", BSB = "123-456", AccountNumber = "98765432",
            ParticipantReadinessMode = readiness, MedicationCompetencyMode = competency,
        });
        db.SaveChanges();
        db.AuditLogs.RemoveRange(db.AuditLogs.ToList());   // every test starts with an empty audit trail
        db.SaveChanges();

        var controller = new ProviderSettingsController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } },
        };
        return (db, controller);
    }

    private static UpsertProviderSettingsDto Dto(ParticipantReadinessMode? readiness = null, MedicationCompetencyMode? competency = null) => new()
    {
        RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "VIC",
        BankAccountName = "Acme Pty Ltd", BSB = "123-456", AccountNumber = "98765432",
        ParticipantReadinessMode = readiness, MedicationCompetencyMode = competency,
    };

    private static JsonElement TheChange(AuditLog row) => Assert.Single(JsonSerializer.Deserialize<JsonElement>(row.Changes).EnumerateArray().ToList());

    [Fact]
    public async Task ChangingBothModesInOneRequest_WritesExactlyOneAuditRowForEach_EachNamingItsOwnField()
    {
        var (db, controller) = Create(ParticipantReadinessMode.Warn, MedicationCompetencyMode.Warn);

        var result = await controller.Upsert(Dto(ParticipantReadinessMode.Enforce, MedicationCompetencyMode.Enforce), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var rows = await db.AuditLogs.ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r =>
        {
            Assert.Equal(nameof(ProviderSettings), r.EntityType);
            Assert.Equal(AuditAction.Updated, r.Action);
            Assert.Equal(AdminId, r.ChangedById);
            Assert.Equal("Ada Admin", r.ChangedByName);
            Assert.Equal("Warn", TheChange(r).GetProperty("Old").GetString());
            Assert.Equal("Enforce", TheChange(r).GetProperty("New").GetString());
            // never the bank details: the interceptor is wired in and ProviderSettings is not an audited entity
            Assert.DoesNotContain("98765432", r.Changes);
            Assert.DoesNotContain("123-456", r.Changes);
            Assert.DoesNotContain("Acme", r.Changes);
        });
        Assert.Equal(
            [nameof(ProviderSettings.MedicationCompetencyMode), nameof(ProviderSettings.ParticipantReadinessMode)],
            rows.Select(r => TheChange(r).GetProperty("Field").GetString()!).Order().ToList());
        var stored = await db.ProviderSettings.SingleAsync();
        Assert.Equal(ParticipantReadinessMode.Enforce, stored.ParticipantReadinessMode);
        Assert.Equal(MedicationCompetencyMode.Enforce, stored.MedicationCompetencyMode);
    }

    [Theory]
    [InlineData(true, false)]    // only the readiness mode is sent
    [InlineData(false, true)]    // only the competency mode is sent
    [InlineData(false, false)]   // neither is sent
    public async Task AModeThatIsNotSent_IsLeftAlone_AndOnlyTheModeThatWasSentIsAudited(bool sendReadiness, bool sendCompetency)
    {
        // Both start on Enforce: the mode that is not sent must stay Enforce (never fall back to the Warn default), and be neither written nor audited.
        var (db, controller) = Create(ParticipantReadinessMode.Enforce, MedicationCompetencyMode.Enforce);

        await controller.Upsert(
            Dto(sendReadiness ? ParticipantReadinessMode.Warn : null, sendCompetency ? MedicationCompetencyMode.Warn : null) with { OrganisationName = "Renamed Org" },
            CancellationToken.None);

        var stored = await db.ProviderSettings.SingleAsync();
        Assert.Equal("Renamed Org", stored.OrganisationName);
        Assert.Equal(sendReadiness ? ParticipantReadinessMode.Warn : ParticipantReadinessMode.Enforce, stored.ParticipantReadinessMode);
        Assert.Equal(sendCompetency ? MedicationCompetencyMode.Warn : MedicationCompetencyMode.Enforce, stored.MedicationCompetencyMode);
        Assert.Equal((sendReadiness ? 1 : 0) + (sendCompetency ? 1 : 0), await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task OneModeSentUnchanged_AndTheOtherChanged_WritesOnlyTheChangedModesRow()
    {
        var (db, controller) = Create(ParticipantReadinessMode.Enforce, MedicationCompetencyMode.Warn);

        await controller.Upsert(Dto(ParticipantReadinessMode.Enforce, MedicationCompetencyMode.Enforce), CancellationToken.None);   // readiness: the same value

        var row = Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal(nameof(ProviderSettings.MedicationCompetencyMode), TheChange(row).GetProperty("Field").GetString());
    }

    [Theory]
    [InlineData(1, 7)]   // a valid, different readiness mode with an undefined competency mode
    [InlineData(7, 1)]   // the other way round
    public async Task AnUndefinedValueInEitherMode_RefusesTheWholeRequest_AndNothingIsWritten(int readiness, int competency)
    {
        var (db, controller) = Create(ParticipantReadinessMode.Warn, MedicationCompetencyMode.Warn);

        var result = await controller.Upsert(
            Dto((ParticipantReadinessMode)readiness, (MedicationCompetencyMode)competency) with { OrganisationName = "Renamed Org" }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var stored = await db.ProviderSettings.SingleAsync();
        Assert.Equal("Org", stored.OrganisationName);
        Assert.Equal(ParticipantReadinessMode.Warn, stored.ParticipantReadinessMode);
        Assert.Equal(MedicationCompetencyMode.Warn, stored.MedicationCompetencyMode);
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task WithNoOrganisationInScope_ARequestCarryingBothModes_IsRefusedByTheReadinessGuard_AndNeitherModeIsWritten()
    {
        // A SuperAdmin who has not chosen an organisation to view as: the readiness guard refuses the request, and the competency mode in the same
        // request must not slip through to an arbitrary organisation row.
        var (db, controller) = Create(ParticipantReadinessMode.Warn, MedicationCompetencyMode.Warn, organisationInScope: false);

        var result = await controller.Upsert(Dto(ParticipantReadinessMode.Enforce, MedicationCompetencyMode.Enforce), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var stored = await db.ProviderSettings.SingleAsync();
        Assert.Equal(ParticipantReadinessMode.Warn, stored.ParticipantReadinessMode);
        Assert.Equal(MedicationCompetencyMode.Warn, stored.MedicationCompetencyMode);
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }
}
