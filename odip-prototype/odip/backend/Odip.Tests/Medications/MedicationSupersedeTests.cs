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
/// One ACTIVE record per scheduled dose slot, with one exception: a later ADMINISTERED record supersedes an active Refused or Missed
/// one (the participant refused then took it at 09:40; a cover worker takes over a dose the first worker marked not given). The earlier
/// record is kept as history, linked and audited. An Administered record (and Withheld / WrongMedication) is never superseded here: only
/// the coordinator amend path changes it.
/// </summary>
public class MedicationSupersedeTests
{
    private static readonly DateTime Nine = new(2026, 7, 14, 9, 0, 0, DateTimeKind.Unspecified);

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

    private static CreateAdministrationDto Dose(MedicationAdministrationStatus status, string? key = null, string? reason = null, string? notes = null) => new()
    {
        ScheduledAt = Nine, Status = status, IdempotencyKey = key, Reason = reason, Notes = notes, DoseGiven = "1 tablet", AdministeredAtTimeZone = "Australia/Sydney",
    };

    private static CreateAdministrationDto Missed(string? key = null) => Dose(MedicationAdministrationStatus.Missed, key, "Asleep; handed to the next worker");
    private static CreateAdministrationDto Given(string? key = null) => Dose(MedicationAdministrationStatus.Administered, key);

    private static ApiResponse<AdministrationDto> Body(ActionResult<ApiResponse<AdministrationDto>> r) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    private static int Status(ActionResult<ApiResponse<AdministrationDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode!.Value;

    /// <summary>A cover worker with their own InProgress shift for the same participant and window (competent, so any mode lets them record).</summary>
    private static (PortalController Controller, Guid ShiftId, User Worker) CoverWorker(ShiftPackageFixture f)
    {
        var cover = f.AddWorker("Cover", "Worker");
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, UserId = cover.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.InProgress,
        };
        f.Db.Shifts.Add(shift);
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = shift.Id, ActualStart = ActualStartUtc, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = cover.Id, StartedAt = ActualStartUtc, IsActive = true,
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
        Assert.Equal("Asleep; handed to the next worker", earlier.Reason);   // the history is intact
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
    public async Task AnAdministeredRecord_IsNeverSuperseded_AnyOtherOutcomeIs409WithTheExistingRecord(MedicationAdministrationStatus later)
    {
        var f = Create();
        var med = AddMed(f);
        var first = Body(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given("k1"), default)).Data!;
        var (cover, coverShiftId, _) = CoverWorker(f);

        var result = await cover.RecordShiftDose(coverShiftId, med.Id, Dose(later, "k2", "a reason"), default);

        Assert.Equal(409, Status(result));
        Assert.Equal(MedicationErrorCodes.AdministrationAlreadyRecorded, Body(result).Code);
        Assert.Equal(first.Id, Body(result).Data!.Id);
        var all = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Single(all);
        Assert.Null(all[0].SupersededByAdministrationId);
    }

    [Theory]
    [InlineData(MedicationAdministrationStatus.Withheld)]
    [InlineData(MedicationAdministrationStatus.WrongMedication)]
    public async Task AWithheldOrWrongMedicationRecord_IsNotSupersededByAnAdministeredOne(MedicationAdministrationStatus first)
    {
        var f = Create();
        var med = AddMed(f);
        Assert.Equal(200, Status(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose(first, "k1", "clinical hold", notes: "gave the 250mg by mistake"), default)));
        var (cover, coverShiftId, _) = CoverWorker(f);

        var result = await cover.RecordShiftDose(coverShiftId, med.Id, Given("k2"), default);

        Assert.Equal(409, Status(result));
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Theory]
    [InlineData(MedicationAdministrationStatus.Missed)]
    [InlineData(MedicationAdministrationStatus.Refused)]
    [InlineData(MedicationAdministrationStatus.Withheld)]
    public async Task OnlyAnAdministeredRecordSupersedes_AMissedRecordIsNotReplacedByAnotherNotGivenOutcome(MedicationAdministrationStatus later)
    {
        var f = Create();
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Missed("k1"), default);
        var (cover, coverShiftId, _) = CoverWorker(f);

        var result = await cover.RecordShiftDose(coverShiftId, med.Id, Dose(later, "k2", "another reason"), default);

        Assert.Equal(409, Status(result));
        var only = Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
        Assert.Null(only.SupersededByAdministrationId);
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
            Legacy(f, med, MedicationAdministrationStatus.Missed, new DateTime(2026, 7, 14, 0, 40, 0, DateTimeKind.Utc)));
        f.Db.SaveChanges();

        var result = await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Given(), default);

        Assert.Equal(200, Status(result));
        var id = Body(result).Data!.Id;
        Assert.Equal(2, await f.Db.MedicationAdministrations.CountAsync(a => a.SupersededByAdministrationId == id));
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
