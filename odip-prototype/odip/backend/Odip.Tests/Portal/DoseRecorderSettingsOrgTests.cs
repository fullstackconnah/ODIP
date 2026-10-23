using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// An unscoped SuperAdmin's JWT still carries their HOME organisation, so the context's "scoped" provider settings are the home organisation's. A dose
/// is judged on the medication's own organisation: its Medication Competency mode and its zone (the time checks), as it is saved there (#350).
/// </summary>
public class DoseRecorderSettingsOrgTests
{
    private static readonly Guid WaOrg = Guid.Parse("7a000000-0000-0000-0000-000000000001");
    private static readonly Guid HomeOrg = Guid.Parse("4b000000-0000-0000-0000-000000000002");

    /// <summary>The shift, worker and medication belong to a Perth organisation in <paramref name="orgMode"/>; the caller is a SuperAdmin whose home organisation is Sydney in <paramref name="homeMode"/>.</summary>
    private static async Task<(ShiftPackageFixture F, ParticipantMedication Med)> Unscoped(
        MedicationCompetencyMode homeMode, MedicationCompetencyMode orgMode, bool workerCompetent = true, DateTimeOffset? now = null)
    {
        var f = Create(ShiftStatus.InProgress, workerCompetent, now, tenantId: WaOrg, competencyMode: orgMode);
        (await f.Db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State = "WA";
        f.Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = HomeOrg, State = "NSW", MedicationCompetencyMode = homeMode });
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg",
            DoseDescription = "1 tablet", Type = MedicationType.Regular, TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1),
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        };
        f.Db.ParticipantMedications.Add(med);
        await f.Db.SaveChangesAsync();
        f.Tenant.Setup(t => t.TenantId).Returns(HomeOrg);
        f.Tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return (f, med);
    }

    private static CreateAdministrationDto Dose(DateTime scheduledAt) => new()
    {
        ScheduledAt = scheduledAt, Status = MedicationAdministrationStatus.Administered,
        IdempotencyKey = "k1", DoseGiven = "1 tablet", AdministeredAtTimeZone = "Australia/Perth",
    };

    private static readonly DateTime Nine = new(2026, 7, 14, 9, 0, 0, DateTimeKind.Unspecified);

    private static ApiResponse<AdministrationDto> Body(ActionResult<ApiResponse<AdministrationDto>> r) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    private static int Status(ActionResult<ApiResponse<AdministrationDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode!.Value;

    [Fact]
    public async Task RecordShiftDose_HomeWarnOrgEnforce_RefusesAWorkerWithoutTheCredential()
    {
        var (f, med) = await Unscoped(MedicationCompetencyMode.Warn, MedicationCompetencyMode.Enforce, workerCompetent: false);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        Assert.Equal(403, Status(result));
        Assert.Empty(await f.Db.MedicationAdministrations.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task RecordShiftDose_HomeEnforceOrgWarn_RecordsAndFlagsAWorkerWithoutTheCredential()
    {
        var (f, med) = await Unscoped(MedicationCompetencyMode.Enforce, MedicationCompetencyMode.Warn, workerCompetent: false);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        Assert.Equal(200, Status(result));
        Assert.True(Body(result).Data!.RecordedWithoutCompetency);
    }

    [Fact]
    public async Task RecordShiftDose_TheTimeChecksFollowTheMedicationsZone()
    {
        // 22:30 UTC on the 14th is 06:30 on the 15th in Perth but 08:30 in Sydney: the 09:00 dose is 2.5 hours early in Perth, 30 minutes early in Sydney.
        var (f, med) = await Unscoped(MedicationCompetencyMode.Warn, MedicationCompetencyMode.Warn, now: new DateTimeOffset(2026, 7, 14, 22, 30, 0, TimeSpan.Zero));

        var result = await new MedicationAdministrationRecorder(f.Db, clock: f.Clock).RecordAsync(
            new RecordAdministrationRequest(med.Id, Dose(new DateTime(2026, 7, 15, 9, 0, 0, DateTimeKind.Unspecified)), f.Worker.Id, "Ben Turner"), default);

        Assert.Equal(RecordAdministrationOutcome.TimeRejected, result.Outcome);
        Assert.Equal(MedicationErrorCodes.AdministrationTooEarly, result.Code);
    }

    [Fact]
    public async Task GetShiftDetail_ReportsTheShiftsOrganisationsCompetencyMode()
    {
        var (f, _) = await Unscoped(MedicationCompetencyMode.Warn, MedicationCompetencyMode.Enforce, workerCompetent: false);

        Assert.False(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).CanRecordDoses);
    }

    [Fact]
    public async Task FinishShift_HomeEnforceOrgWarn_BlocksOnAnUnrecordedDoseForAWorkerWithoutTheCredential()
    {
        // Warn lets the worker record (flagged), so the dose that has come due must have an outcome. Under the home org (Enforce) canRecord is false and Finish would close with it unrecorded.
        var (f, med) = await Unscoped(MedicationCompetencyMode.Enforce, MedicationCompetencyMode.Warn, workerCompetent: false);

        var body = Failure(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true }, default), 422);

        Assert.Equal(ShiftErrorCodes.ShiftFinishBlocked, body.Code);
        var blocker = Assert.Single(body.Data!.FinishBlockers);
        Assert.Equal(ShiftFinishBlockerCodes.DoseOutcomeMissing, blocker.Code);
        Assert.Equal(med.Id, blocker.MedicationId);
    }
}
