using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>A SuperAdmin's query filter is off, so a lookup with no organisation chosen used to land on an arbitrary organisation's row.</summary>
public class UnscopedSuperAdminSettingsTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid();

    private static (OdipDbContext Db, ICurrentTenant Tenant) Create(Guid? tenantId, bool superAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        db.AppSettings.Add(new AppSettings { Id = new Guid("00000000-0000-0000-0000-000000000001"), TenantId = B, QualificationWarningDays = 5, WeeklyHoursWarning = 11 });
        db.AppSettings.Add(new AppSettings { Id = new Guid("00000000-0000-0000-0000-000000000002"), TenantId = A, QualificationWarningDays = 7, WeeklyHoursWarning = 22 });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = B, OrganisationName = "Org B", State = "WA", RegistrationNumber = "R", ABN = "1", ManagerName = "Manager B", ManagerPhone = "0811111111" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = A, OrganisationName = "Org A", State = "VIC", RegistrationNumber = "R", ABN = "1", ManagerName = "Manager A", ManagerPhone = "0299990000" });
        db.SaveChanges();
        return (db, tenant.Object);
    }

    private static UpsertProviderSettingsDto Upsert(string state = "VIC") => new() { RegistrationNumber = "R", ABN = "12345678901", OrganisationName = "X", Address = "1 St", State = state };

    [Fact]
    public async Task SettingsGet_UnscopedSuperAdmin_ReturnsTheDefaults_NotAnOrganisationsRow()
    {
        var (db, tenant) = Create(null, true);
        var r = await new SettingsController(db, tenant).Get(default);
        var data = Assert.IsType<ApiResponse<AppSettingsDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;
        Assert.Equal((30, 38), (data.QualificationWarningDays, data.WeeklyHoursWarning));
    }

    [Fact]
    public async Task SettingsGet_SuperAdminViewingAsATenant_ReadsThatTenantsRow()
    {
        var (db, tenant) = Create(A, true);
        var r = await new SettingsController(db, tenant).Get(default);
        Assert.Equal(22, Assert.IsType<ApiResponse<AppSettingsDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!.WeeklyHoursWarning);
    }

    [Fact]
    public async Task ProviderSettingsGet_UnscopedSuperAdmin_ReturnsNoRow()
    {
        var (db, tenant) = Create(null, true);
        var r = await new ProviderSettingsController(db, tenant).Get(default);
        Assert.Null(Assert.IsType<ApiResponse<ProviderSettingsDto?>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data);
    }

    [Fact]
    public async Task ProviderSettingsGet_SuperAdminViewingAsATenant_ReadsThatTenantsRow()
    {
        var (db, tenant) = Create(A, true);
        var r = await new ProviderSettingsController(db, tenant).Get(default);
        Assert.Equal("Org A", Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!.OrganisationName);
    }

    [Fact]
    public async Task ProviderSettingsUpsert_UnscopedSuperAdmin_IsRefused_AndChangesNoOrganisation()
    {
        var (db, tenant) = Create(null, true);
        var r = await new ProviderSettingsController(db, tenant).Upsert(Upsert(), default);
        Assert.IsType<BadRequestObjectResult>(r.Result);
        Assert.Equal(new[] { "Org A", "Org B" }, (await db.ProviderSettings.OrderBy(p => p.OrganisationName).ToListAsync()).Select(p => p.OrganisationName));
    }

    [Fact]
    public async Task ProviderSettingsUpsert_SuperAdminViewingAsATenant_WritesThatTenantsRowOnly()
    {
        var (db, tenant) = Create(A, true);
        Assert.IsType<OkObjectResult>((await new ProviderSettingsController(db, tenant).Upsert(Upsert("NSW"), default)).Result);
        Assert.Equal("NSW", (await db.ProviderSettings.SingleAsync(p => p.TenantId == A)).State);
        Assert.Equal("WA", (await db.ProviderSettings.SingleAsync(p => p.TenantId == B)).State);
    }

    [Theory]
    [InlineData(" wa ", "WA")]
    [InlineData("nsw", "NSW")]
    public async Task ProviderSettingsUpsert_TrimsAndUppercasesTheState(string typed, string stored)
    {
        var (db, tenant) = Create(A, false);
        Assert.IsType<OkObjectResult>((await new ProviderSettingsController(db, tenant).Upsert(Upsert(typed), default)).Result);
        Assert.Equal(stored, (await db.ProviderSettings.SingleAsync(p => p.TenantId == A)).State);
    }

    [Theory]
    [InlineData("Victoria")]
    [InlineData("XX")]
    public async Task ProviderSettingsUpsert_UnknownState_IsRefused_AndStoresNothing(string typed)
    {
        var (db, tenant) = Create(A, false);
        var r = await new ProviderSettingsController(db, tenant).Upsert(Upsert(typed), default);
        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(r.Result).Value);
        Assert.Equal("Choose the organisation's state.", Assert.Single(body.Errors!));
        Assert.Equal("VIC", (await db.ProviderSettings.SingleAsync(p => p.TenantId == A)).State);
    }

    // Generation would succeed (complete settings exist, the claim has a line), so only the missing organisation can make it refuse.
    [Fact]
    public async Task BprCsv_ClaimWithNeitherTripNorParticipant_IsNotFound_InsteadOfReadingAnyOrganisationsSettings()
    {
        var (db, _) = Create(null, true);
        var claim = new TripClaim { Id = Guid.NewGuid(), ClaimReference = "C1" };
        db.TripClaims.Add(claim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 9, 7), SupportsDeliveredTo = new DateOnly(2026, 9, 7), Hours = 1m, UnitPrice = 40m, TotalAmount = 40m,
        });
        db.SaveChanges();
        var result = await new ClaimBatchService(db, new BprCsvService(db), new InvoiceService(db), TimeProvider.System).DownloadForClaimAsync(A, new System.Security.Claims.ClaimsPrincipal(), claim.Id, default);
        Assert.Equal(404, result.Status);
    }

    [Fact]
    public async Task MissedGuidanceContact_UnscopedSuperAdmin_ReturnsNoOrganisationsManager()
    {
        var (db, tenant) = Create(null, true);
        var r = await new MedicationsController(db, tenant).GetMissedGuidanceContact(default);
        Assert.Null(Assert.IsType<ApiResponse<MissedMedicationContactDto?>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task MissedGuidanceContact_InAnOrganisation_ReturnsThatOrganisationsManager(bool superAdminViewingAs)
    {
        var (db, tenant) = Create(A, superAdminViewingAs);
        var r = await new MedicationsController(db, tenant).GetMissedGuidanceContact(default);
        var data = Assert.IsType<ApiResponse<MissedMedicationContactDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;
        Assert.Equal(("Manager A", "0299990000"), (data.ManagerName, data.ManagerPhone));
    }
}
