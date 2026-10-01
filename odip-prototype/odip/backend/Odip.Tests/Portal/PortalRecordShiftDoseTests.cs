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
            Dose(Nine, MedicationAdministrationStatus.Missed, reason: "Participant asleep, could not be woken"), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(MedicationAdministrationStatus.Missed, Body(result).Data!.Status);
        Assert.Equal("Participant asleep, could not be woken", Body(result).Data!.Reason);
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

    [Fact]
    public async Task AMedicationOutsideItsStartAndEndDates_Is422_OnAnOvernightShift_TheCourseIsTestedPerDate()
    {
        // A 22:00 -> 06:00 shift starting 14 Jul touches two dates. A course that ends on the 14th has no dose on the 15th, and one that
        // starts on the 15th has none on the 14th: the window-level query keeps both medications, so the per-date test is what refuses them.
        // 03:30 local on the 15th (17:30Z on the 14th): every slot of the window has come due, so the dose-too-early rule is not in play.
        var f = Create(endsNextDay: true, start: new TimeOnly(22, 0), end: new TimeOnly(6, 0), now: new DateTimeOffset(2026, 7, 14, 17, 30, 0, TimeSpan.Zero));
        var ended = AddMed(f, "Antibiotic", "02:00,22:00");
        ended.EndDate = new DateTime(2026, 7, 14);
        var starting = AddMed(f, "NewMedication", "23:00,02:00");
        starting.StartDate = new DateTime(2026, 7, 15);
        f.Db.SaveChanges();

        var afterTheCourse = await f.Controller.RecordShiftDose(f.Shift.Id, ended.Id, Dose(new DateTime(2026, 7, 15, 2, 0, 0)), default);
        var lastDose = await f.Controller.RecordShiftDose(f.Shift.Id, ended.Id, Dose(new DateTime(2026, 7, 14, 22, 0, 0)), default);
        var beforeTheCourse = await f.Controller.RecordShiftDose(f.Shift.Id, starting.Id, Dose(new DateTime(2026, 7, 14, 23, 0, 0)), default);
        var firstDose = await f.Controller.RecordShiftDose(f.Shift.Id, starting.Id, Dose(new DateTime(2026, 7, 15, 2, 0, 0)), default);

        Assert.Equal(422, Status(afterTheCourse));
        Assert.Equal(MedicationErrorCodes.DoseSlotNotDue, Body(afterTheCourse).Code);
        Assert.Equal(200, Status(lastDose));
        Assert.Equal(422, Status(beforeTheCourse));
        Assert.Equal(MedicationErrorCodes.DoseSlotNotDue, Body(beforeTheCourse).Code);
        Assert.Equal(200, Status(firstDose));
        Assert.Equal(2, await f.Db.MedicationAdministrations.CountAsync());
    }

    // ── a key means one request (independent review finding 8) ──

    [Fact]
    public async Task TheSameKeyForADifferentSlot_IsRefused_NotSilentlyReplayed()
    {
        // A client that generated one key per page (not per sheet) and reused it for two doses: the second used to be "replayed" as the
        // first, so the screen said success while the 12:30 dose was never recorded.
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "page-key"), default);

        var second = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Noon, key: "page-key"), default);

        Assert.Equal(400, Status(second));
        Assert.Equal(MedicationErrorCodes.AdministrationIdempotencyKeyReused, Body(second).Code);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task TheSameKeyForADifferentOutcome_IsRefused_NotSilentlyReplayed()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);

        var changedMind = await f.Controller.RecordShiftDose(
            f.Shift.Id, med.Id, Dose(Nine, MedicationAdministrationStatus.Refused, key: "k1", reason: "declined"), default);

        Assert.Equal(400, Status(changedMind));
        Assert.Equal(MedicationErrorCodes.AdministrationIdempotencyKeyReused, Body(changedMind).Code);
        Assert.Equal(MedicationAdministrationStatus.Administered, (await f.Db.MedicationAdministrations.SingleAsync()).Status);
    }

    [Fact]
    public async Task AnExactRetry_StillReplays_EvenWithADifferentNoteOrDoseText()
    {
        // The key binds the request to (medication, slot, outcome) - not to every free-text field a retry might re-render.
        var f = Create();
        var med = AddMed(f);
        var first = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);

        var retry = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1") with { Notes = "added while retrying" }, default);

        Assert.Equal(200, Status(retry));
        Assert.Equal(Body(first).Data!.Id, Body(retry).Data!.Id);
    }

    // ── every instant is UTC with a Z, on every path (independent review finding 14) ──

    [Fact]
    public async Task ARetryAndA409_ReturnEveryInstantAsUtc_EvenWhenTheStoredValueHasNoKind()
    {
        // A record read back from PostgreSQL has Kind=Unspecified, which would serialise WITHOUT the Z and be parsed in the browser's
        // local zone. The response must carry it as a UTC instant, exactly like a record that was just created.
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);
        var stored = await f.Db.MedicationAdministrations.SingleAsync();
        stored.AdministeredAt = DateTime.SpecifyKind(stored.AdministeredAt!.Value, DateTimeKind.Unspecified);
        stored.CreatedAt = DateTime.SpecifyKind(stored.CreatedAt, DateTimeKind.Unspecified);
        f.Db.SaveChanges();

        var replay = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);
        var conflict = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k2"), default);

        Assert.Equal(200, Status(replay));
        Assert.Equal(409, Status(conflict));
        foreach (var body in new[] { Body(replay), Body(conflict) })
        {
            Assert.Equal(DateTimeKind.Utc, body.Data!.AdministeredAt!.Value.Kind);
            Assert.Equal(DateTimeKind.Utc, body.Data.CreatedAt.Kind);
        }
    }

    // ── Medication Competency (D3) ──

    [Fact]
    public async Task Enforce_WithoutACurrentCredential_Is403_AndNothingIsRecorded()
    {
        var f = Create(workerCompetent: false, competencyMode: MedicationCompetencyMode.Enforce);
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        Assert.Equal(403, Status(result));
        Assert.Equal("MEDICATION_COMPETENCY_MISSING", Body(result).Code);
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task Enforce_AnExpiredCredential_Is403WithTheExpiryInTheMessage()
    {
        var f = Create(competencyMode: MedicationCompetencyMode.Enforce);
        f.Worker.MedicationCompetencyExpiryDate = new DateOnly(2026, 7, 1);
        f.Db.SaveChanges();
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        Assert.Equal(403, Status(result));
        Assert.Equal("MEDICATION_COMPETENCY_EXPIRED", Body(result).Code);
        Assert.Contains("1 Jul 2026", Assert.Single(Body(result).Errors!));
    }

    // ── Warn mode (the default): recorded and flagged ──

    [Fact]
    public async Task Warn_WithoutACurrentCredential_Records_AndTheRecordIsFlagged_OnThePackagePath()
    {
        var f = Create(workerCompetent: false);   // provider mode defaults to Warn
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine, key: "k1"), default);

        Assert.Equal(200, Status(result));
        Assert.True(Body(result).Data!.RecordedWithoutCompetency);
        Assert.True((await f.Db.MedicationAdministrations.SingleAsync()).RecordedWithoutCompetency);
        // The flag travels to the shift detail outcome (and so to the coordinator review).
        var outcome = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).MedicationsDue.Single(s => s.ScheduledAt == Nine).Outcome!;
        Assert.True(outcome.RecordedWithoutCompetency);
    }

    [Fact]
    public async Task Warn_AnExpiredCredential_IsFlagged_ACurrentOneIsNot()
    {
        var expired = Create();
        expired.Worker.MedicationCompetencyExpiryDate = new DateOnly(2026, 7, 13);
        expired.Db.SaveChanges();
        var current = Create();

        var flagged = await expired.Controller.RecordShiftDose(expired.Shift.Id, AddMed(expired).Id, Dose(Nine), default);
        var clean = await current.Controller.RecordShiftDose(current.Shift.Id, AddMed(current).Id, Dose(Nine), default);

        Assert.True(Body(flagged).Data!.RecordedWithoutCompetency);
        Assert.False(Body(clean).Data!.RecordedWithoutCompetency);
    }

    [Fact]
    public async Task TheFlag_IsAPermanentFactAboutTheRecord_NotRecomputedWhenTheCredentialIsRenewedLater()
    {
        var f = Create(workerCompetent: false);
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Nine), default);

        f.Worker.IsMedicationCompetent = true;
        f.Worker.MedicationCompetencyExpiryDate = new DateOnly(2099, 1, 1);
        f.Db.SaveChanges();

        Assert.True((await f.Db.MedicationAdministrations.SingleAsync()).RecordedWithoutCompetency);
        Assert.True(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).MedicationsDue.Single(s => s.ScheduledAt == Nine).Outcome!.RecordedWithoutCompetency);
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
