using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Bookings;

/// <summary>
/// Confirming a participant's trip booking says what it does to their budget (budget phase 3), as a warning in the response of the write that confirms it, and never refuses anything, in any mode. Fixed clock:
/// 4 Oct 2026. A three-day trip from 20 Oct at 8 active hours a day in NSW is $1,440; the October to December period holds $1,000.
/// </summary>
public class BookingsBudgetWarningTests : IDisposable
{
    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<string> Entries { get; } = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => Entries.Add(formatter(state, exception) + exception);
    }

    private readonly LedgerKit _kit = LedgerKit.Create();
    private readonly ListLogger<BookingsController> _log = new();
    public void Dispose() => _kit.Dispose();

    private (BookingsController Controller, Participant Participant, TripInstance Trip) Rig(decimal october = 1000m, BudgetLimitMode mode = BudgetLimitMode.Warn, bool withTenant = true)
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant();
        _kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, october), LedgerKit.Q(3, 5000m)));
        var trip = _kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        if (mode != BudgetSettings.DefaultMode)
        {
            _kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = _kit.TenantId, Mode = mode });
            _kit.Db.SaveChanges();
        }
        return (new BookingsController(_kit.Db, _kit.Clock, withTenant ? _kit.Tenant : null, logger: _log), participant, trip);
    }

    private static CreateBookingDto NewBooking(Participant participant, TripInstance trip, BookingStatus status) =>
        new() { ParticipantId = participant.Id, TripInstanceId = trip.Id, BookingStatus = status };

    private static UpdateBookingDto Edit(ParticipantBooking booking, BookingStatus status, string? notes = null) =>
        new() { ParticipantId = booking.ParticipantId, TripInstanceId = booking.TripInstanceId, BookingStatus = status, BookingNotes = notes };

    private static BookingDetailDto Created(ActionResult<ApiResponse<BookingDetailDto>> result) =>
        ((ApiResponse<BookingDetailDto>)Assert.IsType<CreatedAtActionResult>(result.Result).Value!).Data!;

    private static BookingDetailDto Ok(ActionResult<ApiResponse<BookingDetailDto>> result) =>
        ((ApiResponse<BookingDetailDto>)Assert.IsType<OkObjectResult>(result.Result).Value!).Data!;

    private ParticipantBooking Saved(Guid id) => _kit.Db.ParticipantBookings.Single(b => b.Id == id);

    [Fact]
    public async Task ABookingCreatedConfirmed_ThatTakesThePoolPastItsFunding_CarriesAWarning()
    {
        var (controller, participant, trip) = Rig();

        var booking = Created(await controller.Create(NewBooking(participant, trip, BookingStatus.Confirmed), default));

        var warning = Assert.Single(booking.BudgetWarnings!);
        Assert.Equal("This booking takes Core (flexible) to $1,440.00 of $1,000.00 for 1 Oct\u00A0\u2013\u2060\u00A031 Dec 2026, $440.00 over.", warning.Message);
        Assert.Equal("Sophie Brown", warning.ParticipantName);
        Assert.Equal((1440m, 440m), (warning.Added, warning.OverBy));
        Assert.Equal(BookingStatus.Confirmed, Saved(booking.Id).BookingStatus);   // never refused
    }

    [Fact]
    public async Task ABookingThatIsNotConfirmed_SaysNothing_UntilTheWriteThatConfirmsIt()
    {
        var (controller, participant, trip) = Rig();
        var held = Created(await controller.Create(NewBooking(participant, trip, BookingStatus.Held), default));
        Assert.Null(held.BudgetWarnings);

        var confirmed = ((ApiResponse<BookingDetailDto>)Assert.IsType<OkObjectResult>((await controller.Patch(held.Id, new PatchBookingDto { BookingStatus = BookingStatus.Confirmed }, default)).Result).Value!).Data!;

        Assert.Equal(BookingStatus.Confirmed, confirmed.BookingStatus);
        Assert.Single(confirmed.BudgetWarnings!);
    }

    [Fact]
    public async Task APutThatConfirmsIt_CarriesTheWarning_ButOneThatEditsAnAlreadyConfirmedBookingDoesNot()
    {
        var (controller, participant, trip) = Rig();
        var held = Created(await controller.Create(NewBooking(participant, trip, BookingStatus.Held), default));
        var booking = Saved(held.Id);

        var confirming = Ok(await controller.Update(held.Id, Edit(booking, BookingStatus.Confirmed), default));
        var editing = Ok(await controller.Update(held.Id, Edit(booking, BookingStatus.Confirmed, notes: "bring the swimming bag"), default));

        Assert.Single(confirming.BudgetWarnings!);
        Assert.Null(editing.BudgetWarnings);
    }

    [Fact]
    public async Task APatchThatDoesNotConfirm_OrChangesOnlyTheInsurance_SaysNothing()
    {
        var (controller, participant, trip) = Rig();
        var confirmed = Created(await controller.Create(NewBooking(participant, trip, BookingStatus.Confirmed), default));

        var insurance = Ok(await controller.Patch(confirmed.Id, new PatchBookingDto { InsuranceStatus = InsuranceStatus.Confirmed }, default));
        var cancelled = Ok(await controller.Patch(confirmed.Id, new PatchBookingDto { BookingStatus = BookingStatus.Cancelled }, default));

        Assert.Null(insurance.BudgetWarnings);   // already confirmed: said when it was
        Assert.Null(cancelled.BudgetWarnings);
        Assert.Equal(BookingStatus.Cancelled, cancelled.BookingStatus);
    }

    [Fact]
    public async Task UnderAHardLimit_ConfirmingIsStillNeverBlocked_ItOnlyWarns()
    {
        var (controller, participant, trip) = Rig(mode: BudgetLimitMode.HardLimit);

        var booking = Created(await controller.Create(NewBooking(participant, trip, BookingStatus.Confirmed), default));

        Assert.Single(booking.BudgetWarnings!);
        Assert.Equal(BookingStatus.Confirmed, Saved(booking.Id).BookingStatus);
    }

    [Fact]
    public async Task AConfirmedBookingWithinTheFunding_OrWithNoOrganisationOnTheRequest_HasNoWarning()
    {
        var (roomy, participant, trip) = Rig(october: 5000m);
        Assert.Null(Created(await roomy.Create(NewBooking(participant, trip, BookingStatus.Confirmed), default)).BudgetWarnings);

        using var other = LedgerKit.Create();
        other.SeedProvider("NSW");
        other.SeedCommunityAccessCatalogue();
        var tight = other.SeedParticipant();
        other.SeedPlan(tight, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 100m)));
        var otherTrip = other.SeedTrip(new DateOnly(2026, 10, 20), 3);
        var untenanted = new BookingsController(other.Db, other.Clock);
        Assert.Null(Created(await untenanted.Create(NewBooking(tight, otherTrip, BookingStatus.Confirmed), default)).BudgetWarnings);
    }

    [Fact]
    public async Task AWarningThatCannotBeWorkedOut_IsLogged_AndTheBookingIsStillConfirmed()
    {
        var (_, participant, trip) = Rig();
        var broken = LedgerKit.Create();
        broken.Dispose();   // every query on it now throws
        var controller = new BookingsController(_kit.Db, _kit.Clock, _kit.Tenant, new Odip.Infrastructure.Services.ShiftBudgetEffect(broken.Db, broken.Ledger), _log);

        var booking = Created(await controller.Create(NewBooking(participant, trip, BookingStatus.Confirmed), default));

        Assert.Null(booking.BudgetWarnings);
        Assert.Equal(BookingStatus.Confirmed, Saved(booking.Id).BookingStatus);
        Assert.Contains(_log.Entries, e => e.Contains("could not be worked out"));
    }
}
