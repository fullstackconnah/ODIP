using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// Builders for the invoice tests (Xero PR1): an InMemory context scoped like the caller (an organisation, or a SuperAdmin with or without one),
/// a fixed clock, providers, participants, trips and claims whose lines carry stored 2dp values, and a ClaimsController signed in as a role.
/// </summary>
internal sealed class InvoiceKit
{
    public static readonly Guid TenantA = Guid.NewGuid();
    public static readonly Guid TenantB = Guid.NewGuid();
    public static readonly Guid ActorId = Guid.NewGuid();
    /// <summary>13:30 UTC on 22 Oct 2026 is 00:30 on 23 Oct in Sydney (UTC+11).</summary>
    public static readonly DateTimeOffset Now = new(2026, 10, 22, 13, 30, 0, TimeSpan.Zero);

    public OdipDbContext Db { get; }
    public Guid TenantId { get; }
    public FixedClock Clock { get; }
    private readonly ICurrentTenant _tenant;

    private InvoiceKit(OdipDbContext db, Guid tenantId, ICurrentTenant tenant, FixedClock clock) { Db = db; TenantId = tenantId; _tenant = tenant; Clock = clock; }

    /// <param name="tenantId">The organisation in scope (null: none, a SuperAdmin not viewing as one).</param>
    public static InvoiceKit Create(Guid? tenantId = null, bool superAdmin = false, bool noTenant = false, string? database = null, DateTimeOffset? now = null)
    {
        var id = noTenant ? (Guid?)null : tenantId ?? TenantA;
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(id);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(database ?? Guid.NewGuid().ToString()).Options, tenant.Object);
        return new InvoiceKit(db, id ?? TenantA, tenant.Object, new FixedClock(now ?? Now));
    }

    public InvoiceService Service => new(Db);

    public ClaimsController Controller(string role = "Admin")
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, ActorId.ToString()), new Claim("fullName", "Ada Admin"), new Claim(ClaimTypes.Role, role)], "Test"));
        return new ClaimsController(Db, new ClaimGenerationService(Db), new ShiftClaimGenerationService(Db), new BprCsvService(Db), new InvoiceService(Db), new BudgetLedgerService(Db, Clock), _tenant, Clock)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } },
        };
    }

    public ProviderSettings Settings(Guid? tenantId = null, string abn = "12345678901", string state = "NSW", bool gst = false, string? bsb = null, string? account = null, int start = 1)
    {
        var s = new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId, RegistrationNumber = "PR001", ABN = abn, OrganisationName = "Test Provider", Address = "1 Test St", State = state,
            GSTRegistered = gst, BSB = bsb, AccountNumber = account, BankAccountName = bsb != null ? "Test Provider Pty Ltd" : null, InvoiceStartNumber = start,
        };
        Db.ProviderSettings.Add(s);
        Db.SaveChanges();
        return s;
    }

    public Participant Person(string first, string last, PlanType planType, Guid? tenantId = null, Contact? planManager = null)
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId, FirstName = first, LastName = last, IsActive = true, PlanType = planType, NdisNumber = "430100" + Random.Shared.Next(100, 999),
            PlanManagerContact = planManager, PlanManagerContactId = planManager?.Id,
        };
        Db.Participants.Add(p);
        Db.SaveChanges();
        return p;
    }

    public static Contact PlanManager(string address = "2 Plan St", string organisation = "Plan Co") =>
        new() { Id = Guid.NewGuid(), FirstName = "Pat", LastName = "Manager", Organisation = organisation, Address = address, Suburb = "Sydney", State = "NSW", Postcode = "2000", Email = "pat@plan.example" };

    public TripInstance Trip(Guid? tenantId = null, string name = "Coastal weekend")
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId, TripName = name, StartDate = new DateOnly(2026, 10, 3), DurationDays = 2 };
        Db.TripInstances.Add(trip);
        Db.SaveChanges();
        return trip;
    }

    public ParticipantBooking Book(TripInstance trip, Participant participant, PlanType? planTypeOverride = null)
    {
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, PlanTypeOverride = planTypeOverride };
        Db.ParticipantBookings.Add(booking);
        Db.SaveChanges();
        return booking;
    }

    /// <summary>A trip claim with one line per entry: hours x price stored as the given 2dp total.</summary>
    public TripClaim TripClaim(TripInstance trip, TripClaimStatus status, params (ParticipantBooking Booking, decimal Hours, decimal Price, decimal Total, GSTCode Gst)[] lines)
    {
        var claim = new TripClaim { TenantId = trip.TenantId, Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = status, ClaimReference = RandomReference(), TotalAmount = lines.Sum(l => l.Total) };
        Db.TripClaims.Add(claim);
        foreach (var l in lines)
            Db.ClaimLineItems.Add(new ClaimLineItem
            {
                TenantId = claim.TenantId,
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = l.Booking.Id, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = new DateOnly(2026, 10, 3), SupportsDeliveredTo = new DateOnly(2026, 10, 4), Hours = l.Hours, UnitPrice = l.Price, TotalAmount = l.Total, GSTCode = l.Gst,
            });
        Db.SaveChanges();
        return claim;
    }

    /// <summary>A trip claim with one $100 line (1 h x $100, GST-free) per booking.</summary>
    public TripClaim TripClaim(TripInstance trip, TripClaimStatus status, params ParticipantBooking[] bookings) =>
        TripClaim(trip, status, bookings.Select(b => (b, 1m, 100m, 100m, GSTCode.P2)).ToArray());

    /// <summary>A shift claim for the participant, 1 to 14 Oct 2026, with one line per total.</summary>
    public TripClaim ShiftClaim(Participant participant, TripClaimStatus status, params decimal[] totals)
    {
        var claim = new TripClaim
        {
            TenantId = participant.TenantId,
            Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, PeriodFrom = new DateOnly(2026, 10, 1), PeriodTo = new DateOnly(2026, 10, 14),
            Status = status, ClaimReference = RandomReference(), TotalAmount = totals.Sum(),
        };
        Db.TripClaims.Add(claim);
        foreach (var total in totals)
            Db.ClaimLineItems.Add(new ClaimLineItem
            {
                TenantId = claim.TenantId,
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = new DateOnly(2026, 10, 2), SupportsDeliveredTo = new DateOnly(2026, 10, 2), Hours = 1m, UnitPrice = total, TotalAmount = total, GSTCode = GSTCode.P2,
            });
        Db.SaveChanges();
        return claim;
    }

    /// <summary>"TC-" and 8 digits. Digits only, because PDF text extraction ligatures letter pairs such as "fb"; short, because the legacy number (INV-, the reference, 8 hex) sits in a 170pt header column and a longer one wraps at a hyphen, so the extracted words interleave with the address.</summary>
    private static string RandomReference() => $"TC-{Random.Shared.Next(10_000_000, 99_999_999)}";

    public static int StatusOf<T>(ActionResult<ApiResponse<T>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode ?? 200;
    public static string RefusalOf<T>(ActionResult<ApiResponse<T>> r) => Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value).Errors!);
    public static T DataOf<T>(ActionResult<ApiResponse<T>> r) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;
}

internal sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>
/// The invoice tests that read PDF text run one at a time: run side by side in this process, a PDF's extracted text came back empty or short now and
/// then (seen locally on 2026-10-23), which a one-at-a-time run never showed.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class InvoicePdfs { public const string Name = "Invoice PDFs"; }
