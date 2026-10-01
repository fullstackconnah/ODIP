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
using Odip.Infrastructure.Services;
using Odip.Tests.Portal;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Medications;

/// <summary>
/// Temporal validation of a recorded dose (422): an ADMINISTERED dose cannot be charted more than 60 minutes before its slot, and a supplied
/// <c>administeredAt</c> must lie between the earliest the dose could have been given (on the portal the earlier of the start of any of the shift's
/// completions and an hour before the rostered start; on the MAR the start of the slot's provider-local day, or an hour before the slot when that is
/// earlier) and now + 15 minutes; a time in the future but within that tolerance is a device clock running fast and is
/// stored as the server's now. Fixture clock: 11:00 on Tue 14 July 2026 in Sydney (01:00Z, AEST = UTC+10); the shift started 09:05 local (13 Jul 23:05Z).
/// </summary>
public class MedicationTemporalValidationTests
{
    private static DateTime Local(int h, int m = 0, int day = 14) => new(2026, 7, day, h, m, 0, DateTimeKind.Unspecified);

    private static ParticipantMedication AddMed(ShiftPackageFixture f, string times = "09:00,12:00,12:01,12:30,15:00", MedicationType type = MedicationType.Regular)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg", DoseDescription = "1 tablet",
            Type = type, TimesOfDay = type == MedicationType.Regular ? times : null, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
            SupportLevel = MedicationSupportLevel.Administer, PrnIndication = type == MedicationType.Prn ? "Pain" : null, PrnMaxDosesPer24h = type == MedicationType.Prn ? 10 : null,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    private static CreateAdministrationDto Dose(
        DateTime? scheduledAt, MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered, DateTime? administeredAt = null) => new()
    {
        ScheduledAt = scheduledAt, Status = status, AdministeredAt = administeredAt, DoseGiven = "1 tablet", AdministeredAtTimeZone = "Australia/Sydney",
        Reason = status == MedicationAdministrationStatus.Administered ? null : "Not given", PrnReason = scheduledAt is null && status == MedicationAdministrationStatus.Administered ? "Headache" : null,
    };

    private static ApiResponse<AdministrationDto> Body(ActionResult<ApiResponse<AdministrationDto>> r) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    private static int Status(ActionResult<ApiResponse<AdministrationDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode!.Value;

    private static DateTime NowUtc(ShiftPackageFixture f) => f.Clock.GetUtcNow().UtcDateTime;

    /// <summary>The existing general endpoint (the MAR modal's), built on the fixture's database, clock and competent worker.</summary>
    private static MedicationsController Mar(ShiftPackageFixture f)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, f.Worker.Id.ToString())], "Test");
        return new MedicationsController(f.Db, f.Tenant.Object, recorder: new MedicationAdministrationRecorder(f.Db, clock: f.Clock))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    // ── an Administered dose cannot be charted more than 60 minutes ahead ──

    [Fact]
    public async Task AnAdministeredDose_MoreThanAnHourBeforeItsSlot_Is422TooEarly_WithAClearMessage_AndNothingIsRecorded()
    {
        var f = Create();   // 11:00 local
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(12, 30)), default);   // 90 minutes ahead

        Assert.Equal(422, Status(result));
        Assert.Equal(MedicationErrorCodes.AdministrationTooEarly, Body(result).Code);
        var message = Assert.Single(Body(result).Errors!);
        Assert.Contains("12:30", message);   // when it is due
        Assert.Contains("11:30", message);   // from when it can be recorded
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task ExactlyAnHourAhead_IsAllowed_AMinuteMoreIsNot()
    {
        var f = Create();
        var med = AddMed(f);

        var onTheLine = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(12, 0)), default);      // 60 minutes ahead: allowed
        var aMinuteTooEarly = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(12, 1)), default);   // 61 minutes ahead

        Assert.Equal(200, Status(onTheLine));
        Assert.Equal(422, Status(aMinuteTooEarly));
        Assert.Equal(MedicationErrorCodes.AdministrationTooEarly, Body(aMinuteTooEarly).Code);
    }

    [Fact]
    public async Task OnlyAnAdministeredDoseIsHeldToTheEarlyRule_ANotGivenOutcomeForALaterSlotIsStillRecordable()
    {
        var f = Create();
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(15, 0), MedicationAdministrationStatus.Missed), default);

        Assert.Equal(200, Status(result));
    }

    [Fact]
    public async Task TheEarlyRule_IsJudgedOnUtcInstants_InTheProvidersZone_NotOnWallClockNumbers()
    {
        // 22:30Z on 13 July is 08:30 on 14 July in Sydney. Slot 09:00 local is 30 minutes ahead (fine); 10:00 local is 90 minutes ahead.
        // Compared as bare wall-clock numbers against the UTC clock, 09:00 would look like a day and a half away.
        var f = Create(now: new DateTimeOffset(2026, 7, 13, 22, 30, 0, TimeSpan.Zero));
        var med = AddMed(f, "09:00,10:00");

        var soon = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0)), default);
        var later = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(10, 0)), default);

        Assert.Equal(200, Status(soon));
        Assert.Equal(422, Status(later));
    }

    [Fact]
    public async Task TheEarlyRule_AppliesOnTheMarPathToo()
    {
        var f = Create();
        var med = AddMed(f);

        var tooEarly = await Mar(f).RecordAdministration(med.Id, Dose(Local(12, 30)), default);
        var fine = await Mar(f).RecordAdministration(med.Id, Dose(Local(9, 0)), default);

        Assert.Equal(422, Status(tooEarly));
        Assert.Equal(MedicationErrorCodes.AdministrationTooEarly, Body(tooEarly).Code);
        Assert.Equal(200, Status(fine));
    }

    [Fact]
    public async Task ThePlainMessage_NamesTheDateWhenTheSlotIsNotToday()
    {
        var f = Create();
        var med = AddMed(f, "09:00");

        var tomorrow = await Mar(f).RecordAdministration(med.Id, Dose(Local(9, 0, day: 15)), default);

        var message = Assert.Single(Body(tomorrow).Errors!);
        Assert.Contains("15 Jul 09:00", message);
        Assert.Contains("15 Jul 08:00", message);
    }

    // ── administeredAt: not in the future, not before the earliest it could have been given ──

    [Fact]
    public async Task AdministeredAt_MoreThanFifteenMinutesInTheFuture_Is422OutOfRange_AndNothingIsRecorded()
    {
        var f = Create();
        var med = AddMed(f);

        var future = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(12, 0), administeredAt: NowUtc(f).AddMinutes(16)), default);

        Assert.Equal(422, Status(future));
        Assert.Equal(MedicationErrorCodes.AdministrationTimeOutOfRange, Body(future).Code);
        Assert.Contains("future", Assert.Single(Body(future).Errors!));
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Theory]
    [InlineData(1)]
    [InlineData(6)]    // the old 5-minute tolerance refused this one: a tablet or PC whose clock is 6 minutes fast could not chart any dose on the MAR
    [InlineData(10)]
    [InlineData(15)]   // exactly on the line
    public async Task AdministeredAt_AFewMinutesAheadOfTheServer_IsADeviceClockRunningFast_SoTheServersNowIsStored(int minutesAhead)
    {
        var f = Create();
        var med = AddMed(f);

        var result = await Mar(f).RecordAdministration(med.Id, Dose(Local(9, 0), administeredAt: NowUtc(f).AddMinutes(minutesAhead)), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(NowUtc(f), Body(result).Data!.AdministeredAt);   // never a time in the future
        Assert.Equal(NowUtc(f), (await f.Db.MedicationAdministrations.SingleAsync()).AdministeredAt);
    }

    [Fact]
    public async Task TheClampAppliesOnThePortalAndToEveryOutcomeThatSuppliesATime()
    {
        var f = Create();
        var med = AddMed(f);

        var given = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: NowUtc(f).AddMinutes(12)), default);
        var refused = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(12, 0), MedicationAdministrationStatus.Refused, administeredAt: NowUtc(f).AddMinutes(12)), default);

        Assert.Equal(200, Status(given));
        Assert.Equal(200, Status(refused));
        Assert.All(await f.Db.MedicationAdministrations.ToListAsync(), a => Assert.Equal(NowUtc(f), a.AdministeredAt));
    }

    [Fact]
    public async Task ATimeThatIsNotInTheFuture_IsStoredAsSupplied_TheClampOnlyTouchesTheFuture()
    {
        var f = Create();
        var med = AddMed(f);
        var earlier = NowUtc(f).AddMinutes(-20);

        var result = await Mar(f).RecordAdministration(med.Id, Dose(Local(9, 0), administeredAt: earlier), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(earlier, Body(result).Data!.AdministeredAt);
    }

    /// <summary>A provider-local (Sydney, AEST = UTC+10) time on 14 July as the UTC instant the API receives.</summary>
    private static DateTime UtcAt(int hour, int minute = 0, int day = 14) => new DateTime(2026, 7, day, hour, minute, 0, DateTimeKind.Utc).AddHours(-10);

    [Fact]
    public async Task OnThePortal_AdministeredAt_CannotBeBeforeTheEarliestTheShiftAllows_AnHourBeforeTheRosteredStart()
    {
        var f = Create();   // rostered 09:00-17:00, started 09:05: the earliest allowed is 08:00 (an hour before the rostered start)
        var med = AddMed(f);

        var before = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: UtcAt(7, 59)), default);
        var exactly = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: UtcAt(8, 0)), default);

        Assert.Equal(422, Status(before));
        Assert.Equal(MedicationErrorCodes.AdministrationTimeOutOfRange, Body(before).Code);
        Assert.Contains("08:00", Assert.Single(Body(before).Errors!));   // provider-local, not UTC
        Assert.Equal(200, Status(exactly));
    }

    // ── the active completion's start is not the bound: a Return and a late Start tap (review 3 finding m2) ──

    private static ShiftCompletion AddCompletion(ShiftPackageFixture f, DateTime startUtc, bool active) => f.Db.ShiftCompletions.Add(new ShiftCompletion
    {
        Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = f.Shift.Id, ActualStart = startUtc, TimeZoneId = "Australia/Sydney",
        SubmittedByUserId = f.Worker.Id, StartedAt = startUtc, IsActive = active,
    }).Entity;

    [Fact]
    public async Task ScenarioA_AfterACoordinatorReturn_TheWorkerRestartsAt1530_AndStillChartsTheDoseGivenAt1005()
    {
        // The 10:00 dose was given at 10:05 but never charted. The coordinator Returns the shift (the completion started at 09:05 is archived and the shift
        // reopened); the worker re-Starts at 15:30, which gives the shift a NEW completion starting at 15:30. The true time must still be accepted: the old
        // bound (the active completion's start, 15:30) refused it and left only a false 15:30.
        var f = Create();
        var med = AddMed(f, "10:00");
        f.Completion!.IsActive = false;
        AddCompletion(f, UtcAt(15, 30), active: true);
        f.Db.SaveChanges();
        f.Clock.Set(new DateTimeOffset(UtcAt(15, 35), TimeSpan.Zero));

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(10, 0), administeredAt: UtcAt(10, 5)), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(UtcAt(10, 5), Body(result).Data!.AdministeredAt);   // the real time, not 15:30
    }

    [Fact]
    public async Task ScenarioB_TheWorkerGaveTheDoseOnArrival_TappedStartAt0910_AndChartsItAt0912WithTheTrue0905()
    {
        var f = Create();
        var med = AddMed(f, "09:00");
        f.Completion!.ActualStart = UtcAt(9, 10);
        f.Completion.StartedAt = UtcAt(9, 10);
        f.Db.SaveChanges();
        f.Clock.Set(new DateTimeOffset(UtcAt(9, 12), TimeSpan.Zero));

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: UtcAt(9, 5)), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(UtcAt(9, 5), Body(result).Data!.AdministeredAt);
    }

    [Fact]
    public async Task AWorkerWhoStartedEarly_KeepsThatEarlyStartAsTheBound_EvenAfterAReturnAndARestart()
    {
        // The first completion started at 07:30, more than an hour before the rostered start, and was archived by a Return; the restart is at 15:30. The earliest
        // of the completions' starts (07:30) is the bound, so a dose given at 07:45 is accepted and one given at 07:29 is not.
        var f = Create();
        var med = AddMed(f, "09:00");
        f.Completion!.ActualStart = UtcAt(7, 30);
        f.Completion.IsActive = false;
        AddCompletion(f, UtcAt(15, 30), active: true);
        f.Db.SaveChanges();
        f.Clock.Set(new DateTimeOffset(UtcAt(15, 35), TimeSpan.Zero));

        var tooEarly = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: UtcAt(7, 29)), default);
        var fine = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: UtcAt(7, 45)), default);

        Assert.Equal(422, Status(tooEarly));
        Assert.Contains("07:30", Assert.Single(Body(tooEarly).Errors!));
        Assert.Equal(200, Status(fine));
    }

    [Fact]
    public async Task OnThePortal_TheFutureBoundIsUnchanged_AndAnEarlyBoundDoesNotLetAFutureTimeThrough()
    {
        var f = Create();
        var med = AddMed(f);

        var future = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: NowUtc(f).AddMinutes(16)), default);

        Assert.Equal(422, Status(future));
        Assert.Contains("future", Assert.Single(Body(future).Errors!));
    }

    [Fact]
    public async Task OnThePortal_APrnDoseIsBoundedBelowByTheShiftStartToo()
    {
        var f = Create();
        var prn = AddMed(f, type: MedicationType.Prn);

        var before = await f.Controller.RecordShiftDose(f.Shift.Id, prn.Id, Dose(null, administeredAt: ActualStartUtc.AddHours(-2)), default);
        var during = await f.Controller.RecordShiftDose(f.Shift.Id, prn.Id, Dose(null, administeredAt: ActualStartUtc.AddHours(1)), default);

        Assert.Equal(422, Status(before));
        Assert.Equal(200, Status(during));
    }

    [Fact]
    public async Task AnUnsuffixedAdministeredAt_IsTreatedAsUtc_LikeEverywhereElseInThePackage()
    {
        var f = Create();
        var med = AddMed(f);
        // Twenty minutes ahead of the clock, written WITHOUT a zone: read as UTC (like every other unsuffixed instant in the package), so it is
        // beyond the 15-minute tolerance. Read as provider-local it would be hours in the past and slip through.
        var twentyAhead = DateTime.SpecifyKind(NowUtc(f).AddMinutes(20), DateTimeKind.Unspecified);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0), administeredAt: twentyAhead), default);

        Assert.Equal(422, Status(result));
    }

    [Fact]
    public async Task AnAbsentAdministeredAt_IsNeverRejected_TheServerStampsNow()
    {
        var f = Create();
        var med = AddMed(f);

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(Local(9, 0)), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(NowUtc(f), Body(result).Data!.AdministeredAt);
    }

    // ── the MAR path: bounded below by the start of the slot's provider-local day ──

    [Fact]
    public async Task OnTheMar_AScheduledDosesAdministeredAt_CannotBeBeforeTheStartOfTheSlotsDay()
    {
        var f = Create();
        var med = AddMed(f, "08:00");
        // The slot's day starts 14 Jul 00:00 Sydney = 13 Jul 14:00Z.
        var dayStart = new DateTime(2026, 7, 13, 14, 0, 0, DateTimeKind.Utc);

        var before = await Mar(f).RecordAdministration(med.Id, Dose(Local(8, 0), administeredAt: dayStart.AddMinutes(-1)), default);
        var onTheMinute = await Mar(f).RecordAdministration(med.Id, Dose(Local(8, 0), administeredAt: dayStart), default);

        Assert.Equal(422, Status(before));
        Assert.Equal(MedicationErrorCodes.AdministrationTimeOutOfRange, Body(before).Code);
        Assert.Contains("start of 14 Jul", Assert.Single(Body(before).Errors!));
        Assert.Equal(200, Status(onTheMinute));
    }

    // ── a slot in the first hour after midnight: the early window reaches into the previous day (review 3 finding m1) ──

    /// <summary>A fixture whose clock is the given Sydney wall-clock time (AEST = UTC+10), by default on the evening of Mon 13 July.</summary>
    private static ShiftPackageFixture CreateAtLocal(int hour, int minute, int day = 13) =>
        Create(now: new DateTimeOffset(2026, 7, day, hour, minute, 0, TimeSpan.FromHours(10)));

    [Fact]
    public async Task OnTheMar_AMidnightSlot_ChartedAt2345TheDayBefore_Is200_AndAt2259Is422TooEarly()
    {
        // The slot is 00:30 on Tue 14 July. 23:45 on the 13th is 45 minutes early: inside the 60-minute window, and the time it was given
        // (23:45, the previous day) must not then be refused for being before the start of the slot's day.
        var fine = CreateAtLocal(23, 45);
        var med = AddMed(fine, "00:30");
        var tooEarly = CreateAtLocal(22, 59);   // 91 minutes before the slot
        var earlyMed = AddMed(tooEarly, "00:30");

        var charted = await Mar(fine).RecordAdministration(med.Id, Dose(Local(0, 30), administeredAt: NowUtc(fine)), default);
        var refused = await Mar(tooEarly).RecordAdministration(earlyMed.Id, Dose(Local(0, 30), administeredAt: NowUtc(tooEarly)), default);

        Assert.Equal(200, Status(charted));
        Assert.Equal(NowUtc(fine), Body(charted).Data!.AdministeredAt);   // charted at 23:45, not "00:01"
        Assert.Equal(422, Status(refused));
        Assert.Equal(MedicationErrorCodes.AdministrationTooEarly, Body(refused).Code);
    }

    [Theory]
    [InlineData(0, 0, 23, 0)]    // a 00:00 slot: the window opens at 23:00 the day before
    [InlineData(0, 30, 23, 30)]
    [InlineData(0, 59, 23, 59)]
    public async Task OnTheMar_TheWindowOpensAnHourBeforeAMidnightSlot_AndNotBefore(int slotHour, int slotMinute, int boundHour, int boundMinute)
    {
        var f = CreateAtLocal(boundHour, boundMinute);   // the clock is exactly at the earliest allowed time
        var med = AddMed(f, $"{slotHour:00}:{slotMinute:00}");

        // on the line: allowed (the early rule allows exactly 60 minutes, and so does the lower bound)
        var onTheLine = await Mar(f).RecordAdministration(med.Id, Dose(Local(slotHour, slotMinute), administeredAt: NowUtc(f)), default);
        // a minute before the window: the clock a minute earlier is outside the early window, and a supplied time a minute before the bound is out of range
        var beforeTheWindow = await Mar(f).RecordAdministration(
            med.Id, Dose(Local(slotHour, slotMinute), MedicationAdministrationStatus.Refused, administeredAt: NowUtc(f).AddMinutes(-1)), default);

        Assert.Equal(200, Status(onTheLine));
        Assert.Equal(422, Status(beforeTheWindow));
        Assert.Equal(MedicationErrorCodes.AdministrationTimeOutOfRange, Body(beforeTheWindow).Code);
        Assert.Contains($"{boundHour:00}:{boundMinute:00}", Assert.Single(Body(beforeTheWindow).Errors!));   // names the bound, provider-local
    }

    [Fact]
    public async Task OnTheMar_ASlotFurtherIntoTheDay_StillHasTheStartOfItsDayAsTheBound()
    {
        // A 01:30 slot: an hour before it is 00:30, which is not before the start of the day, so the day start (00:00) stays the bound.
        var f = CreateAtLocal(1, 0, day: 14);   // 01:00 on the 14th, half an hour before the slot
        var med = AddMed(f, "01:30");
        var dayStart = new DateTime(2026, 7, 13, 14, 0, 0, DateTimeKind.Utc);   // 14 Jul 00:00 Sydney

        var beforeDayStart = await Mar(f).RecordAdministration(med.Id, Dose(Local(1, 30), MedicationAdministrationStatus.Missed, administeredAt: dayStart.AddMinutes(-1)), default);
        var onDayStart = await Mar(f).RecordAdministration(med.Id, Dose(Local(1, 30), MedicationAdministrationStatus.Refused, administeredAt: dayStart), default);

        Assert.Equal(422, Status(beforeDayStart));
        Assert.Contains("start of 14 Jul", Assert.Single(Body(beforeDayStart).Errors!));
        Assert.Equal(200, Status(onDayStart));
    }

    [Fact]
    public async Task OnTheMar_APrnDoseHasNoSlotToAnchorTo_SoOnlyTheFutureBoundApplies()
    {
        var f = Create();
        var prn = AddMed(f, type: MedicationType.Prn);

        var threeDaysAgo = await Mar(f).RecordAdministration(prn.Id, Dose(null, administeredAt: NowUtc(f).AddDays(-3)), default);
        var future = await Mar(f).RecordAdministration(prn.Id, Dose(null, administeredAt: NowUtc(f).AddMinutes(20)), default);

        Assert.Equal(200, Status(threeDaysAgo));
        Assert.Equal(422, Status(future));
    }

    // ── interplay ──

    [Fact]
    public async Task ARetryOfARecordedDose_IsStillAReplay_EvenOnceItsTimeHasBecomeTheFuturePast()
    {
        // The replay check comes before the temporal rules: a retry is the same request, whose outcome is already recorded.
        var f = Create();
        var med = AddMed(f);
        var first = Body(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, WithKey(Dose(Local(9, 0)), "k1"), default)).Data!;

        f.Advance(TimeSpan.FromHours(5));
        var retry = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, WithKey(Dose(Local(9, 0)), "k1"), default);

        Assert.Equal(200, Status(retry));
        Assert.Equal(first.Id, Body(retry).Data!.Id);
    }

    private static CreateAdministrationDto WithKey(CreateAdministrationDto dto, string key) => dto with { IdempotencyKey = key };
}
