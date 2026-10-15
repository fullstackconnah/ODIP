using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Intake.IntakeBookingsControllerTests;

namespace Odip.Tests.Intake;

/// <summary>The intake visits the schedule views read: the provider-local date range, the order, the names, and who may see whose visits.</summary>
public class IntakeVisitsTests
{
    private static readonly DateOnly Oct16 = new(2026, 10, 16);

    // A second enquiry booked straight into the table, for Dana, on Sat 17 Oct at 9:00 am in Sydney.
    private static ParticipantInquiry BookAva(Fixture f, Guid staffId, Guid? tenantId = null)
    {
        var ava = new ParticipantInquiry
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? f.TenantId, FirstName = "Ava", LastName = "Ng", Source = "Web", Email = "ava@example.com",
            IntakeStartsAt = new DateTime(2026, 10, 16, 22, 0, 0, DateTimeKind.Utc), IntakeDurationMinutes = 60, IntakeLocation = "Library",
            IntakeStaffUserId = staffId, IntakeUid = "ava@odip",
        };
        f.Db.ParticipantInquiries.Add(ava);
        f.Db.SaveChanges();
        return ava;
    }

    private static List<IntakeVisitDto> Visits(ActionResult<ApiResponse<List<IntakeVisitDto>>> result) => Ok<List<IntakeVisitDto>>(result.Result!);

    [Fact]
    public async Task A_coordinator_sees_everyones_visits_in_the_range_soonest_first()
    {
        var f = new Fixture();
        await f.BookAsync();
        BookAva(f, f.Dana.Id);

        var visits = Visits(await f.Controller().Visits(Oct16, Oct16.AddDays(1), null, CancellationToken.None));

        Assert.Equal(new[] { "Noah", "Ava" }, visits.Select(v => v.FirstName).ToArray());
        var noah = visits[0];
        Assert.Equal((Start, 90, "12 Smith St, Parramatta", f.Sam.Id, "Sam Lee"), (noah.StartsAt, noah.DurationMinutes, noah.Location, noah.StaffUserId, noah.StaffName));
        Assert.Equal("Australia/Sydney", noah.TimeZoneId);
        Assert.Null(noah.ParticipantId);
    }

    // Noah's visit is Fri 16 Oct 10:00 am in Sydney, which is still 15 Oct in UTC: the range is in the PROVIDER's dates.
    [Fact]
    public async Task The_range_is_in_the_providers_local_dates_not_utc()
    {
        var f = new Fixture();
        await f.BookAsync();

        Assert.Single(Visits(await f.Controller().Visits(Oct16, Oct16, null, CancellationToken.None)));
        Assert.Empty(Visits(await f.Controller().Visits(Oct16.AddDays(-1), Oct16.AddDays(-1), null, CancellationToken.None)));
    }

    [Fact]
    public async Task With_no_range_it_runs_from_the_providers_today()
    {
        var f = new Fixture();
        await f.BookAsync();

        Assert.Single(Visits(await f.Controller().Visits(null, null, null, CancellationToken.None)));
        Assert.Empty(Visits(await f.Controller(now: Start.AddDays(2)).Visits(null, null, null, CancellationToken.None)));
    }

    [Fact]
    public async Task A_staff_filter_returns_only_that_persons_visits()
    {
        var f = new Fixture();
        await f.BookAsync();
        BookAva(f, f.Dana.Id);

        var visits = Visits(await f.Controller().Visits(Oct16, Oct16.AddDays(1), f.Dana.Id, CancellationToken.None));

        Assert.Equal("Ava", Assert.Single(visits).FirstName);
    }

    // The location is often a home address. A role outside the lifecycle (Sam, moved to support worker after the booking) sees their own visits only.
    [Fact]
    public async Task Any_other_role_sees_only_their_own_visits_and_cannot_ask_for_someone_elses()
    {
        var f = new Fixture();
        await f.BookAsync();
        BookAva(f, f.Dana.Id);
        f.Db.Users.Single(u => u.Id == f.Sam.Id).Role = UserRole.SupportWorker;
        f.Db.SaveChanges();
        var asSam = f.Controller(role: "SupportWorker", userId: f.Sam.Id);

        var own = Visits(await asSam.Visits(Oct16, Oct16.AddDays(1), null, CancellationToken.None));
        var forbidden = await asSam.Visits(Oct16, Oct16.AddDays(1), f.Dana.Id, CancellationToken.None);

        Assert.Equal("Noah", Assert.Single(own).FirstName);
        Assert.Equal(403, Assert.IsAssignableFrom<ObjectResult>(forbidden.Result).StatusCode);
    }

    [Fact]
    public async Task Another_organisations_visit_is_never_returned()
    {
        var f = new Fixture();
        await f.BookAsync();
        var otherTenant = Guid.NewGuid();
        var kim = f.Staff("Kim", "Other", UserRole.Coordinator, tenantId: otherTenant);
        f.Db.Users.Add(kim);
        BookAva(f, kim.Id, otherTenant);

        var visits = Visits(await f.Controller().Visits(Oct16, Oct16.AddDays(1), null, CancellationToken.None));
        var asked = Visits(await f.Controller().Visits(Oct16, Oct16.AddDays(1), kim.Id, CancellationToken.None));

        Assert.Equal("Noah", Assert.Single(visits).FirstName);
        Assert.Empty(asked);
    }

    [Fact]
    public async Task Without_a_tenant_context_there_is_nothing_to_show()
    {
        var f = new Fixture();
        await f.BookAsync();

        Assert.Empty(Visits(await f.Controller(noTenant: true).Visits(null, null, null, CancellationToken.None)));
    }
}
