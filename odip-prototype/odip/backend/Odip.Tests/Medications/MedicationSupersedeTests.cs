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
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Services;
using Odip.Tests.Portal;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Medications;

/// <summary>
/// One ACTIVE record per scheduled dose slot, with one exception: a record saying the dose WAS given (Administered, or WrongMedication)
/// supersedes active records saying it was NOT (Refused, Withheld, Missed): the participant refused at 09:00 and took it at 09:40; a dose
/// recorded Missed was in fact given. The earlier records are kept as history, linked and audited. A record saying a dose was given is never
/// superseded here (an Administered record closes the slot; a WrongMedication record is an incident that stays on the MAR): only the
/// coordinator amend path changes it. A not-given outcome never replaces another record.
/// </summary>
public class MedicationSupersedeTests
{
    private static readonly DateTime Nine = new(2026, 7, 14, 9, 0, 0, DateTimeKind.Unspecified);
    private static readonly DateTime TwelveThirty = new(2026, 7, 14, 12, 30, 0, DateTimeKind.Unspecified);

    private static ParticipantMedication AddMed(ShiftPackageFixture f, string times = "09:00")
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg",
            DoseDescription = "1 tablet", Type = MedicationType.Regular, TimesOfDay = times, StartDate = new DateTime(2026, 1, 1),
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    private static CreateAdministrationDto Dose(
        MedicationAdministrationStatus status, string? key = null, string? reason = null, string? notes = null, DateTime? slot = null,
        DateTime? administeredAt = null) => new()
    {
        ScheduledAt = slot ?? Nine, Status = status, IdempotencyKey = key, Reason = reason, Notes = notes, DoseGiven = "1 tablet",
        AdministeredAtTimeZone = "Australia/Sydney", AdministeredAt = administeredAt,
    };

    private const string AsleepReason = "Asleep, could not be woken";

    private static CreateAdministrationDto Missed(string? key = null, DateTime? slot = null) =>
        Dose(MedicationAdministrationStatus.Missed, key, AsleepReason, slot: slot);
    private static CreateAdministrationDto Given(string? key = null, DateTime? slot = null, DateTime? administeredAt = null) =>
        Dose(MedicationAdministrationStatus.Administered, key, slot: slot, administeredAt: administeredAt);

    private static ApiResponse<AdministrationDto> Body(ActionResult<ApiResponse<AdministrationDto>> r) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    private static int Status(ActionResult<ApiResponse<AdministrationDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode!.Value;

    /// <summary>
    /// A second worker with their own InProgress shift for the same participant (competent, so any mode lets them record). By default the
    /// same 09:00-17:00 window started at the same time; pass a window and an actual start for a later, overlapping shift.
    /// </summary>
    private static (PortalController Controller, Guid ShiftId, User Worker) CoverWorker(
        ShiftPackageFixture f, TimeOnly? start = null, TimeOnly? end = null, DateTime? actualStartUtc = null)
    {
        var cover = f.AddWorker("Cover", "Worker");
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, UserId = cover.Id, ServiceDate = ServiceDate,
            StartTime = start ?? new TimeOnly(9, 0), EndTime = end ?? new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            Status = ShiftStatus.InProgress,
        };
        f.Db.Shifts.Add(shift);
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = shift.Id, ActualStart = actualStartUtc ?? ActualStartUtc, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = cover.Id, StartedAt = actualStartUtc ?? ActualStartUtc, IsActive = true,
        });
        f.Db.SaveChanges();
        return (f.ControllerFor(cover.Id), shift.Id, cover);
    }

    // ── the supersede ──

    [Fact]
    public async Task ALaterAdministered_SupersedesAnEarlierMissed_AndTheEarlierRecordStaysAsHistory()
    {
        var f = Create();
        var med = AddMed(f);
        Assert.Equal(200, Status(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed(), default)));
        var (cover, coverShiftId, coverWorker) = CoverWorker(f);

        var result = await cover.RecordShiftDose(coverShiftId, med.Id, Given("k-cover"), default);

        Assert.Equal(200, Status(result));
        var record = Body(result).Data!;
        Assert.Equal(MedicationAdministrationStatus.Administered, record.Status);
        Assert.Equal(coverWorker.Id, record.RecordedByUserId);
        Assert.Null(record.SupersededByAdministrationId);   // the new record is the active one
        var all = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Equal(2, all.Count);   // nothing was deleted or overwritten
        var earlier = all.Single(a => a.Status == MedicationAdministrationStatus.Missed);
        Assert.Equal(record.Id, earlier.SupersededByAdministrationId);
        Assert.Equal(AsleepReason, earlier.Reason);   // the history is intact
        Assert.Null(all.Single(a => a.Status == MedicationAdministrationStatus.Administered).SupersededByAdministrationId);
    }

    [Fact]
    public async Task ALaterAdministered_SupersedesAnEarlierRefused_TheParticipantRefusedThenTookIt()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(MedicationAdministrationStatus.Refused, reason: "Declined at 09:00"), default);

        // The same worker, later in the shift: the participant took it at 09:40.
        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given(), default);

        Assert.Equal(200, Status(result));
        var all = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Equal(Body(result).Data!.Id, all.Single(a => a.Status == MedicationAdministrationStatus.Refused).SupersededByAdministrationId);
    }

    [Fact]
    public async Task TheSlotReadsTheActiveRecordEverywhere_TheDetailTheReviewAndTheMar_NeverTheSupersededOne()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed(), default);
        var (cover, coverShiftId, _) = CoverWorker(f);
        await cover.RecordShiftDose(coverShiftId, med.Id, Given(), default);

        var detail = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));
        var slot = Assert.Single(detail.MedicationsDue);
        Assert.Equal(MedicationAdministrationStatus.Administered, slot.Outcome!.Status);
        Assert.Equal(PortalDoseState.Recorded, slot.State);

        var mar = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(
            (await new MedicationsController(f.Db, f.Tenant.Object).GetMar(new DateOnly(2026, 7, 14), f.Participant.Id, default)).Result).Value).Data!;
        Assert.Equal(MedicationAdministrationStatus.Administered, Assert.Single(mar.Entries).Administration!.Status);
    }

    [Fact]
    public async Task TheHistoryLists_KeepBothRecords_WithTheLinkOnTheSupersededOne()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed(), default);
        var (cover, coverShiftId, _) = CoverWorker(f);
        var replacement = Body(await cover.RecordShiftDose(coverShiftId, med.Id, Given(), default)).Data!;

        var history = Assert.IsType<ApiResponse<List<AdministrationDto>>>(Assert.IsType<OkObjectResult>(
            (await new MedicationsController(f.Db, f.Tenant.Object).GetParticipantAdministrations(f.Participant.Id, null, null, default)).Result).Value).Data!;

        Assert.Equal(2, history.Count);
        Assert.Equal(replacement.Id, history.Single(a => a.Status == MedicationAdministrationStatus.Missed).SupersededByAdministrationId);
        Assert.Null(history.Single(a => a.Status == MedicationAdministrationStatus.Administered).SupersededByAdministrationId);
    }

    [Fact]
    public async Task TheSupersedeIsAudited_TheEarlierRecordShowsAnUpdate_TheNewOneACreate()
    {
        var f = Create(withAuditing: true);
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed(), default);
        var (cover, coverShiftId, _) = CoverWorker(f);

        var replacement = Body(await cover.RecordShiftDose(coverShiftId, med.Id, Given(), default)).Data!;

        var earlierId = (await f.Db.MedicationAdministrations.SingleAsync(a => a.Status == MedicationAdministrationStatus.Missed)).Id;
        var earlierActions = await f.Db.AuditLogs.Where(a => a.EntityType == nameof(MedicationAdministration) && a.EntityId == earlierId).Select(a => a.Action).ToListAsync();
        var newActions = await f.Db.AuditLogs.Where(a => a.EntityType == nameof(MedicationAdministration) && a.EntityId == replacement.Id).Select(a => a.Action).ToListAsync();
        Assert.Contains(AuditAction.Created, earlierActions);
        Assert.Contains(AuditAction.Updated, earlierActions);   // the link to its replacement
        Assert.Contains(AuditAction.Created, newActions);
        Assert.Contains(typeof(MedicationAdministration), AuditedEntities.Types);
    }

    // ── what can NOT be superseded ──

    [Theory]
    [InlineData(MedicationAdministrationStatus.Administered)]
    [InlineData(MedicationAdministrationStatus.Refused)]
    [InlineData(MedicationAdministrationStatus.Missed)]
    [InlineData(MedicationAdministrationStatus.Withheld)]
    [InlineData(MedicationAdministrationStatus.WrongMedication)]
    public async Task AnAdministeredRecord_IsNeverSuperseded_AnyOtherOutcomeIs409WithTheExistingRecord(MedicationAdministrationStatus later)
    {
        var f = Create();
        var med = AddMed(f);
        var first = Body(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given("k1"), default)).Data!;
        var (cover, coverShiftId, _) = CoverWorker(f);

        var result = await cover.RecordShiftDose(coverShiftId, med.Id, Dose(later, "k2", "a reason", notes: "gave the 250mg by mistake"), default);

        Assert.Equal(409, Status(result));
        Assert.Equal(MedicationErrorCodes.AdministrationAlreadyRecorded, Body(result).Code);
        Assert.Equal(first.Id, Body(result).Data!.Id);
        var all = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Single(all);
        Assert.Null(all[0].SupersededByAdministrationId);
    }

    [Theory]
    [InlineData(MedicationAdministrationStatus.Administered)]
    [InlineData(MedicationAdministrationStatus.WrongMedication)]
    public async Task AWrongMedicationRecord_IsNeverSuperseded_ItIsAnIncidentThatStaysVisibleOnTheMar(MedicationAdministrationStatus later)
    {
        var f = Create();
        var med = AddMed(f);
        var first = Body(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id,
            Dose(MedicationAdministrationStatus.WrongMedication, "k1", "gave the wrong tablet", notes: "gave the 250mg by mistake"), default)).Data!;
        var (cover, coverShiftId, _) = CoverWorker(f);

        var result = await cover.RecordShiftDose(coverShiftId, med.Id, Dose(later, "k2", "another reason", notes: "another note"), default);

        Assert.Equal(409, Status(result));
        Assert.Equal(first.Id, Body(result).Data!.Id);
        var only = Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
        Assert.Null(only.SupersededByAdministrationId);
    }

    // ── what CAN be superseded: a record saying the dose was NOT given, by one saying it WAS ──

    [Theory]
    [InlineData(MedicationAdministrationStatus.Missed)]
    [InlineData(MedicationAdministrationStatus.Refused)]
    [InlineData(MedicationAdministrationStatus.Withheld)]
    public async Task AnAdministeredRecord_SupersedesAnyNotGivenOutcome_Missed_Refused_OrWithheld(MedicationAdministrationStatus earlier)
    {
        var f = Create();
        var med = AddMed(f);
        Assert.Equal(200, Status(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(earlier, "k1", "reason on file"), default)));

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given("k2"), default);

        Assert.Equal(200, Status(result));
        var all = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Equal(2, all.Count);   // nothing deleted
        var old = all.Single(a => a.Status == earlier);
        Assert.Equal(Body(result).Data!.Id, old.SupersededByAdministrationId);
        Assert.Equal("reason on file", old.Reason);   // the history is intact
    }

    [Theory]
    [InlineData(MedicationAdministrationStatus.Missed)]
    [InlineData(MedicationAdministrationStatus.Refused)]
    [InlineData(MedicationAdministrationStatus.Withheld)]
    public async Task AWrongMedicationRecord_AlsoSupersedesANotGivenOutcome_AndThenStaysTheActiveRecord(MedicationAdministrationStatus earlier)
    {
        // Recorded as not given, then it turns out something else was given instead: the incident record replaces it and is what the slot reads.
        var f = Create();
        var med = AddMed(f);
        Assert.Equal(200, Status(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(earlier, "k1", "reason on file"), default)));

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id,
            Dose(MedicationAdministrationStatus.WrongMedication, "k2", "wrong tablet given", notes: "gave the 250mg"), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(Body(result).Data!.Id, (await f.Db.MedicationAdministrations.SingleAsync(a => a.Status == earlier)).SupersededByAdministrationId);
        var slot = Assert.Single(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).MedicationsDue);
        Assert.Equal(MedicationAdministrationStatus.WrongMedication, slot.Outcome!.Status);
    }

    [Fact]
    public async Task ScenarioA_TheFirstWorkerRecordedMissed_TheNextWorkerGivesTheDoseAt1305_AndItIsCharted()
    {
        // Worker 1 (09:00-13:00): at 12:55 the 12:30 dose has not been given (the participant was asleep) and Finish needs an outcome, so it is
        // recorded Missed. Worker 2 (12:30-20:00) starts at 13:00, the participant is awake, and the dose is given at 13:05. Before this rule
        // worker 2 got a 409, the MAR said Missed for a dose that WAS given, and the next worker could give it again.
        var f = Create(start: new TimeOnly(9, 0), end: new TimeOnly(13, 0), now: Utc(2026, 7, 14, 2, 55));   // 12:55 local
        var med = AddMed(f, "12:30");
        Assert.Equal(200, Status(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed("k-w1", TwelveThirty), default)));
        f.Advance(TimeSpan.FromMinutes(5));   // 13:00: worker 1 finishes (the dose has its outcome) and worker 2 starts
        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true, NothingToHandOver = true }, default));
        var (w2, w2ShiftId, worker2) = CoverWorker(f, new TimeOnly(12, 30), new TimeOnly(20, 0), Utc(2026, 7, 14, 3, 0).UtcDateTime);
        f.Advance(TimeSpan.FromMinutes(5));   // 13:05

        var result = await w2.RecordShiftDose(w2ShiftId, med.Id, Given("k-w2", TwelveThirty, Utc(2026, 7, 14, 3, 5).UtcDateTime), default);

        Assert.Equal(200, Status(result));
        var given = Body(result).Data!;
        Assert.Equal(MedicationAdministrationStatus.Administered, given.Status);
        Assert.Equal(worker2.Id, given.RecordedByUserId);
        var all = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Equal(2, all.Count);
        var missed = all.Single(a => a.Status == MedicationAdministrationStatus.Missed);
        Assert.Equal(given.Id, missed.SupersededByAdministrationId);   // worker 1's record is history, not deleted
        Assert.Equal(f.Worker.Id, missed.RecordedByUserId);
        var slot = Assert.Single(Detail(await w2.GetShiftDetail(w2ShiftId, default)).MedicationsDue);
        Assert.Equal(MedicationAdministrationStatus.Administered, slot.Outcome!.Status);   // the slot reads the dose that was given
        // And the slot is now closed: a third attempt (worker 1 on a second device, say) is the 409 with the Administered record, so nobody doubles it.
        var third = await w2.RecordShiftDose(w2ShiftId, med.Id, Given("k-third", TwelveThirty, Utc(2026, 7, 14, 3, 5).UtcDateTime), default);
        Assert.Equal(409, Status(third));
        Assert.Equal(given.Id, Body(third).Data!.Id);
    }

    [Fact]
    public async Task ScenarioB_TheParticipantRefusedAt0900AndTookTheDoseAt0940_BothRecordsAreKept_AndTheSlotReadsAdministered()
    {
        var f = Create(now: Utc(2026, 7, 13, 23, 10));   // 09:10 local; the shift started at 09:05
        var med = AddMed(f, "09:00");
        var refused = Body(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(MedicationAdministrationStatus.Refused, "k-refused", "Declined it"), default)).Data!;
        f.Advance(TimeSpan.FromMinutes(30));   // 09:40

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given("k-given", administeredAt: Utc(2026, 7, 13, 23, 40).UtcDateTime), default);

        Assert.Equal(200, Status(result));
        var given = Body(result).Data!;
        Assert.Equal(MedicationAdministrationStatus.Administered, given.Status);
        var all = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Equal(2, all.Count);
        Assert.Equal(given.Id, all.Single(a => a.Id == refused.Id).SupersededByAdministrationId);
        Assert.Equal("Declined it", all.Single(a => a.Id == refused.Id).Reason);
        var slot = Assert.Single(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).MedicationsDue);
        Assert.Equal(MedicationAdministrationStatus.Administered, slot.Outcome!.Status);
        Assert.Equal(given.Id, slot.Outcome.AdministrationId);
    }

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute) => new(year, month, day, hour, minute, 0, TimeSpan.Zero);

    // ── what a not-given outcome can NOT do ──

    [Fact]
    public async Task ANotGivenOutcome_NeverReplacesAnotherRecord_EveryCombinationIs409()
    {
        var notGiven = new[] { MedicationAdministrationStatus.Missed, MedicationAdministrationStatus.Refused, MedicationAdministrationStatus.Withheld };
        foreach (var first in notGiven)
        foreach (var later in notGiven)
        {
            var f = Create();
            var med = AddMed(f);
            Assert.Equal(200, Status(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(first, "k1", "first reason"), default)));
            var (cover, coverShiftId, _) = CoverWorker(f);

            var result = await cover.RecordShiftDose(coverShiftId, med.Id, Dose(later, "k2", "another reason"), default);

            Assert.True(Status(result) == 409, $"{first} then {later} should be 409");
            Assert.Null(Assert.Single(await f.Db.MedicationAdministrations.ToListAsync()).SupersededByAdministrationId);
        }
    }

    [Fact]
    public async Task OnceSuperseded_TheSlotHasOneActiveRecord_AFurtherAdministeredIs409()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed(), default);
        var (cover, coverShiftId, _) = CoverWorker(f);
        var replacement = Body(await cover.RecordShiftDose(coverShiftId, med.Id, Given("k-first"), default)).Data!;

        var again = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given("k-second"), default);

        Assert.Equal(409, Status(again));
        Assert.Equal(replacement.Id, Body(again).Data!.Id);   // the 409 carries the ACTIVE record, not the superseded one
        Assert.Equal(2, await f.Db.MedicationAdministrations.CountAsync());
    }

    // ── retries and the other paths ──

    [Fact]
    public async Task ARetryOfTheSupersedingRequest_WithTheSameKey_IsAReplay_NotASecondSupersede()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed(), default);
        var (cover, coverShiftId, _) = CoverWorker(f);
        var first = Body(await cover.RecordShiftDose(coverShiftId, med.Id, Given("k-cover"), default)).Data!;

        var retry = await cover.RecordShiftDose(coverShiftId, med.Id, Given("k-cover"), default);

        Assert.Equal(200, Status(retry));
        Assert.Equal(first.Id, Body(retry).Data!.Id);
        Assert.Equal(2, await f.Db.MedicationAdministrations.CountAsync());
        Assert.Equal(1, await f.Db.MedicationAdministrations.CountAsync(a => a.SupersededByAdministrationId == first.Id));
    }

    [Fact]
    public async Task TheExistingMarPath_SupersedesToo_ItIsTheSameRecorder()
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed(), default);
        var coordinator = f.AddWorker("Coordinator", "Person");
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, coordinator.Id.ToString())], "Test");
        var mar = new MedicationsController(f.Db, f.Tenant.Object, recorder: new MedicationAdministrationRecorder(f.Db, clock: f.Clock))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };

        var result = await mar.RecordAdministration(med.Id, Given(), default);

        var record = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(record.Id, (await f.Db.MedicationAdministrations.SingleAsync(a => a.Status == MedicationAdministrationStatus.Missed)).SupersededByAdministrationId);
    }

    [Fact]
    public async Task LegacyDuplicates_AllNotGiven_AreAllSupersededByTheAdministeredRecord()
    {
        var f = Create();
        var med = AddMed(f);
        f.Db.MedicationAdministrations.AddRange(
            Legacy(f, med, MedicationAdministrationStatus.Refused, new DateTime(2026, 7, 14, 0, 30, 0, DateTimeKind.Utc)),
            Legacy(f, med, MedicationAdministrationStatus.Withheld, new DateTime(2026, 7, 14, 0, 35, 0, DateTimeKind.Utc)),
            Legacy(f, med, MedicationAdministrationStatus.Missed, new DateTime(2026, 7, 14, 0, 40, 0, DateTimeKind.Utc)));
        f.Db.SaveChanges();

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given(), default);

        Assert.Equal(200, Status(result));
        var id = Body(result).Data!.Id;
        Assert.Equal(3, await f.Db.MedicationAdministrations.CountAsync(a => a.SupersededByAdministrationId == id));
    }

    [Fact]
    public async Task LegacyDuplicates_WithAnAdministeredOneAmongThem_BlockTheSupersede()
    {
        var f = Create();
        var med = AddMed(f);
        f.Db.MedicationAdministrations.AddRange(
            Legacy(f, med, MedicationAdministrationStatus.Administered, new DateTime(2026, 7, 14, 0, 30, 0, DateTimeKind.Utc)),
            Legacy(f, med, MedicationAdministrationStatus.Missed, new DateTime(2026, 7, 14, 0, 40, 0, DateTimeKind.Utc)));
        f.Db.SaveChanges();

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given(), default);

        Assert.Equal(409, Status(result));
        Assert.Equal(2, await f.Db.MedicationAdministrations.CountAsync());
    }

    [Fact]
    public async Task LegacyDuplicates_WithAWrongMedicationOneAmongThem_AlsoBlockTheSupersede_TheIncidentStaysActive()
    {
        var f = Create();
        var med = AddMed(f);
        f.Db.MedicationAdministrations.AddRange(
            Legacy(f, med, MedicationAdministrationStatus.WrongMedication, new DateTime(2026, 7, 14, 0, 30, 0, DateTimeKind.Utc)),
            Legacy(f, med, MedicationAdministrationStatus.Missed, new DateTime(2026, 7, 14, 0, 40, 0, DateTimeKind.Utc)));
        f.Db.SaveChanges();

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given(), default);

        Assert.Equal(409, Status(result));
        Assert.Equal(2, await f.Db.MedicationAdministrations.CountAsync());
        Assert.Equal(0, await f.Db.MedicationAdministrations.CountAsync(a => a.SupersededByAdministrationId != null));
    }

    [Fact]
    public async Task TheSlotService_ReadsTheActiveRecord_EvenWhenTheSupersededOneHasTheNewerCreatedAt()
    {
        var f = Create();
        var med = AddMed(f);
        var active = Legacy(f, med, MedicationAdministrationStatus.Administered, new DateTime(2026, 7, 14, 0, 30, 0, DateTimeKind.Utc));
        var superseded = Legacy(f, med, MedicationAdministrationStatus.Missed, new DateTime(2026, 7, 14, 0, 50, 0, DateTimeKind.Utc));
        superseded.SupersededByAdministrationId = active.Id;
        f.Db.MedicationAdministrations.AddRange(active, superseded);
        f.Db.SaveChanges();

        var slot = Assert.Single(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).MedicationsDue);

        Assert.Equal(active.Id, slot.Outcome!.AdministrationId);   // "newest wins" must not resurrect a superseded record
    }

    private static MedicationAdministration Legacy(ShiftPackageFixture f, ParticipantMedication med, MedicationAdministrationStatus status, DateTime createdAt) => new()
    {
        Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId, ScheduledAt = Nine, Status = status,
        Reason = status == MedicationAdministrationStatus.Administered ? null : "legacy reason", RecordedByName = "Ben Turner", RecordedByUserId = f.Worker.Id, CreatedAt = createdAt,
        AdministeredAt = status == MedicationAdministrationStatus.Administered ? createdAt : null,
    };
}
