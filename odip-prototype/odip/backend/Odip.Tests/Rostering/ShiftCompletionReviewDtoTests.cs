using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The coordinator's one-call review of a submitted shift (PR 3 builds the UI on it): the completion with breaks, net worked
/// minutes, handover and the "nothing to note" confirmation; every scheduled dose in the rostered window with its outcome; PRN
/// doses given during the shift; and the shift notes. Approve and Return are unchanged.
/// </summary>
public class ShiftCompletionReviewDtoTests
{
    // Shift 09:00-17:00 Sydney on 14 July 2026 = 13 Jul 23:00Z .. 14 Jul 07:00Z; worked 09:10-17:05 local.
    private static readonly DateOnly ServiceDate = new(2026, 7, 14);
    private static readonly DateTime ActualStart = new(2026, 7, 13, 23, 10, 0, DateTimeKind.Utc);
    private static readonly DateTime ActualEnd = new(2026, 7, 14, 7, 5, 0, DateTimeKind.Utc);

    private sealed record Arranged(OdipDbContext Db, RosteringController Controller, Shift Shift, ShiftCompletion Completion, User Worker, Participant Participant);

    private static Arranged Arrange(Guid? tenantId = null, string? dbName = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName ?? Guid.NewGuid().ToString()).Options, tenant.Object);
        var tid = tenantId ?? Guid.Empty;

        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tid, State = "NSW" });
        var worker = MedicationTestIdentities.SeedCompetentUser(db, "Ben", "Turner", tenantId: tid);
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tid, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tid, ParticipantId = participant.Id, UserId = worker.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.PendingReview,
        };
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = tid, ShiftId = shift.Id, ActualStart = ActualStart, ActualEnd = ActualEnd, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = worker.Id, StartedAt = ActualStart, SubmittedAt = ActualEnd, IsActive = true,
            HandoverText = "Check the left heel.", NothingToNoteConfirmed = false,
        };
        db.Participants.Add(participant);
        db.Shifts.Add(shift);
        db.ShiftCompletions.Add(completion);
        db.SaveChanges();

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test");
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
        return new Arranged(db, controller, shift, completion, worker, participant);
    }

    private static ShiftCompletionReviewDto Review(ActionResult<ApiResponse<ShiftCompletionReviewDto>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionReviewDto>>(ok.Value);
        Assert.True(body.Success);
        return body.Data!;
    }

    private static ParticipantMedication AddMed(Arranged a, string name, string? times, MedicationType type = MedicationType.Regular)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = a.Participant.TenantId, ParticipantId = a.Participant.Id, Name = name, Strength = "500mg", DoseDescription = "1 tablet",
            Type = type, TimesOfDay = times, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
            PrnIndication = type == MedicationType.Prn ? "Pain" : null, PrnMaxDosesPer24h = type == MedicationType.Prn ? 4 : null,
        };
        a.Db.ParticipantMedications.Add(med);
        a.Db.SaveChanges();
        return med;
    }

    [Fact]
    public async Task ReturnsTheCompletionWithBreaksNetMinutesHandoverAndTheNothingToNoteConfirmation()
    {
        var a = Arrange();
        a.Completion.NothingToNoteConfirmed = true;
        a.Db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = Guid.NewGuid(), TenantId = a.Completion.TenantId, ShiftCompletionId = a.Completion.Id, CreatedByUserId = a.Worker.Id,
            StartedAt = ActualStart.AddHours(3), EndedAt = ActualStart.AddHours(3).AddMinutes(30), EditedAt = ActualStart.AddHours(4),
        });
        a.Db.SaveChanges();

        var review = Review(await a.Controller.GetShiftCompletionReview(a.Shift.Id, default));

        Assert.Equal("Amy Ng", review.ParticipantName);
        Assert.Equal("Ben Turner", review.StaffName);
        Assert.Equal(ServiceDate, review.ServiceDate);
        Assert.Equal("Australia/Sydney", review.TimeZoneId);
        var c = review.Completion;
        Assert.Equal(a.Completion.Id, c.Id);
        Assert.Equal("Check the left heel.", c.HandoverText);
        Assert.False(c.NothingToHandOver);
        Assert.True(c.NothingToNoteConfirmed);
        var b = Assert.Single(c.Breaks);
        Assert.Equal(30, b.Minutes);
        Assert.NotNull(b.EditedAt);
        Assert.Equal(30, c.BreakMinutes);
        Assert.Equal(445, c.NetWorkedMinutes);   // 09:10 -> 17:05 is 475 minutes, less the 30-minute break
    }

    [Fact]
    public async Task EveryScheduledDoseInTheRosteredWindow_IsListedWithItsOutcome_AndUnrecordedOnesHaveNone()
    {
        var a = Arrange();
        var med = AddMed(a, "Levetiracetam", "09:00,12:30,16:30");
        a.Db.MedicationAdministrations.AddRange(
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId, ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet", RecordedByName = "Ben Turner", AdministeredAt = ActualStart.AddMinutes(5),
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId, ScheduledAt = new DateTime(2026, 7, 14, 12, 30, 0),
                Status = MedicationAdministrationStatus.Missed, Reason = "Asleep; not given this shift", RecordedByName = "Ben Turner",
            });
        a.Db.SaveChanges();

        var doses = Review(await a.Controller.GetShiftCompletionReview(a.Shift.Id, default)).Doses;

        Assert.Equal(["09:00", "12:30", "16:30"], doses.Select(d => d.ScheduledTime));
        Assert.Equal(MedicationAdministrationStatus.Administered, doses[0].Outcome!.Status);
        Assert.Equal(MedicationAdministrationStatus.Missed, doses[1].Outcome!.Status);
        Assert.Equal("Asleep; not given this shift", doses[1].Outcome!.Reason);
        Assert.Null(doses[2].Outcome);
        Assert.Equal([PortalDoseState.Recorded, PortalDoseState.Recorded, PortalDoseState.Overdue], doses.Select(d => d.State));
    }

    [Fact]
    public async Task PrnDosesGivenDuringTheShift_AreListed_OthersAreNot()
    {
        var a = Arrange();
        var prn = AddMed(a, "Paracetamol", null, MedicationType.Prn);
        MedicationAdministration Given(DateTime at) => new()
        {
            Id = Guid.NewGuid(), TenantId = prn.TenantId, ParticipantMedicationId = prn.Id, ParticipantId = prn.ParticipantId,
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "Ben Turner", PrnReason = "Headache", AdministeredAt = at, DoseGiven = "2 tablets",
        };
        a.Db.MedicationAdministrations.AddRange(
            Given(ActualStart.AddHours(2)),      // during the shift
            Given(ActualStart.AddHours(-3)),     // before it
            Given(ActualEnd.AddHours(1)));       // after it
        a.Db.SaveChanges();

        var prnDoses = Review(await a.Controller.GetShiftCompletionReview(a.Shift.Id, default)).PrnDoses;

        var dose = Assert.Single(prnDoses);
        Assert.Equal("Paracetamol", dose.MedicationName);
        Assert.Equal(ActualStart.AddHours(2), dose.Outcome.AdministeredAt);
    }

    [Fact]
    public async Task IncludesTheShiftNotes_OldestFirst_WithAnyLinkedIncident()
    {
        var a = Arrange();
        var first = new ShiftNote { Id = Guid.NewGuid(), TenantId = a.Shift.TenantId, ShiftId = a.Shift.Id, AuthorUserId = a.Worker.Id, AuthorName = "Ben Turner", Body = "Morning ok.", CreatedAt = ActualStart.AddHours(1) };
        var second = new ShiftNote { Id = Guid.NewGuid(), TenantId = a.Shift.TenantId, ShiftId = a.Shift.Id, AuthorUserId = a.Worker.Id, AuthorName = "Ben Turner", Body = "She fell at 2pm.", CreatedAt = ActualStart.AddHours(5), FlaggedCategories = ShiftNoteFlagCategory.Falls };
        a.Db.ShiftNotes.AddRange(second, first);
        var incidentId = Guid.NewGuid();
        a.Db.IncidentReports.Add(new IncidentReport
        {
            Id = incidentId, ShiftNoteId = second.Id, ReportedByUserId = a.Worker.Id, Title = "Fall", Description = "x", IncidentDateTime = ActualStart,
            Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, IsActive = true,
        });
        a.Db.SaveChanges();

        var notes = Review(await a.Controller.GetShiftCompletionReview(a.Shift.Id, default)).Notes;

        Assert.Equal(["Morning ok.", "She fell at 2pm."], notes.Select(n => n.Body));
        Assert.Null(notes[0].IncidentId);
        Assert.Equal(incidentId, notes[1].IncidentId);
        Assert.Contains("Falls", notes[1].FlaggedCategories);
    }

    [Fact]
    public async Task ReturnsTheIncidentsOnTheCompletion_LikeTheExistingDetailEndpoint()
    {
        var a = Arrange();
        a.Db.IncidentReports.Add(new IncidentReport
        {
            Id = Guid.NewGuid(), ShiftId = a.Shift.Id, ReportedByUserId = a.Worker.Id, Title = "Fall", Description = "x", IncidentDateTime = ActualStart,
            Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, IsActive = true,
        });
        a.Db.SaveChanges();

        Assert.Single(Review(await a.Controller.GetShiftCompletionReview(a.Shift.Id, default)).Completion.Incidents);
    }

    [Fact]
    public async Task AShiftWithNoActiveCompletion_Is404WithTheSameCodeAsTheCompletionEndpoint()
    {
        var a = Arrange();
        a.Completion.IsActive = false;
        a.Db.SaveChanges();

        var result = await a.Controller.GetShiftCompletionReview(a.Shift.Id, default);

        var notFound = Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal(ShiftErrorCodes.ShiftCompletionNotFound, Assert.IsType<ApiResponse<ShiftCompletionReviewDto>>(notFound.Value).Code);
    }

    [Fact]
    public async Task ReviewOfAnotherTenantsShift_IsNotFound_ToANonSuperAdminCaller()
    {
        // Seam test: the shift and its completion belong to tenant B; the caller is scoped to tenant A. EF InMemory databases
        // are shared by name, so a second context over the same store, scoped to tenant A, sees tenant B's rows only if the
        // tenant query filters fail.
        var dbName = Guid.NewGuid().ToString();
        var foreign = Arrange(Guid.NewGuid(), dbName);

        var tenantA = new Mock<ICurrentTenant>();
        tenantA.Setup(t => t.TenantId).Returns(Guid.NewGuid());
        tenantA.Setup(t => t.IsSuperAdmin).Returns(false);
        var scopedDb = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenantA.Object);
        var controller = new RosteringController(scopedDb, new StaffCompatibilityLinkService(scopedDb), new StaffUnavailabilityQuery(scopedDb));

        var result = await controller.GetShiftCompletionReview(foreign.Shift.Id, default);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public void TheReviewEndpoint_IsCoordinatorOnly_LikeTheRestOfTheController()
    {
        var attribute = typeof(RosteringController).GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>().Single();
        var method = typeof(RosteringController).GetMethod(nameof(RosteringController.GetShiftCompletionReview))!;

        Assert.Equal("SuperAdmin,Admin,Coordinator", attribute.Roles);
        Assert.Empty(method.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true));
        Assert.Empty(method.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true));   // no per-action widening
    }
}
