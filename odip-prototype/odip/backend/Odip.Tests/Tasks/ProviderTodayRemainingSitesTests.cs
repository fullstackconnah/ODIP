using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Tasks;

/// <summary>
/// The server's remaining UTC "today" sites (Fix B left them; each was wrong between local midnight and 10:00 Sydney time, 11:00 in daylight
/// time). Three groups, each pinned with a clock fixed where the UTC date and the provider's date differ, with no ProviderSettings row so the
/// provider is in Sydney (the production default):
///   1. a COMPLETION date stamped on a task (the insurance task);
///   2. a due date of "today + N" (the claims task, +7);
///   3. a default "today" or window (a booking's date, the roster's default week, a credential's expiry).
///
/// Clock used: 2026-10-02 22:00Z = Sat 3 Oct 08:00 AEST, so the UTC date is Fri 2 Oct and Sydney's is Sat 3 Oct.
/// For the roster's default week: 2026-07-12 20:00Z = Mon 13 Jul 06:00 AEST, UTC is still Sun 12 Jul (the week before). It is a past date on purpose, so a controller that ignores the clock cannot pass by luck.
/// </summary>
public class ProviderTodayRemainingSitesTests
{
    private static readonly DateOnly Oct2 = new(2026, 10, 2);
    private static readonly DateOnly Oct3 = new(2026, 10, 3);

    private static OdipDbContext CreateDb() => TestDb.Create();

    private static TripInstance SeedTrip(OdipDbContext db, TripStatus status = TripStatus.Planning)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Gold Coast Beach Break", StartDate = new DateOnly(2026, 12, 1), DurationDays = 3, Status = status };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, IsDraft = false, IntakeCompletedAt = DateTime.UtcNow };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    // ── 1. A completion date ─────────────────────────────────────────────

    [Fact]
    public async Task CreatingABookingWithInsuranceAlreadyConfirmed_StampsTheInsuranceTaskWithTheProviderDate_NotTheUtcDate()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        var participant = SeedParticipant(db);
        var controller = new BookingsController(db, FakeClock.AtUtc(2026, 10, 2, 22, 0));

        await controller.Create(new CreateBookingDto
        {
            TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, InsuranceStatus = InsuranceStatus.Confirmed,
        }, CancellationToken.None);

        var task = await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.InsuranceConfirmation);
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(Oct3, task.CompletedDate);
    }

    [Fact]
    public async Task ConfirmingInsuranceOnAnExistingBooking_CompletesTheTaskOnTheProviderDate()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        var participant = SeedParticipant(db);
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, InsuranceStatus = InsuranceStatus.Pending };
        db.ParticipantBookings.Add(booking);
        db.BookingTasks.Add(new BookingTask
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantBookingId = booking.Id, TaskType = TaskType.InsuranceConfirmation,
            Title = "Confirm travel insurance", Status = TaskItemStatus.NotStarted,
        });
        await db.SaveChangesAsync();
        var controller = new BookingsController(db, FakeClock.AtUtc(2026, 10, 2, 22, 0));

        await controller.Update(booking.Id, new UpdateBookingDto
        {
            TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, InsuranceStatus = InsuranceStatus.Confirmed,
        }, CancellationToken.None);

        var task = await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.InsuranceConfirmation);
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(Oct3, task.CompletedDate);
    }

    // ── 2. A due date of "today + N" ─────────────────────────────────────

    [Fact]
    public async Task CompletingATrip_RaisesTheClaimsTaskDueSevenDaysAfterTheProviderDate()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db, TripStatus.InProgress);
        var controller = new TripsController(db, Mock.Of<ILogger<TripsController>>(), FakeClock.AtUtc(2026, 10, 2, 22, 0));

        var result = await controller.Patch(trip.Id, new PatchTripDto { Status = TripStatus.Completed }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var task = await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.GenerateNdisClaims);
        Assert.Equal(Oct3.AddDays(7), task.DueDate);   // not Oct 2 + 7
    }

    // ── 3. A default "today" or window ───────────────────────────────────

    [Fact]
    public async Task ABookingWithNoBookingDate_IsDatedWithTheProviderToday()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        var participant = SeedParticipant(db);
        var controller = new BookingsController(db, FakeClock.AtUtc(2026, 10, 2, 22, 0));

        await controller.Create(new CreateBookingDto { TripInstanceId = trip.Id, ParticipantId = participant.Id }, CancellationToken.None);

        Assert.Equal(Oct3, (await db.ParticipantBookings.SingleAsync()).BookingDate);
    }

    [Fact]
    public async Task TheRosterBoardOpensOnTheProviderWeek_NotTheWeekTheUtcDateIsIn()
    {
        using var db = CreateDb();
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: FakeClock.AtUtc(2026, 7, 12, 20, 0));

        var result = await controller.GetBoard(null, "participant", CancellationToken.None);

        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(new DateOnly(2026, 7, 13), board.WeekStart);   // Monday in Sydney; the UTC date (Sun 12 Jul) would open the week before
    }

    [Fact]
    public async Task ACredentialThatExpiredYesterdayInSydney_IsFlaggedExpiredFromSydneyMidnight()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb();
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, Username = "screened.worker", Email = "screened.worker@example.com", FirstName = "Screened", LastName = "Worker",
            IsActive = true, WorkerScreeningNumber = "WWCC-1", WorkerScreeningExpiryDate = Oct2,   // yesterday in Sydney, today by the UTC date
        });
        await db.SaveChangesAsync();
        var controller = new StaffController(db, clock: FakeClock.AtUtc(2026, 10, 2, 22, 0));

        var result = await controller.GetAll(null, CancellationToken.None);

        var staff = Assert.Single(Assert.IsType<ApiResponse<List<StaffListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!);
        Assert.True(staff.HasExpiredQualifications);
    }
}
