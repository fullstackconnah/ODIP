using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Tasks;

/// <summary>
/// Review follow-up to <see cref="ProviderTodayRemainingSitesTests"/>: four more provider-date sites that decide what a user SEES (which service
/// bookings are active, which trips the schedule shows, which shifts the portal lists, whether a contact can be added), each pinned where the UTC date and the provider's differ.
/// Clock: 2026-10-02 22:00Z = Sat 3 Oct 08:00 AEST, no ProviderSettings row (Sydney, the production default).
/// </summary>
public class ProviderTodayVisibleStateTests
{
    private static readonly DateOnly Oct2 = new(2026, 10, 2);

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static FakeClock Clock => FakeClock.AtUtc(2026, 10, 2, 22, 0);

    [Fact]
    public async Task ActiveOnlyServiceBookings_DropsABookingWhoseClaimWindowClosedOnTheUtcDateButNotYetBeforeSydneyToday()
    {
        using var db = CreateDb();
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var source = new FundingSource { Id = Guid.NewGuid(), ParticipantId = participant.Id, RouteType = FundingRouteType.AgencyManaged, IsActive = true };
        db.Participants.Add(participant);
        db.FundingSources.Add(source);
        var closedYesterdayInSydney = new ServiceBooking { Id = Guid.NewGuid(), FundingSourceId = source.Id, ProdaBookingReference = "B-OLD", StartDate = new DateOnly(2026, 1, 1), EndDate = Oct2, ClaimWindowDays = 0 };
        var closesToday = new ServiceBooking { Id = Guid.NewGuid(), FundingSourceId = source.Id, ProdaBookingReference = "B-TODAY", StartDate = new DateOnly(2026, 1, 1), EndDate = new DateOnly(2026, 10, 3), ClaimWindowDays = 0 };
        db.ServiceBookings.AddRange(closedYesterdayInSydney, closesToday);
        db.SaveChanges();

        var result = await new BillingController(db, Clock).GetServiceBookings(null, activeOnly: true, ct: CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ServiceBookingListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([closesToday.Id], body.Data!.Items.Select(b => b.Id));
    }

    [Fact]
    public async Task TheScheduleDefaultWindow_StartsThreeMonthsBeforeTheProviderDate()
    {
        using var db = CreateDb();
        // Window start is Sat 3 Jul in Sydney (Fri 2 Jul if the UTC date were used): a one-day trip on 2 Jul is outside it, one on 3 Jul is inside.
        var before = new TripInstance { Id = Guid.NewGuid(), TripName = "Before the window", StartDate = new DateOnly(2026, 7, 2), DurationDays = 1, Status = TripStatus.Confirmed };
        var inside = new TripInstance { Id = Guid.NewGuid(), TripName = "First day of the window", StartDate = new DateOnly(2026, 7, 3), DurationDays = 1, Status = TripStatus.Confirmed };
        db.TripInstances.AddRange(before, inside);
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db), new StaffAvailabilityItemsQuery(db), Clock);
        var result = await controller.GetScheduleOverview(null, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([inside.Id], body.Data!.Trips.Select(t => t.Id));
    }

    [Theory]
    [InlineData(2008, 10, 3, true)]    // turns 18 today in Sydney (still 17 by the UTC date)
    [InlineData(2008, 10, 4, false)]   // turns 18 tomorrow in Sydney
    public async Task ContactRoles_PlanNomineeIsAllowedFromTheParticipantsEighteenthBirthdayInTheProviderCalendar(int year, int month, int day, bool allowed)
    {
        using var db = CreateDb();
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, PlanType = PlanType.SelfManaged, DateOfBirth = new DateOnly(year, month, day) };
        db.Participants.Add(participant);
        db.SaveChanges();
        var dto = new CreateParticipantContactRoleDto { NewPersonFirstName = "Denise", NewPersonLastName = "Wilson", RoleType = ContactRoleType.PlanNominee };

        var result = await new ParticipantContactRolesController(db, Clock).Create(participant.Id, dto, CancellationToken.None);

        if (allowed) Assert.IsType<OkObjectResult>(result.Result);
        else Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task MyShifts_DefaultWindowStartsOnTheProviderDate_SoYesterdayInSydneyIsNotListed()
    {
        using var db = CreateDb();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var worker = new User { Id = Guid.NewGuid(), Email = "ben@example.com", Username = "ben", FirstName = "Ben", LastName = "Turner", Role = UserRole.SupportWorker, IsActive = true };
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Users.Add(worker);
        db.Participants.Add(participant);
        Shift ShiftOn(DateOnly day) => new()
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = worker.Id, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published,
        };
        var yesterdayInSydney = ShiftOn(Oct2);
        var todayInSydney = ShiftOn(new DateOnly(2026, 10, 3));
        db.Shifts.AddRange(yesterdayInSydney, todayInSydney);
        db.SaveChanges();
        var controller = new PortalController(db, tenant.Object, clock: Clock)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, worker.Id.ToString())], "Test")) },
            },
        };

        var result = await controller.GetMyShifts(null, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([todayInSydney.Id], body.Data!.Shifts.Select(x => x.Id));
    }
}
