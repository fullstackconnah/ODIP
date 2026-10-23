using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// The portal's start, manual-finish, need-to-know window, dose bound and handover window read the provider state for the shift's time zone. An unscoped
/// SuperAdmin's tenant filter returns no settings row, so those reads fell back to the Sydney default: each now comes from the shift's own organisation.
/// </summary>
public class PortalProviderSettingsScopeTests
{
    private const string Perth = "Australia/Perth";

    /// <summary>A WA shift (Published unless <paramref name="status"/> says otherwise); <paramref name="unscoped"/> makes the SuperAdmin caller view as no organisation.</summary>
    private static async Task<ShiftPackageFixture> Fixture(bool unscoped, Guid? staffTenant = null, ShiftStatus status = ShiftStatus.Published)
    {
        var f = Create(status, tenantId: staffTenant);
        (await f.Db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State = "WA";
        await f.Db.SaveChangesAsync();
        if (unscoped) f.Tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        return f;
    }

    private static async Task<string> StartedZone(ShiftPackageFixture f)
    {
        Detail(await f.Controller.StartShift(f.Shift.Id, new StartShiftDto(), default));
        return (await f.Db.ShiftCompletions.SingleAsync()).TimeZoneId;
    }

    private static async Task<string> ManualFinishZone(ShiftPackageFixture f)
    {
        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true, ActualStart = ActualStartUtc }, default));
        return (await f.Db.ShiftCompletions.SingleAsync()).TimeZoneId;
    }

    [Fact]
    public async Task Start_UnscopedSuperAdmin_GetsTheShiftsOrganisationZone() => Assert.Equal(Perth, await StartedZone(await Fixture(unscoped: true)));

    [Fact]
    public async Task Start_SuperAdminViewingAsTheOrganisation_GetsItsZone() => Assert.Equal(Perth, await StartedZone(await Fixture(unscoped: false)));

    [Fact]
    public async Task Start_StaffOfTheOrganisation_GetItsZone() => Assert.Equal(Perth, await StartedZone(await Fixture(unscoped: false, staffTenant: Guid.NewGuid())));

    [Fact]
    public async Task ManualFinish_UnscopedSuperAdmin_GetsTheShiftsOrganisationZone() => Assert.Equal(Perth, await ManualFinishZone(await Fixture(unscoped: true)));

    [Fact]
    public async Task ManualFinish_SuperAdminViewingAsTheOrganisation_GetsItsZone() => Assert.Equal(Perth, await ManualFinishZone(await Fixture(unscoped: false)));

    [Fact]
    public async Task ManualFinish_StaffOfTheOrganisation_GetItsZone() => Assert.Equal(Perth, await ManualFinishZone(await Fixture(unscoped: false, staffTenant: Guid.NewGuid())));

    // Perth's window opens 12 July 01:00 UTC (rostered start 14 July 01:00 UTC less 48 hours); Sydney's opened at 11 July 23:00 UTC. At 12 July 00:00 UTC only
    // the Sydney reading has it open.
    private static readonly DateTimeOffset BeforePerthWindowOpens = new(2026, 7, 12, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task NeedToKnowWindow_UnscopedSuperAdmin_OpensOnTheShiftsOrganisationZone()
    {
        var f = await Fixture(unscoped: true);
        f.Clock.Set(BeforePerthWindowOpens);

        var detail = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));

        Assert.Contains("09:00 on Sunday 12 July", detail.SensitiveInfoWithheldReason);
    }

    [Fact]
    public async Task HandoverWindow_UnscopedSuperAdmin_OpensOnTheShiftsOrganisationZone()
    {
        var f = await Fixture(unscoped: true);
        f.Clock.Set(BeforePerthWindowOpens);

        var body = Failure(await f.Controller.AcknowledgeHandover(f.Shift.Id, null, default), 404);

        Assert.Contains("09:00 on Sunday 12 July", body.Message);
    }

    [Fact]
    public async Task DoseBound_UnscopedSuperAdmin_UsesTheShiftsOrganisationZone()
    {
        // Perth's earliest dose time is the shift start, 13 July 23:05 UTC (08:00 local is 14 July 00:00 UTC, later than the start); Sydney's is 22:00 UTC.
        var f = await Fixture(unscoped: true, status: ShiftStatus.InProgress);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
            SupportLevel = MedicationSupportLevel.Administer,
        };
        f.Db.ParticipantMedications.Add(med);
        await f.Db.SaveChangesAsync();

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, new CreateAdministrationDto
        {
            ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0), Status = MedicationAdministrationStatus.Administered,
            AdministeredAt = new DateTime(2026, 7, 13, 22, 30, 0, DateTimeKind.Utc), DoseGiven = "1 tablet", AdministeredAtTimeZone = "Australia/Perth",
        }, default);

        Assert.Equal(422, Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode);
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }
}
