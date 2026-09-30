using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// The handover baton pass (D4): the latest handover for a participant is the most recent submitted-or-approved
/// completion's, the next worker marks it read, and a short trail shows the last 3 holders.
/// </summary>
public class PortalHandoverTests
{
    private static readonly DateTime T = new(2026, 7, 13, 6, 0, 0, DateTimeKind.Utc);

    /// <summary>A previous worker's submitted completion for the participant, on its own shift.</summary>
    private static ShiftCompletion AddSubmitted(
        ShiftPackageFixture f, string worker, DateOnly serviceDate, DateTime submittedAt, string? text, bool nothing = false,
        bool isActive = true, Guid? participantId = null, ShiftStatus status = ShiftStatus.PendingReview, Guid? tenantId = null)
    {
        var tid = tenantId ?? f.Worker.TenantId;
        var user = f.AddWorker(worker, "Previous");
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tid, ParticipantId = participantId ?? f.Participant.Id, UserId = user.Id, ServiceDate = serviceDate,
            StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(15, 0), Status = status,
        };
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = tid, ShiftId = shift.Id, ActualStart = submittedAt.AddHours(-8), ActualEnd = submittedAt,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id, StartedAt = submittedAt.AddHours(-8), SubmittedAt = submittedAt,
            IsActive = isActive, HandoverText = text, NothingToHandOver = nothing,
        };
        f.Db.Shifts.Add(shift);
        f.Db.ShiftCompletions.Add(completion);
        f.Db.SaveChanges();
        return completion;
    }

    private static PortalShiftDetailDto Get(ShiftPackageFixture f) => Detail(f.Controller.GetShiftDetail(f.Shift.Id, default).GetAwaiter().GetResult());

    [Fact]
    public void NoPreviousShift_MeansNoHandoverAndAnEmptyTrail()
    {
        var f = Create(ShiftStatus.Published);

        var detail = Get(f);

        Assert.Null(detail.Handover);
        Assert.Empty(detail.HandoverTrail);
    }

    [Fact]
    public void TheLatestHandover_IsTheMostRecentSubmittedCompletionsText_WithAuthorDateAndReadState()
    {
        var f = Create(ShiftStatus.Published);
        AddSubmitted(f, "Oldest", new DateOnly(2026, 7, 10), T.AddDays(-3), "Old handover");
        var newest = AddSubmitted(f, "Newest", new DateOnly(2026, 7, 13), T, "Sophie had a rough night; check the left heel.");
        AddSubmitted(f, "Middle", new DateOnly(2026, 7, 12), T.AddDays(-1), "Middle handover");

        var handover = Get(f).Handover!;

        Assert.Equal(newest.Id, handover.CompletionId);
        Assert.Equal("Sophie had a rough night; check the left heel.", handover.Text);
        Assert.Equal("Newest Previous", handover.AuthorName);
        Assert.Equal(new DateOnly(2026, 7, 13), handover.ShiftDate);
        Assert.Equal(T, handover.SubmittedAt);
        Assert.True(handover.RequiresAcknowledgement);
        Assert.False(handover.IsRead);
        Assert.Null(handover.ReadAt);
    }

    [Fact]
    public void ApprovedCompletionsCountToo_AndReturnedOrStillInProgressOnesDoNot()
    {
        var f = Create(ShiftStatus.Published);
        var approved = AddSubmitted(f, "Approved", new DateOnly(2026, 7, 11), T.AddDays(-2), "From an approved shift", status: ShiftStatus.Completed);
        AddSubmitted(f, "Returned", new DateOnly(2026, 7, 13), T, "Returned, so archived", isActive: false);
        // Started but never submitted.
        var inProgressUser = f.AddWorker("Busy", "Person");
        var inProgressShift = new Shift { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, UserId = inProgressUser.Id, ServiceDate = new DateOnly(2026, 7, 13), StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.InProgress };
        f.Db.Shifts.Add(inProgressShift);
        f.Db.ShiftCompletions.Add(new ShiftCompletion { Id = Guid.NewGuid(), ShiftId = inProgressShift.Id, ActualStart = T, TimeZoneId = "Australia/Sydney", SubmittedByUserId = inProgressUser.Id, StartedAt = T, IsActive = true, HandoverText = "not submitted" });
        f.Db.SaveChanges();

        var detail = Get(f);

        Assert.Equal(approved.Id, detail.Handover!.CompletionId);
        Assert.Single(detail.HandoverTrail);
    }

    [Fact]
    public void TheCallersOwnShiftIsNeverItsOwnHandover_AndOtherParticipantsAreIgnored()
    {
        var f = Create(ShiftStatus.PendingReview);
        f.Completion!.SubmittedAt = T;
        f.Completion.HandoverText = "my own";
        var other = new Participant { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, FirstName = "Mia", LastName = "Chen", IsActive = true };
        f.Db.Participants.Add(other);
        f.Db.SaveChanges();
        AddSubmitted(f, "Elsewhere", new DateOnly(2026, 7, 13), T, "someone else's participant", participantId: other.Id);

        Assert.Null(Get(f).Handover);
    }

    [Fact]
    public void TheRuleIsLiteral_ABlankLatestHandoverIsNotReplacedByAnOlderOne()
    {
        var f = Create(ShiftStatus.Published);
        AddSubmitted(f, "Older", new DateOnly(2026, 7, 12), T.AddDays(-1), "An older handover that must not be resurrected");
        AddSubmitted(f, "Latest", new DateOnly(2026, 7, 13), T, text: null);

        var handover = Get(f).Handover!;

        Assert.Null(handover.Text);
        Assert.False(handover.NothingToHandOver);
        Assert.False(handover.RequiresAcknowledgement);
        Assert.Equal("Latest Previous", handover.AuthorName);
    }

    [Fact]
    public void NothingToHandOver_IsReportedExplicitly()
    {
        var f = Create(ShiftStatus.Published);
        AddSubmitted(f, "Latest", new DateOnly(2026, 7, 13), T, text: null, nothing: true);

        var handover = Get(f).Handover!;

        Assert.True(handover.NothingToHandOver);
        Assert.Null(handover.Text);
        Assert.False(handover.RequiresAcknowledgement);
    }

    [Fact]
    public void TheTrail_IsTheLastThreeHolders_MostRecentFirst_NamesAndDatesOnly()
    {
        var f = Create(ShiftStatus.Published);
        AddSubmitted(f, "Fourth", new DateOnly(2026, 7, 9), T.AddDays(-4), "d");
        AddSubmitted(f, "Third", new DateOnly(2026, 7, 10), T.AddDays(-3), "c");
        AddSubmitted(f, "Second", new DateOnly(2026, 7, 11), T.AddDays(-2), "b");
        AddSubmitted(f, "First", new DateOnly(2026, 7, 12), T.AddDays(-1), "a");

        var trail = Get(f).HandoverTrail;

        Assert.Equal(["First Previous", "Second Previous", "Third Previous"], trail.Select(t => t.WorkerName));
        Assert.Equal([new DateOnly(2026, 7, 12), new DateOnly(2026, 7, 11), new DateOnly(2026, 7, 10)], trail.Select(t => t.ShiftDate));
        // The trail record has no text property at all: it is a custody chain, not a reading list.
        Assert.DoesNotContain(typeof(PortalHandoverTrailEntryDto).GetProperties(), p => p.Name.Contains("Text"));
    }

    // ── acknowledge ──

    [Fact]
    public async Task Ack_RecordsWhoAndWhen_FlipsTheReadState_AndIsAudited()
    {
        var f = Create(ShiftStatus.Published, withAuditing: true);
        var completion = AddSubmitted(f, "Previous", new DateOnly(2026, 7, 13), T, "Watch the left heel.");

        var detail = Detail(await f.Controller.AcknowledgeHandover(f.Shift.Id, new AcknowledgeHandoverDto { CompletionId = completion.Id }, default));

        Assert.True(detail.Handover!.IsRead);
        Assert.Equal(DefaultNow.UtcDateTime, detail.Handover.ReadAt);
        var ack = await f.Db.HandoverAcknowledgements.SingleAsync();
        Assert.Equal(completion.Id, ack.SourceCompletionId);
        Assert.Equal(f.Worker.Id, ack.UserId);
        Assert.Equal(f.Shift.Id, ack.ShiftId);
        Assert.Equal(DefaultNow.UtcDateTime, ack.AcknowledgedAt);
        Assert.Contains(typeof(HandoverAcknowledgement), AuditedEntities.Types);
        Assert.Single(await f.Db.AuditLogs.Where(a => a.EntityType == nameof(HandoverAcknowledgement) && a.EntityId == ack.Id && a.Action == AuditAction.Created).ToListAsync());
    }

    [Fact]
    public async Task Ack_WithNoBody_AcknowledgesTheLatest()
    {
        var f = Create(ShiftStatus.InProgress);
        AddSubmitted(f, "Previous", new DateOnly(2026, 7, 13), T, "text");

        var detail = Detail(await f.Controller.AcknowledgeHandover(f.Shift.Id, null, default));

        Assert.True(detail.Handover!.IsRead);
    }

    [Fact]
    public async Task Ack_IsIdempotent_AndDoesNotMoveTheReadTime()
    {
        var f = Create(ShiftStatus.Published);
        AddSubmitted(f, "Previous", new DateOnly(2026, 7, 13), T, "text");
        var first = Detail(await f.Controller.AcknowledgeHandover(f.Shift.Id, null, default));
        f.Advance(TimeSpan.FromMinutes(10));

        var second = Detail(await f.Controller.AcknowledgeHandover(f.Shift.Id, null, default));

        Assert.Single(await f.Db.HandoverAcknowledgements.ToListAsync());
        Assert.Equal(first.Handover!.ReadAt, second.Handover!.ReadAt);
    }

    [Fact]
    public async Task Ack_NamingAHandoverThatIsNoLongerTheLatest_Is409_AndNothingIsRecorded()
    {
        var f = Create(ShiftStatus.Published);
        var older = AddSubmitted(f, "Older", new DateOnly(2026, 7, 12), T.AddDays(-1), "older");
        AddSubmitted(f, "Newer", new DateOnly(2026, 7, 13), T, "newer");

        var result = await f.Controller.AcknowledgeHandover(f.Shift.Id, new AcknowledgeHandoverDto { CompletionId = older.Id }, default);

        var body = Failure(result, 409);
        Assert.Equal(ShiftErrorCodes.ShiftHandoverChanged, body.Code);
        Assert.Equal("newer", body.Data!.Handover!.Text);   // the refreshed shift rides along so the client can re-read
        Assert.Empty(await f.Db.HandoverAcknowledgements.ToListAsync());
    }

    [Fact]
    public async Task Ack_WithNothingToRead_Is404()
    {
        var f = Create(ShiftStatus.Published);

        var body = Failure(await f.Controller.AcknowledgeHandover(f.Shift.Id, null, default), 404);

        Assert.Equal(ShiftErrorCodes.ShiftHandoverNotFound, body.Code);
    }

    [Fact]
    public async Task ReadState_IsPerReader_AnotherWorkersAckDoesNotMarkItReadForMe()
    {
        var f = Create(ShiftStatus.Published);
        var completion = AddSubmitted(f, "Previous", new DateOnly(2026, 7, 13), T, "text");
        var colleague = f.AddWorker("Colleague", "Worker");
        f.Db.HandoverAcknowledgements.Add(new HandoverAcknowledgement
        {
            Id = Guid.NewGuid(), SourceCompletionId = completion.Id, ShiftId = Guid.NewGuid(), UserId = colleague.Id, AcknowledgedAt = T,
        });
        f.Db.SaveChanges();

        Assert.False(Get(f).Handover!.IsRead);
    }

    [Fact]
    public async Task Ack_IsOnlyForTheCallersOwnShift_404OtherwiseLikeEveryPortalAction()
    {
        var f = Create(ShiftStatus.Published);
        AddSubmitted(f, "Previous", new DateOnly(2026, 7, 13), T, "text");
        var stranger = f.ControllerFor(f.AddWorker().Id);

        Assert.IsType<NotFoundObjectResult>((await stranger.AcknowledgeHandover(f.Shift.Id, null, default)).Result);
        Assert.Empty(await f.Db.HandoverAcknowledgements.ToListAsync());
    }

    [Theory]
    [InlineData(ShiftStatus.PendingReview, ShiftErrorCodes.ShiftAlreadyFinished)]
    [InlineData(ShiftStatus.Completed, ShiftErrorCodes.ShiftAlreadyCompleted)]
    [InlineData(ShiftStatus.Cancelled, ShiftErrorCodes.ShiftCancelled)]
    [InlineData(ShiftStatus.Draft, ShiftErrorCodes.ShiftNotPublished)]
    public async Task Ack_IsOnlyBeforeTheShiftIsFinished(ShiftStatus status, string code)
    {
        var f = Create(status);
        AddSubmitted(f, "Previous", new DateOnly(2026, 7, 13), T, "text");

        Assert.Equal(code, Failure(await f.Controller.AcknowledgeHandover(f.Shift.Id, null, default), 409).Code);
        Assert.Empty(await f.Db.HandoverAcknowledgements.ToListAsync());
    }

    [Fact]
    public void AHandoverFromAnotherTenant_IsNeverReturned_ToANonSuperAdminCaller()
    {
        // Seam test: a completion owned by another tenant, even one (artificially) pointing at this participant,
        // must not surface to a caller scoped to tenant A.
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var f = Create(ShiftStatus.Published, tenantId: tenantA);
        AddSubmitted(f, "Foreign", new DateOnly(2026, 7, 13), T, "tenant B's secret", tenantId: tenantB);

        var detail = Get(f);

        Assert.Null(detail.Handover);
        Assert.Empty(detail.HandoverTrail);
    }

    [Fact]
    public void Model_HasAUniqueReaderIndex_AndATenantFilter()
    {
        var f = Create();
        var entity = f.Db.Model.FindEntityType(typeof(HandoverAcknowledgement))!;

        var unique = Assert.Single(entity.GetIndexes(), i => i.GetDatabaseName() == HandoverAcknowledgement.UniqueReaderIndexName);
        Assert.True(unique.IsUnique);
        Assert.Equal(new[] { "SourceCompletionId", "UserId" }, unique.Properties.Select(p => p.Name));
        Assert.NotNull(entity.GetQueryFilter());
    }
}

/// <summary>
/// Finish validation: the End checklist is ENFORCED by the server - every dose due in the shift's rostered window needs an
/// outcome (or a "not given this shift" reason, stored as a Missed record) and no break may still be running - plus the
/// "nothing to note" confirmation and the handover written at Finish.
/// </summary>
public class PortalFinishValidationTests
{
    private static ParticipantMedication AddMed(
        ShiftPackageFixture f, string name, string times, string? strength = "500mg", MedicationType type = MedicationType.Regular,
        MedicationFrequency frequency = MedicationFrequency.Daily, Weekdays? days = null)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = name, Strength = strength, DoseDescription = "1 tablet",
            Type = type, TimesOfDay = type == MedicationType.Regular ? times : null, Frequency = frequency, DaysOfWeek = days,
            StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
            PrnIndication = type == MedicationType.Prn ? "Pain" : null, PrnMaxDosesPer24h = type == MedicationType.Prn ? 4 : null,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    private static void Record(ShiftPackageFixture f, ParticipantMedication med, DateTime slotLocal, MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered)
    {
        f.Db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId, ScheduledAt = slotLocal,
            Status = status, Reason = status == MedicationAdministrationStatus.Administered ? null : "Finished early; handed to the evening worker",
            RecordedByName = "Ben Turner", AdministeredAt = status == MedicationAdministrationStatus.Administered ? DateTime.UtcNow : null,
        });
        f.Db.SaveChanges();
    }

    private static void AddNote(ShiftPackageFixture f) =>
        f.Db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = f.Shift.Id, AuthorUserId = f.Worker.Id, AuthorName = "Ben Turner", Body = "All good." });

    private static readonly DateTime Nine = new(2026, 7, 14, 9, 0, 0);
    private static readonly DateTime Noon = new(2026, 7, 14, 12, 30, 0);

    private static async Task<ApiResponse<PortalShiftDetailDto>> FinishBlocked(ShiftPackageFixture f, FinishShiftDto? dto = null)
    {
        var result = await f.Controller.FinishShift(f.Shift.Id, dto ?? new FinishShiftDto(), default);
        return Failure(result, 422);
    }

    // ── notes ──

    [Fact]
    public async Task NoNoteAndNoConfirmation_IsStill409NoteRequired_Unchanged()
    {
        var f = Create();

        var result = await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default);

        Assert.Equal(ShiftErrorCodes.ShiftNoteRequired, Failure(result, 409).Code);
    }

    [Fact]
    public async Task NothingToNote_LetsFinishProceed_AndIsStoredOnTheCompletion()
    {
        var f = Create();

        var detail = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true }, default));

        Assert.Equal(ShiftStatus.PendingReview, detail.Status);
        Assert.True(detail.Completion!.NothingToNoteConfirmed);
    }

    [Fact]
    public async Task NothingToNote_WhenNotesExist_IsNotStored_TheNotesSpeakForThemselves()
    {
        var f = Create();
        AddNote(f);
        f.Db.SaveChanges();

        var detail = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true }, default));

        Assert.False(detail.Completion!.NothingToNoteConfirmed);
    }

    // ── handover written at Finish ──

    [Fact]
    public async Task Finish_StoresTheHandoverText_TrimmedOnTheCompletion()
    {
        var f = Create();
        AddNote(f);
        f.Db.SaveChanges();

        var detail = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { HandoverText = "  Check the left heel.  " }, default));

        Assert.Equal("Check the left heel.", detail.Completion!.HandoverText);
        Assert.False(detail.Completion.NothingToHandOver);
        Assert.Equal("Check the left heel.", (await f.Db.ShiftCompletions.SingleAsync()).HandoverText);
    }

    [Fact]
    public async Task Finish_AnEmptyHandoverIsAllowed_AndNothingToHandOverIsAnExplicitFlag()
    {
        var f = Create();
        AddNote(f);
        f.Db.SaveChanges();

        var blank = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { HandoverText = "   " }, default));
        Assert.Null(blank.Completion!.HandoverText);
        Assert.False(blank.Completion.NothingToHandOver);

        var f2 = Create();
        AddNote(f2);
        f2.Db.SaveChanges();
        var explicitNothing = Detail(await f2.Controller.FinishShift(f2.Shift.Id, new FinishShiftDto { NothingToHandOver = true }, default));
        Assert.True(explicitNothing.Completion!.NothingToHandOver);
    }

    [Fact]
    public async Task Finish_ATextAndNothingToHandOverTogether_Is400_AndNothingChanges()
    {
        var f = Create();
        AddNote(f);
        f.Db.SaveChanges();

        var result = await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { HandoverText = "x", NothingToHandOver = true }, default);

        Assert.Equal(ShiftErrorCodes.ShiftHandoverConflict, Failure(result, 400).Code);
        Assert.Equal(ShiftStatus.InProgress, (await f.Db.Shifts.SingleAsync()).Status);
    }

    [Fact]
    public async Task TheFinishedShiftsHandover_IsWhatTheNextWorkerSees()
    {
        var f = Create();
        AddNote(f);
        f.Db.SaveChanges();
        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { HandoverText = "Hand-over text" }, default));

        // The next worker, on a later shift for the same participant.
        var next = f.AddWorker("Next", "Worker");
        var nextShift = new Shift { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, UserId = next.Id, ServiceDate = ServiceDate.AddDays(1), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.Published };
        f.Db.Shifts.Add(nextShift);
        f.Db.SaveChanges();

        var detail = Detail(await f.ControllerFor(next.Id).GetShiftDetail(nextShift.Id, default));

        Assert.Equal("Hand-over text", detail.Handover!.Text);
        Assert.Equal("Ben Turner", detail.Handover.AuthorName);
    }

    // ── doses ──

    [Fact]
    public async Task ADoseInTheWindowWithNoOutcome_Is422_WithTheListAndTheShiftAsData_AndNothingChanges()
    {
        var f = Create();
        AddNote(f);
        var med = AddMed(f, "Levetiracetam", "09:00,12:30");
        Record(f, med, Nine);   // 09:00 done; 12:30 still has nothing

        var body = await FinishBlocked(f);

        Assert.Equal(ShiftErrorCodes.ShiftFinishBlocked, body.Code);
        var blocker = Assert.Single(body.Data!.FinishBlockers);
        Assert.Equal(ShiftFinishBlockerCodes.DoseOutcomeMissing, blocker.Code);
        Assert.Equal(med.Id, blocker.MedicationId);
        Assert.Equal("Levetiracetam", blocker.MedicationName);
        Assert.Equal(Noon, blocker.ScheduledAt);
        Assert.Contains("12:30", blocker.Message);
        Assert.Equal(blocker.Message, Assert.Single(body.Errors!));
        var shift = await f.Db.Shifts.SingleAsync();
        Assert.Equal(ShiftStatus.InProgress, shift.Status);
        Assert.Null((await f.Db.ShiftCompletions.SingleAsync()).ActualEnd);
    }

    [Fact]
    public async Task EveryRecordedOutcomeCounts_InCludingNotGivenThisShiftWithAReason_RecordedAsMissed()
    {
        var f = Create();
        AddNote(f);
        var med = AddMed(f, "Levetiracetam", "09:00,12:30,15:00");
        Record(f, med, Nine, MedicationAdministrationStatus.Administered);
        Record(f, med, Noon, MedicationAdministrationStatus.Refused);
        Record(f, med, new DateTime(2026, 7, 14, 15, 0, 0), MedicationAdministrationStatus.Missed);   // "not given this shift" + reason

        var detail = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default));

        Assert.Equal(ShiftStatus.PendingReview, detail.Status);
    }

    [Fact]
    public async Task TheWindowIsTheRosteredOne_ALateStartDoesNotMakeADueDoseDisappear()
    {
        // The worker started at 09:05 (actual); a 09:00 dose is before their actual start but inside the rostered window.
        var f = Create();
        f.Advance(TimeSpan.FromHours(5));   // 16:00 local: all three slots have come due
        AddNote(f);
        AddMed(f, "Levetiracetam", "09:00");

        var body = await FinishBlocked(f);

        Assert.Equal(new DateTime(2026, 7, 14, 9, 0, 0), Assert.Single(body.Data!.FinishBlockers).ScheduledAt);
    }

    [Fact]
    public async Task DosesOutsideTheWindow_AndPrnMedications_AndOtherDays_NeverBlock()
    {
        var f = Create();
        f.Advance(TimeSpan.FromHours(2));   // 13:00 local: both slots have come due
        AddNote(f);
        AddMed(f, "Before", "08:59");                                           // before the 09:00 start
        AddMed(f, "AtTheEnd", "17:00");                                         // the window is half-open: 17:00 is the next shift's
        AddMed(f, "Prn", "", type: MedicationType.Prn);                          // as-needed: never scheduled
        AddMed(f, "Wednesdays", "10:00", frequency: MedicationFrequency.SpecificDays, days: Weekdays.Wednesday);   // the 14th is a Tuesday

        var detail = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default));

        Assert.Equal(ShiftStatus.PendingReview, detail.Status);
    }

    [Fact]
    public async Task AnOvernightShift_BlocksOnAnAfterMidnightDose_UntilItHasAnOutcome()
    {
        // 03:30 local on the 15th (AEST) = 17:30 UTC on the 14th: the 02:00 slot has come due, the shift has not ended yet.
        var f = Create(endsNextDay: true, start: new TimeOnly(22, 0), end: new TimeOnly(6, 0), now: new DateTimeOffset(2026, 7, 14, 17, 30, 0, TimeSpan.Zero));
        AddNote(f);
        var med = AddMed(f, "Melatonin", "23:00,02:00");
        Record(f, med, new DateTime(2026, 7, 14, 23, 0, 0));

        var body = await FinishBlocked(f);
        Assert.Equal(new DateTime(2026, 7, 15, 2, 0, 0), Assert.Single(body.Data!.FinishBlockers).ScheduledAt);

        Record(f, med, new DateTime(2026, 7, 15, 2, 0, 0), MedicationAdministrationStatus.Missed);
        Assert.Equal(ShiftStatus.PendingReview, Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default)).Status);
    }

    [Fact]
    public async Task TheManualStartPath_DoesNotCheckDoseOutcomes_TheWorkerHasNoPackageRouteToRecordThem()
    {
        // A worker who never tapped Start finishes with a manual start time. Recording a dose from the package needs an InProgress shift
        // (D2), so there is nothing they could do to clear a dose blocker: the Finish goes through and the coordinator's review shows the
        // unrecorded dose.
        var f = Create(ShiftStatus.Published);
        f.Advance(TimeSpan.FromHours(6));   // 17:00 local
        AddNote(f);
        AddMed(f, "Levetiracetam", "09:00");

        var result = await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { ActualStart = ActualStartUtc }, default);

        Assert.Equal(ShiftStatus.PendingReview, Detail(result).Status);
        Assert.Single(await f.Db.ShiftCompletions.ToListAsync());
        Assert.Empty(await f.Db.MedicationAdministrations.ToListAsync());   // nothing was invented for the unrecorded dose
    }

    [Fact]
    public async Task FinishingAShiftThatWasNeverStarted_IsStill409NotStarted_EvenWithDosesDue()
    {
        // The checklist must not mask the existing "this shift hasn't been started" answer.
        var f = Create(ShiftStatus.Published);
        AddNote(f);
        AddMed(f, "Levetiracetam", "09:00");

        var result = await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default);

        Assert.Equal(ShiftErrorCodes.ShiftNotInProgress, Failure(result, 409).Code);
    }

    // ── the checklist must stay satisfiable (independent review findings 1 and 3) ──

    [Fact]
    public async Task AWorkerWithoutMedicationCompetency_OnAShiftWithDueDoses_IsNotLockedOutOfFinish()
    {
        // Recording a dose is gated on the credential, so a worker without one could never clear a dose blocker: the two rules
        // would be mutually unsatisfiable and Finish would be 422 forever. No dose blocks them; the coordinator's review shows what
        // was not recorded.
        var f = Create(workerCompetent: false);
        f.Advance(TimeSpan.FromHours(6));   // 17:00 local
        AddNote(f);
        AddMed(f, "Levetiracetam", "09:00");

        var before = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));
        Assert.Empty(before.FinishBlockers);
        Assert.False(before.CanRecordDoses);

        var finished = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default));

        Assert.Equal(ShiftStatus.PendingReview, finished.Status);
    }

    [Fact]
    public async Task AWorkerWithoutMedicationCompetency_StillMustEndARunningBreak()
    {
        var f = Create(workerCompetent: false);
        AddNote(f);
        AddMed(f, "Levetiracetam", "09:00");
        Detail(await f.Controller.StartBreak(f.Shift.Id, default));

        var body = await FinishBlocked(f);

        Assert.Equal(ShiftFinishBlockerCodes.BreakRunning, Assert.Single(body.Data!.FinishBlockers).Code);
    }

    [Fact]
    public async Task AWorkerWhoseCredentialHasExpired_IsNotBlockedOnDoses_ButACurrentOneIs()
    {
        var expired = Create();
        expired.Worker.MedicationCompetencyExpiryDate = new DateOnly(2026, 7, 13);   // last valid day was yesterday (provider-local)
        expired.Db.SaveChanges();
        AddNote(expired);
        AddMed(expired, "Levetiracetam", "09:00");
        Assert.Equal(ShiftStatus.PendingReview, Detail(await expired.Controller.FinishShift(expired.Shift.Id, new FinishShiftDto(), default)).Status);

        var current = Create();
        AddNote(current);
        AddMed(current, "Levetiracetam", "09:00");
        Assert.Single((await FinishBlocked(current)).Data!.FinishBlockers);
    }

    [Fact]
    public async Task ADoseWhoseTimeHasNotArrived_DoesNotBlockAnEarlyFinish_AndNoRecordIsInvented()
    {
        // 11:00 local. The 09:00 dose is done; the 15:00 one is for whoever is on then (recording it "not given" would be permanent:
        // a slot takes one record, so the next worker could no longer give it).
        var f = Create();
        AddNote(f);
        var med = AddMed(f, "Levetiracetam", "09:00,15:00");
        Record(f, med, Nine);

        var detailBefore = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));
        Assert.Empty(detailBefore.FinishBlockers);
        var finished = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default));

        Assert.Equal(ShiftStatus.PendingReview, finished.Status);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());   // only the 09:00 record: nothing was made up for 15:00
    }

    [Fact]
    public async Task ADoseBecomesABlocker_AtItsScheduledInstant_NotBefore()
    {
        // Sydney is UTC+10 in July: 11:00 local = 01:00 UTC. A slot at 11:00 is due now; a slot at 11:01 is not.
        var f = Create();
        AddNote(f);
        AddMed(f, "OnTheDot", "11:00");
        AddMed(f, "AMinuteLater", "11:01");

        var body = await FinishBlocked(f);

        Assert.Equal("OnTheDot", Assert.Single(body.Data!.FinishBlockers).MedicationName);
    }

    [Fact]
    public async Task TheDetailsBlockers_FollowTheSameRules_SoTheChecklistNeverDisagreesWithFinish()
    {
        var f = Create();
        f.Advance(TimeSpan.FromHours(2));   // 13:00 local
        AddMed(f, "Due", "12:30");
        AddMed(f, "Upcoming", "15:00");

        var blockers = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).FinishBlockers;

        Assert.Equal("Due", Assert.Single(blockers).MedicationName);
    }

    // ── breaks ──

    [Fact]
    public async Task ARunningBreak_Blocks_AndOnceEndedFinishProceeds()
    {
        var f = Create();
        AddNote(f);
        var started = Detail(await f.Controller.StartBreak(f.Shift.Id, default)).Breaks.Single();

        var body = await FinishBlocked(f);
        Assert.Equal(ShiftFinishBlockerCodes.BreakRunning, Assert.Single(body.Data!.FinishBlockers).Code);

        f.Advance(TimeSpan.FromMinutes(20));
        Detail(await f.Controller.EndBreak(f.Shift.Id, started.Id, default));
        var finished = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default));
        Assert.Equal(ShiftStatus.PendingReview, finished.Status);
        Assert.Equal(20, finished.Completion!.BreakMinutes);
    }

    [Fact]
    public async Task BothBlockers_AreListed_BreakFirst_ThenDosesByScheduledTime()
    {
        var f = Create();
        AddNote(f);
        AddMed(f, "Zeta", "12:30");
        AddMed(f, "Alpha", "09:00");
        Detail(await f.Controller.StartBreak(f.Shift.Id, default));

        var body = await FinishBlocked(f);

        Assert.Equal(
            [ShiftFinishBlockerCodes.BreakRunning, ShiftFinishBlockerCodes.DoseOutcomeMissing, ShiftFinishBlockerCodes.DoseOutcomeMissing],
            body.Data!.FinishBlockers.Select(b => b.Code));
        Assert.Equal(["Alpha", "Zeta"], body.Data.FinishBlockers.Where(b => b.MedicationName != null).Select(b => b.MedicationName));
    }

    // ── the same list, before Finish is ever called ──

    [Fact]
    public async Task TheShiftDetailCarriesTheFinishBlockers_OnlyWhileInProgress()
    {
        var f = Create();
        AddMed(f, "Levetiracetam", "09:00");

        var inProgress = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));
        Assert.Single(inProgress.FinishBlockers);

        var published = Create(ShiftStatus.Published);
        AddMed(published, "Levetiracetam", "09:00");
        Assert.Empty(Detail(await published.Controller.GetShiftDetail(published.Shift.Id, default)).FinishBlockers);
    }

    [Fact]
    public async Task ADoseBlockerIsDedupedWhenAScheduleListsTheSameTimeTwice()
    {
        var f = Create();
        f.Advance(TimeSpan.FromHours(2));   // 13:00 local
        AddNote(f);
        AddMed(f, "Twice", "09:00,09:00");

        var body = await FinishBlocked(f);

        Assert.Single(body.Data!.FinishBlockers);
    }
}
