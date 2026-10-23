using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// A SuperAdmin's query filter is off, so the db-only provider-settings reads (time zone, public holidays, competency mode) used to land on an
/// arbitrary organisation's row. Unscoped they give the no-row defaults; viewing as an organisation, that organisation's row; staff, unchanged.
/// </summary>
public class UnscopedSuperAdminResolverTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid();
    private static readonly DateOnly Day = new(2026, 6, 1);

    private static OdipDbContext Create(Guid? tenantId, bool superAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        foreach (var (id, state) in new[] { (B, "WA"), (A, "QLD") })
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = id, OrganisationName = "Org", State = state, RegistrationNumber = "R", ABN = "1",
                ManagerName = "M", ManagerPhone = "0", MedicationCompetencyMode = MedicationCompetencyMode.Enforce });
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = Day, Name = "WA Day", State = "WA" });
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = Day, Name = "QLD Day", State = "QLD" });
        db.SaveChanges();
        return db;
    }

    [Fact]
    public async Task TimeZone_UnscopedSuperAdmin_IsTheDefault_NotAnOrganisations()
    {
        var zone = await ProviderTimeZoneResolver.ResolveAsync(Create(null, true), default);
        Assert.Equal(ProviderTimeZoneResolver.FromState(null).Id, zone.Id);
    }

    [Fact]
    public async Task TimeZone_SuperAdminViewingAsATenant_IsThatTenants()
    {
        var zone = await ProviderTimeZoneResolver.ResolveAsync(Create(A, true), default);
        Assert.Equal(ProviderTimeZoneResolver.FromState("QLD").Id, zone.Id);
    }

    [Fact]
    public async Task TimeZone_Admin_IsTheirOrganisations()
    {
        var zone = await ProviderTimeZoneResolver.ResolveAsync(Create(B, false), default);
        Assert.Equal(ProviderTimeZoneResolver.FromState("WA").Id, zone.Id);
    }

    [Fact]
    public async Task Holidays_UnscopedSuperAdmin_HasNoStateHolidays()
    {
        var holidays = await new RosterAvailability(Create(null, true), Mock.Of<IStaffUnavailabilityQuery>()).PublicHolidaysAsync(Day, Day, default);
        Assert.Empty(holidays);
    }

    [Fact]
    public async Task Holidays_SuperAdminViewingAsATenant_HasThatTenantsState()
    {
        var holidays = await new RosterAvailability(Create(A, true), Mock.Of<IStaffUnavailabilityQuery>()).PublicHolidaysAsync(Day, Day, default);
        Assert.Equal("QLD Day", Assert.Single(holidays).Name);
    }

    [Fact]
    public async Task Holidays_Admin_HasTheirStateHoliday()
    {
        var holidays = await new RosterAvailability(Create(B, false), Mock.Of<IStaffUnavailabilityQuery>()).PublicHolidaysAsync(Day, Day, default);
        Assert.Equal("WA Day", Assert.Single(holidays).Name);
    }

    [Fact]
    public async Task CompetencyMode_UnscopedSuperAdmin_IsTheDefaultWarn()
    {
        var access = await new MedicationAdministrationRecorder(Create(null, true)).CheckRecordingAccessAsync(null, default);
        Assert.Equal(MedicationCompetencyMode.Warn, access.Mode);
    }

    [Fact]
    public async Task CompetencyMode_SuperAdminViewingAsATenant_IsThatTenants()
    {
        var access = await new MedicationAdministrationRecorder(Create(A, true)).CheckRecordingAccessAsync(null, default);
        Assert.Equal(MedicationCompetencyMode.Enforce, access.Mode);
    }

    [Fact]
    public async Task CompetencyMode_Admin_IsTheirOrganisations()
    {
        var access = await new MedicationAdministrationRecorder(Create(B, false)).CheckRecordingAccessAsync(null, default);
        Assert.Equal(MedicationCompetencyMode.Enforce, access.Mode);
    }
}
