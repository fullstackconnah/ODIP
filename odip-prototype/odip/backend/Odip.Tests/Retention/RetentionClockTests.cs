using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Retention;
using Odip.Infrastructure.Services;
using Odip.Tests.Claims;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Retention;

/// <summary>The 7-year clock: what starts it, what stops it, what pushes it out, and when it comes due in the provider's own zone.</summary>
public class RetentionClockTests
{
    private static readonly DateOnly Archived = new(2019, 3, 10);
    private static readonly DateTimeOffset Now = new(2026, 11, 5, 3, 0, 0, TimeSpan.Zero); // 14:00 in Sydney

    private static (OdipDbContext Db, Guid TenantId, FixedClock Clock) Rig(string state = "NSW")
    {
        var tenantId = Guid.NewGuid();
        var db = TestDb.Create();
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Alpha", EmailDomain = $"{tenantId:N}.example.com" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = state });
        db.SaveChanges();
        return (db, tenantId, new FixedClock(Now));
    }

    private static Participant Archive(OdipDbContext db, Guid tenantId, DateOnly? startsOn, bool draft = false)
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = Guid.NewGuid().ToString("N")[..11], PlanType = PlanType.SelfManaged,
            IsActive = false, IsDraft = draft, RetentionStartsOn = startsOn,
        };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static ParticipantsController Controller(OdipDbContext db, FixedClock clock) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db), clock: clock)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")) } },
        };

    private static Task<RetentionClock.RetentionStatus?> Status(OdipDbContext db, Guid tenantId, Participant p, FixedClock clock) =>
        RetentionClock.StatusAsync(db, tenantId, p.Id, clock, CancellationToken.None);

    [Fact]
    public async Task Archiving_through_the_status_endpoint_starts_the_clock_on_the_providers_date()
    {
        var (db, tenantId, clock) = Rig();
        var p = Archive(db, tenantId, null);
        p.IsActive = true; p.RetentionStartEstimated = true; db.SaveChanges();

        await Controller(db, clock).ChangeStatus(p.Id, new ChangeParticipantStatusDto { IsActive = false }, CancellationToken.None);

        var saved = await db.Participants.SingleAsync();
        Assert.Equal(new DateOnly(2026, 11, 5), saved.RetentionStartsOn);
        Assert.False(saved.RetentionStartEstimated);
    }

    [Fact]
    public async Task Archiving_late_in_the_UTC_day_uses_the_providers_next_day()
    {
        var (db, tenantId, _) = Rig();
        var p = Archive(db, tenantId, null);
        p.IsActive = true; db.SaveChanges();

        await Controller(db, new FixedClock(new DateTimeOffset(2026, 11, 5, 15, 30, 0, TimeSpan.Zero))).ChangeStatus(p.Id, new ChangeParticipantStatusDto { IsActive = false }, CancellationToken.None);

        Assert.Equal(new DateOnly(2026, 11, 6), (await db.Participants.SingleAsync()).RetentionStartsOn);
    }

    [Fact]
    public async Task The_delete_route_starts_the_clock_and_archiving_again_does_not_restart_it()
    {
        var (db, tenantId, clock) = Rig();
        var p = Archive(db, tenantId, null);
        p.IsActive = true; db.SaveChanges();
        var controller = Controller(db, clock);

        await controller.Delete(p.Id, CancellationToken.None);
        Assert.Equal(new DateOnly(2026, 11, 5), (await db.Participants.SingleAsync()).RetentionStartsOn);

        clock.Now = Now.AddDays(30);
        await controller.Delete(p.Id, CancellationToken.None);
        Assert.Equal(new DateOnly(2026, 11, 5), (await db.Participants.SingleAsync()).RetentionStartsOn);
    }

    [Fact]
    public void Restoring_clears_the_start_and_the_estimate()
    {
        var p = new Participant { RetentionStartsOn = Archived, RetentionStartEstimated = true, IsActive = false };
        RetentionClock.OnActiveChanged(p, true);
        Assert.Null(p.RetentionStartsOn);
        Assert.False(p.RetentionStartEstimated);
    }

    [Fact]
    public async Task The_effective_start_is_the_stored_date_and_a_draft_or_an_active_participant_has_none()
    {
        var (db, tenantId, clock) = Rig();
        var archived = Archive(db, tenantId, Archived);
        var draft = Archive(db, tenantId, Archived, draft: true);
        var active = Archive(db, tenantId, null);
        active.IsActive = true; db.SaveChanges();

        Assert.Equal(Archived, (await Status(db, tenantId, archived, clock))!.Start);
        Assert.Null(await Status(db, tenantId, draft, clock));
        Assert.Null(await Status(db, tenantId, active, clock));
    }

    [Fact]
    public async Task A_later_shift_pushes_the_start_out()
    {
        var (db, tenantId, clock) = Rig();
        var p = Archive(db, tenantId, Archived);
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, UserId = Guid.NewGuid(), ServiceDate = new DateOnly(2021, 6, 1), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(10, 0) });
        db.SaveChanges();

        Assert.Equal(new DateOnly(2021, 6, 1), (await Status(db, tenantId, p, clock))!.Start);
    }

    [Fact]
    public async Task A_later_claim_line_and_a_claim_made_after_the_archive_both_push_the_start_out()
    {
        var (db, tenantId, clock) = Rig();
        var p = Archive(db, tenantId, Archived);
        var claim = new TripClaim { TenantId = tenantId, Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = p.Id, ClaimReference = "SC-1", TotalAmount = 1m, CreatedAt = new DateTime(2020, 1, 5, 1, 0, 0, DateTimeKind.Utc) };
        var line = new ClaimLineItem
        {
            TenantId = tenantId, Id = Guid.NewGuid(), TripClaimId = claim.Id, SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2022, 2, 1), SupportsDeliveredTo = new DateOnly(2022, 2, 3), Hours = 1m, UnitPrice = 1m, TotalAmount = 1m,
        };
        db.AddRange(claim, line);
        db.SaveChanges();
        Assert.Equal(new DateOnly(2022, 2, 3), (await Status(db, tenantId, p, clock))!.Start);

        // Created after the archive for earlier services: the claim's own date counts.
        claim.CreatedAt = new DateTime(2023, 4, 1, 1, 0, 0, DateTimeKind.Utc);
        db.SaveChanges();
        Assert.Equal(new DateOnly(2023, 4, 1), (await Status(db, tenantId, p, clock))!.Start);
    }

    [Fact]
    public async Task A_later_trip_end_through_a_booking_and_a_later_incident_push_the_start_out()
    {
        var (db, tenantId, clock) = Rig();
        var p = Archive(db, tenantId, Archived);
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2021, 1, 1), DurationDays = 5 };
        db.AddRange(trip, new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = p.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2020, 12, 1) });
        db.SaveChanges();
        Assert.Equal(new DateOnly(2021, 1, 5), (await Status(db, tenantId, p, clock))!.Start);

        db.IncidentReports.Add(new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = Guid.NewGuid(), InvolvedParticipantId = p.Id, IncidentType = IncidentType.Other, OtherTypeSpecify = "x",
            Severity = IncidentSeverity.Low, Title = "Fall", Description = "Slipped", IncidentDateTime = new DateTime(2022, 9, 9, 9, 0, 0, DateTimeKind.Utc),
        });
        db.SaveChanges();
        Assert.True((await Status(db, tenantId, p, clock))!.Start >= new DateOnly(2022, 9, 9));
    }

    [Theory]
    [InlineData(2026, 3, 9, false)]
    [InlineData(2026, 3, 10, true)]
    public async Task Seven_years_on_is_due_on_the_day_and_not_the_day_before(int y, int m, int d, bool due)
    {
        var (db, tenantId, _) = Rig("QLD"); // no daylight saving: 03:00 UTC is 13:00 that day
        var p = Archive(db, tenantId, Archived);
        var status = (await Status(db, tenantId, p, new FixedClock(new DateTimeOffset(y, m, d, 3, 0, 0, TimeSpan.Zero))))!;
        Assert.Equal(new DateOnly(2026, 3, 10), status.DueOn);
        Assert.Equal(due, status.Due);
    }

    [Fact]
    public void A_29_February_start_comes_due_on_28_February_seven_years_on()
    {
        Assert.Equal(new DateOnly(2027, 2, 28), RetentionClock.DueOn(new DateOnly(2020, 2, 29)));
        Assert.True(RetentionClock.IsDue(new DateOnly(2020, 2, 29), new DateOnly(2027, 2, 28)));
        Assert.False(RetentionClock.IsDue(new DateOnly(2020, 2, 29), new DateOnly(2027, 2, 27)));
    }

    [Fact]
    public async Task The_same_instant_is_the_due_day_in_Sydney_but_not_yet_in_Perth()
    {
        // 15:30 UTC on 9 March 2026 is 02:30 on 10 March in Sydney (AEDT, +11) and 23:30 on 9 March in Perth (+8).
        var (db, nsw, _) = Rig("NSW");
        var wa = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = wa, Name = "West", EmailDomain = $"{wa:N}.example.com" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = wa, State = "WA" });
        db.SaveChanges();
        var inNsw = Archive(db, nsw, Archived);
        var inWa = Archive(db, wa, Archived);

        var split = new FixedClock(new DateTimeOffset(2026, 3, 9, 15, 30, 0, TimeSpan.Zero));
        Assert.True((await Status(db, nsw, inNsw, split))!.Due);
        Assert.False((await Status(db, wa, inWa, split))!.Due);
    }
}
