using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// Recording a dose FROM THE PACKAGE (D2/D3): <c>POST portal/shifts/{id}/medications/{medicationId}/administrations</c> acts
/// only on the caller's OWN shift, which must be InProgress, for a medication of the shift's participant, and a scheduled
/// dose must be one of the window's due slots. The general endpoint is untouched. Then the shared recorder applies.
/// </summary>
public class PortalRecordShiftDoseTests
{
    private static readonly DateTime Nine = new(2026, 7, 14, 9, 0, 0, DateTimeKind.Unspecified);
    private static readonly DateTime Noon = new(2026, 7, 14, 12, 30, 0, DateTimeKind.Unspecified);

    private static ParticipantMedication AddMed(
        ShiftPackageFixture f, string name = "Levetiracetam", string? times = "09:00,12:30", MedicationType type = MedicationType.Regular,
        bool highRisk = false, MedicationStatus status = MedicationStatus.Active, Guid? participantId = null)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = participantId ?? f.Participant.Id, Name = name, Strength = "500mg",
            DoseDescription = "1 tablet", Type = type, TimesOfDay = type == MedicationType.Regular ? times : null, IsHighRisk = highRisk,
            StartDate = new DateTime(2026, 1, 1), Status = status,
            PrnIndication = type == MedicationType.Prn ? "Pain" : null, PrnMaxDosesPer24h = type == MedicationType.Prn ? 4 : null,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    private static CreateAdministrationDto Dose(
        DateTime? scheduledAt, MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered, string? key = null,
        string? reason = null) => new()
    {
        ScheduledAt = scheduledAt, Status = status, IdempotencyKey = key, DoseGiven = "1 tablet", Reason = reason,
        AdministeredAtTimeZone = "Australia/Sydney",
    };

    private static ApiResponse<AdministrationDto> Body(ActionResult<ApiResponse<AdministrationDto>> r) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    private static int Status(ActionResult<ApiResponse<AdministrationDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode!.Value;

    // ── happy paths ──

    [Fact]
    public async Task RecordingADueDose_CreatesTheRecord_AttributedToTheWorker_AndTheSlotReadsRecorded()
    {
        var f = Create();
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);

        Assert.Equal(200, Status(result));
        var record = Body(result).Data!;
        Assert.Equal(f.Worker.Id, record.RecordedByUserId);
        Assert.Equal("Ben Turner", record.RecordedByName);
        Assert.Equal(Nine, record.ScheduledAt);
        var detail = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));
        Assert.Equal(PortalDoseState.Recorded, detail.MedicationsDue.Single(s => s.ScheduledAt == Nine).State);
        Assert.Equal(PortalDoseState.Due, detail.MedicationsDue.Single(s => s.ScheduledAt == Noon).State);   // 12:30 is still ahead of the 11:00 clock
    }

    [Fact]
    public async Task NotGivenThisShift_IsAMissedRecordWithItsReason_AndClearsTheFinishBlocker()
    {
        var f = Create();
        var med = AddMed(f, times: "09:00");
        f.Db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = f.Shift.Id, AuthorUserId = f.Worker.Id, AuthorName = "Ben", Body = "ok" });
        f.Db.SaveChanges();

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id,
            Dose(Nine, MedicationAdministrationStatus.Missed, reason: "Participant asleep; handed to the evening worker"), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(MedicationAdministrationStatus.Missed, Body(result).Data!.Status);
        Assert.Equal("Participant asleep; handed to the evening worker", Body(result).Data!.Reason);
        Assert.Empty(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).FinishBlockers);
        Assert.Equal(ShiftStatus.PendingReview, Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default)).Status);
    }

    [Fact]
    public async Task NotGivenWithoutAReason_IsRefused_LikeEveryNonAdministeredOutcome()
    {
        var f = Create();
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, MedicationAdministrationStatus.Missed), default);

        Assert.Equal(400, Status(result));
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task APrnDose_NeedsNoSlot_ButItsReason()
    {
        var f = Create();
        var prn = AddMed(f, "Paracetamol", type: MedicationType.Prn);

        var ok = await f.Controller.RecordShiftDose(f.Shift.Id, prn.Id,
            new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, PrnReason = "Headache" }, default);
        var noReason = await f.Controller.RecordShiftDose(f.Shift.Id, prn.Id,
            new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered }, default);

        Assert.Equal(200, Status(ok));
        Assert.Null(Body(ok).Data!.ScheduledAt);
        Assert.Equal(400, Status(noReason));   // the PRN reason rule from the general recorder applies here too
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    // ── idempotency and one record per slot ──

    [Fact]
    public async Task ADoubleTap_WithTheSameKey_IsSafe_OneRecord()
    {
        var f = Create();
        var med = AddMed(f);

        var first = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);
        var second = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);

        Assert.Equal(200, Status(first));
        Assert.Equal(200, Status(second));
        Assert.Equal(Body(first).Data!.Id, Body(second).Data!.Id);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task AnotherWorkersRecordForTheSameSlot_Is409_WithTheExistingRecordAsData()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "mine"), default);

        var second = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, MedicationAdministrationStatus.Refused, key: "other-device", reason: "declined"), default);

        Assert.Equal(409, Status(second));
        Assert.Equal(MedicationErrorCodes.AdministrationAlreadyRecorded, Body(second).Code);
        Assert.Equal(MedicationAdministrationStatus.Administered, Body(second).Data!.Status);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    // ── scoping (D2) ──

    [Fact]
    public async Task OnlyWhileTheShiftIsInProgress()
    {
        foreach (var (status, code) in new[]
                 {
                     (ShiftStatus.Published, ShiftErrorCodes.ShiftNotInProgress), (ShiftStatus.PendingReview, ShiftErrorCodes.ShiftAlreadyFinished),
                     (ShiftStatus.Completed, ShiftErrorCodes.ShiftAlreadyCompleted), (ShiftStatus.Cancelled, ShiftErrorCodes.ShiftCancelled),
                     (ShiftStatus.Draft, ShiftErrorCodes.ShiftNotPublished),
                 })
        {
            var f = Create(status);
            var med = AddMed(f);

            var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

            Assert.Equal(409, Status(result));
            Assert.Equal(code, Body(result).Code);
            Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
        }
    }

    [Fact]
    public async Task AnotherWorkersShift_Is404()
    {
        var f = Create();
        var med = AddMed(f);
        var stranger = f.ControllerFor(f.AddWorker().Id);

        var result = await stranger.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        Assert.Equal(404, Status(result));
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task AMedicationOfAnotherParticipant_Is404_NeverRecordedAgainstTheWrongPerson()
    {
        var f = Create();
        var other = new Participant { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, FirstName = "Mia", LastName = "Chen", IsActive = true };
        f.Db.Participants.Add(other);
        f.Db.SaveChanges();
        var foreignMed = AddMed(f, "NotMine", participantId: other.Id);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, foreignMed.Id, Dose(Nine), default);

        Assert.Equal(404, Status(result));
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task AMedicationFromAnotherTenant_Is404()
    {
        var tenantA = Guid.NewGuid();
        var f = Create(tenantId: tenantA);
        var foreign = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ParticipantId = f.Participant.Id, Name = "Foreign", DoseDescription = "1",
            Type = MedicationType.Regular, TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        f.Db.ParticipantMedications.Add(foreign);
        f.Db.SaveChanges();

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, foreign.Id, Dose(Nine), default);

        Assert.Equal(404, Status(result));
    }

    [Fact]
    public async Task AnInactiveMedication_Is409()
    {
        var f = Create();
        var held = AddMed(f, status: MedicationStatus.OnHold);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, held.Id, Dose(Nine), default);

        Assert.Equal(409, Status(result));
        Assert.Equal(MedicationErrorCodes.MedicationNotActive, Body(result).Code);
    }

    [Theory]
    [InlineData("wrong-time")]
    [InlineData("outside-window")]
    [InlineData("missing")]
    [InlineData("other-day")]
    public async Task AScheduledDose_MustBeOneOfTheWindowsDueSlots_422(string scenario)
    {
        var f = Create();
        var med = AddMed(f, times: "09:00,12:30");
        DateTime? scheduledAt = scenario switch
        {
            "wrong-time" => new DateTime(2026, 7, 14, 9, 30, 0),
            "outside-window" => new DateTime(2026, 7, 14, 8, 0, 0),
            "other-day" => new DateTime(2026, 7, 15, 9, 0, 0),
            _ => null,
        };

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(scheduledAt), default);

        Assert.Equal(422, Status(result));
        Assert.Equal(MedicationErrorCodes.DoseSlotNotDue, Body(result).Code);
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task APrnDose_WithAScheduledTime_Is422()
    {
        var f = Create();
        var prn = AddMed(f, type: MedicationType.Prn);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, prn.Id,
            new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, PrnReason = "x", ScheduledAt = Nine }, default);

        Assert.Equal(422, Status(result));
    }

    [Fact]
    public async Task ASlotSentWithAUtcKind_IsMatchedOnItsWallClock_AndStoredAsProviderLocal()
    {
        var f = Create();
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(DateTime.SpecifyKind(Nine, DateTimeKind.Utc)), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(DateTimeKind.Unspecified, (await f.Db.MedicationAdministrations.SingleAsync()).ScheduledAt!.Value.Kind);
    }

    // ── Medication Competency (D3) ──

    [Fact]
    public async Task WithoutACurrentCredential_Is403_AndNothingIsRecorded()
    {
        var f = Create(workerCompetent: false);
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        Assert.Equal(403, Status(result));
        Assert.Equal("MEDICATION_COMPETENCY_MISSING", Body(result).Code);
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task AnExpiredCredential_Is403WithTheExpiryInTheMessage()
    {
        var f = Create();
        f.Worker.MedicationCompetencyExpiryDate = new DateOnly(2026, 7, 1);
        f.Db.SaveChanges();
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        Assert.Equal(403, Status(result));
        Assert.Equal("MEDICATION_COMPETENCY_EXPIRED", Body(result).Code);
        Assert.Contains("1 Jul 2026", Assert.Single(Body(result).Errors!));
    }

    [Fact]
    public async Task HighRiskNeedsAWitness_AndTheWitnessRuleAppliesOnThePackagePathToo()
    {
        var f = Create();
        var med = AddMed(f, "Insulin", "09:00", highRisk: true);

        var noWitness = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);
        Assert.Equal(400, Status(noWitness));

        var witness = f.AddWorker("Rachel", "Witness");
        var withWitness = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine) with { WitnessStaffId = witness.Id }, default);

        Assert.Equal(200, Status(withWitness));
        Assert.Equal(WitnessStatus.Pending, Body(withWitness).Data!.WitnessStatus);
    }

    // ── the general endpoint is untouched by the package rules ──

    [Fact]
    public async Task TheGeneralEndpoint_StillRecordsForAnyShiftState_ItWasNeverScopedToShifts()
    {
        var f = Create(ShiftStatus.Published);
        var med = AddMed(f);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, f.Worker.Id.ToString())], "Test");
        var general = new MedicationsController(f.Db, f.Tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };

        var result = await general.RecordAdministration(med.Id, Dose(Nine), default);

        Assert.IsType<OkObjectResult>(result.Result);
    }
}
