using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// The rest of the rows a worker portal call creates (#348 fixed notes, flagged-note tasks and ShiftCompletion): a SuperAdmin viewing as no organisation has no
/// current tenant, so the context's auto-stamp left them with an empty TenantId and the organisation could not see them. Each takes the organisation of the
/// shift (or, for leave and unavailability, of the staff user) it belongs to.
/// </summary>
public class PortalWritesTenantTests
{
    private static readonly Guid WaOrg = Guid.Parse("7a000000-0000-0000-0000-000000000001");

    /// <summary>A shift of a WA organisation; the caller is a SuperAdmin with no organisation selected. 15:00 UTC is 23:00 on the 14th in Perth but already the 15th in Sydney.</summary>
    private static async Task<ShiftPackageFixture> Unscoped(ShiftStatus status)
    {
        var f = Create(status, now: new DateTimeOffset(2026, 7, 14, 15, 0, 0, TimeSpan.Zero), tenantId: WaOrg);
        (await f.Db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State = "WA";
        await f.Db.SaveChangesAsync();
        f.Tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        f.Tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return f;
    }

    private static ParticipantMedication AddMed(ShiftPackageFixture f, bool highRisk = false)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg",
            DoseDescription = "1 tablet", Type = MedicationType.Regular, TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1),
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer, IsHighRisk = highRisk,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    private static CreateAdministrationDto Dose(string key, Guid? witnessStaffId = null) => new()
    {
        ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0, DateTimeKind.Unspecified), Status = MedicationAdministrationStatus.Administered,
        IdempotencyKey = key, DoseGiven = "1 tablet", AdministeredAtTimeZone = "Australia/Perth", WitnessStaffId = witnessStaffId,
    };

    private static ObjectResult Dose(ActionResult<ApiResponse<AdministrationDto>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result);

    // ── the shift's own rows ──

    [Fact]
    public async Task StartShift_UnscopedSuperAdmin_SavesTheCompletionInTheShiftsOrganisation()   // pins #348: passes on the old code too
    {
        var f = await Unscoped(ShiftStatus.Published);

        Detail(await f.Controller.StartShift(f.Shift.Id, new StartShiftDto(), default));

        Assert.Equal(WaOrg, (await f.Db.ShiftCompletions.IgnoreQueryFilters().SingleAsync()).TenantId);
    }

    [Fact]
    public async Task ManualFinish_UnscopedSuperAdmin_SavesTheCompletionInTheShiftsOrganisation()   // pins #348: passes on the old code too
    {
        var f = await Unscoped(ShiftStatus.Published);

        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { ActualStart = ActualStartUtc, NothingToNote = true, NothingToHandOver = true }, default));

        Assert.Equal(WaOrg, (await f.Db.ShiftCompletions.IgnoreQueryFilters().SingleAsync()).TenantId);
    }

    [Fact]
    public async Task StartBreak_UnscopedSuperAdmin_SavesTheBreakInTheShiftsOrganisation()
    {
        var f = await Unscoped(ShiftStatus.InProgress);

        Detail(await f.Controller.StartBreak(f.Shift.Id, null, default));

        Assert.Equal(WaOrg, (await f.Db.ShiftBreaks.IgnoreQueryFilters().SingleAsync()).TenantId);
    }

    [Fact]
    public async Task CheckRoutine_UnscopedSuperAdmin_SavesTheTickInTheShiftsOrganisation()
    {
        var f = await Unscoped(ShiftStatus.InProgress);
        var lunch = new ParticipantRoutine
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ParticipantId = f.Participant.Id, Title = "Lunch", Description = "Details",
            Days = ParticipantRoutineDays.All, IsActive = true, StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(13, 0),
        };
        f.Db.ParticipantRoutines.Add(lunch);
        await f.Db.SaveChangesAsync();

        Detail(await f.Controller.CheckRoutine(f.Shift.Id, lunch.Id, default));

        Assert.Equal(WaOrg, (await f.Db.ShiftRoutineChecks.IgnoreQueryFilters().SingleAsync()).TenantId);
    }

    [Fact]
    public async Task AcknowledgeHandover_UnscopedSuperAdmin_SavesTheAcknowledgementInTheShiftsOrganisation()
    {
        var f = await Unscoped(ShiftStatus.Published);
        var previous = f.AddWorker("Previous", "Worker");
        var earlier = new Shift
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ParticipantId = f.Participant.Id, UserId = previous.Id, ServiceDate = ServiceDate.AddDays(-1),
            StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.PendingReview,
        };
        var submittedAt = new DateTime(2026, 7, 13, 6, 0, 0, DateTimeKind.Utc);
        f.Db.Shifts.Add(earlier);
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = WaOrg, ShiftId = earlier.Id, ActualStart = submittedAt.AddHours(-8), ActualEnd = submittedAt, TimeZoneId = "Australia/Perth",
            SubmittedByUserId = previous.Id, StartedAt = submittedAt.AddHours(-8), SubmittedAt = submittedAt, IsActive = true, HandoverText = "Watch the left heel.",
        });
        await f.Db.SaveChangesAsync();

        Detail(await f.Controller.AcknowledgeHandover(f.Shift.Id, null, default));

        Assert.Equal(WaOrg, (await f.Db.HandoverAcknowledgements.IgnoreQueryFilters().SingleAsync()).TenantId);
    }

    [Fact]
    public async Task FinishShift_UnscopedSuperAdmin_NotifiesOnlyTheShiftsOrganisationsAdmins()
    {
        var f = await Unscoped(ShiftStatus.InProgress);
        f.Db.Users.AddRange(
            new User { Id = Guid.NewGuid(), TenantId = WaOrg, Email = "a@wa.example", Username = "wa-admin", FirstName = "Ada", LastName = "Admin", Role = UserRole.Admin, IsActive = true },
            new User { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), Email = "b@other.example", Username = "other-admin", FirstName = "Bob", LastName = "Admin", Role = UserRole.Admin, IsActive = true });
        await f.Db.SaveChangesAsync();

        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true, NothingToHandOver = true }, default));

        Assert.Equal(WaOrg, (await f.Db.NotificationOutbox.IgnoreQueryFilters().SingleAsync()).TenantId);   // one outbox row, for the WA admin only
    }

    // ── medication ──

    [Fact]
    public async Task RecordShiftDose_UnscopedSuperAdmin_SavesTheAdministrationInTheMedicationsOrganisation()
    {
        var f = await Unscoped(ShiftStatus.InProgress);
        var med = AddMed(f);

        Assert.Equal(200, Dose(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose("k1"), default)).StatusCode);

        Assert.Equal(WaOrg, (await f.Db.MedicationAdministrations.IgnoreQueryFilters().SingleAsync()).TenantId);
    }

    [Fact]
    public async Task RecordShiftDose_UnscopedSuperAdmin_ARetriedSubmitIsAReplayOfTheFirstSave()
    {
        var f = await Unscoped(ShiftStatus.InProgress);
        var med = AddMed(f);
        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose("k1"), default);

        var retry = Dose(await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose("k1"), default));

        Assert.Equal(200, retry.StatusCode);   // it was a 409 "already recorded" while the first save had no organisation to find it by
        var only = await f.Db.MedicationAdministrations.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(WaOrg, only.TenantId);
        Assert.Equal(only.Id, ((ApiResponse<AdministrationDto>)retry.Value!).Data!.Id);
    }

    [Fact]
    public async Task RecordShiftDose_UnscopedSuperAdmin_TheWitnessTaskIsInTheMedicationsOrganisationDueTomorrowInItsZone()
    {
        var f = await Unscoped(ShiftStatus.InProgress);
        var med = AddMed(f, highRisk: true);
        var witness = f.AddWorker("Wanda", "Witness");

        await f.Controller.RecordShiftDose(f.Shift.Id, med.Id, Dose("k1", witness.Id), default);

        var task = await f.Db.BookingTasks.IgnoreQueryFilters().SingleAsync(t => t.TaskType == TaskType.MedicationWitness);
        Assert.Equal(WaOrg, task.TenantId);
        Assert.Equal((DateOnly?)new DateOnly(2026, 7, 15), task.DueDate);   // Perth's 14th plus one; the default zone would say the 16th
    }

    // ── leave and unavailability ──

    [Fact]
    public async Task CreateMyLeaveRequest_UnscopedSuperAdmin_SavesTheRequestInTheStaffUsersOrganisation_AndNotifiesOnlyThatOrganisationsAdmins()
    {
        var f = await Unscoped(ShiftStatus.Published);
        var ownAdmin = new User { Id = Guid.NewGuid(), TenantId = WaOrg, Email = "a@wa.example", Username = "wa-admin", FirstName = "Ada", LastName = "Admin", Role = UserRole.Admin, IsActive = true };
        var otherAdmin = new User { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), Email = "b@other.example", Username = "other-admin", FirstName = "Bob", LastName = "Admin", Role = UserRole.Admin, IsActive = true };
        f.Db.Users.AddRange(ownAdmin, otherAdmin);
        await f.Db.SaveChangesAsync();

        var result = await f.Controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = new DateOnly(2026, 8, 3), EndDate = new DateOnly(2026, 8, 7) }, default);

        Assert.Equal(201, ((ObjectResult)result.Result!).StatusCode);
        Assert.Equal(WaOrg, (await f.Db.LeaveRequests.IgnoreQueryFilters().SingleAsync()).TenantId);
        Assert.Equal(WaOrg, (await f.Db.NotificationOutbox.IgnoreQueryFilters().SingleAsync()).TenantId);   // one outbox row, for the WA admin only
    }

    [Fact]
    public async Task CreateMyUnavailability_UnscopedSuperAdmin_SavesTheRuleInTheStaffUsersOrganisation()
    {
        var f = await Unscoped(ShiftStatus.Published);

        var result = await f.Controller.CreateMyUnavailability(new CreateRecurringUnavailabilityDto
        {
            DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = new DateOnly(2026, 8, 3),
        }, default);

        Assert.Equal(201, ((ObjectResult)result.Result!).StatusCode);
        Assert.Equal(WaOrg, (await f.Db.RecurringUnavailabilities.IgnoreQueryFilters().SingleAsync()).TenantId);
    }
}
