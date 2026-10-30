using System.Security.Claims;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;

namespace Odip.Tests.ClaimBatches;

internal sealed class FixedClock(DateTime utc) : TimeProvider
{
    public DateTime Utc { get; set; } = utc;
    public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(Utc, DateTimeKind.Utc));
}

/// <summary>An organisation with a complete profile, the price guide row, and a helper to add claims whose lines pass every check.</summary>
internal sealed class BatchFixture : IDisposable
{
    public static readonly DateTime Now = new(2026, 10, 30, 2, 0, 0, DateTimeKind.Utc);
    public const string ItemCode = "04_104_0125_6_1";

    public Guid TenantId { get; } = Guid.NewGuid();
    public Guid OtherTenantId { get; } = Guid.NewGuid();
    public OdipDbContext Db { get; } = TestDb.Create();
    public FixedClock Clock { get; } = new(Now);
    public ClaimBatchService Service { get; }
    public ClaimsPrincipal User { get; } = new(new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Pat Planner")], "test"));

    private int _counter;

    public BatchFixture()
    {
        Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "4050012345", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "VIC" });
        Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ItemNumber = ItemCode, Description = "Community access", Unit = "H", PriceNational = 70m, PriceLimit_VIC = 70m,
            IsActive = true, EffectiveFrom = new DateOnly(2020, 1, 1),
        });
        Db.SaveChanges();
        Service = new ClaimBatchService(Db, new BprCsvService(Db), new InvoiceService(Db), Clock);
    }

    /// <summary>A claim of one participant with <paramref name="lines"/> draft lines, each on its own day ten days back or more.</summary>
    public (TripClaim Claim, List<ClaimLineItem> Lines, Participant Participant) AddClaim(
        int lines = 1, PlanType plan = PlanType.AgencyManaged, TripClaimStatus status = TripClaimStatus.Draft, ClaimLineItemStatus lineStatus = ClaimLineItemStatus.Draft,
        Guid? tenant = null, string? ndis = null)
    {
        var n = ++_counter;
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? TenantId, FirstName = "Amy" + n, LastName = "Ng", NdisNumber = ndis ?? $"43{n:D7}", PlanType = plan,
        };
        var claim = new TripClaim { Id = Guid.NewGuid(), ParticipantId = participant.Id, ClaimReference = $"TC-{n:D3}", Status = status, TotalAmount = 120m * lines };
        Db.Participants.Add(participant);
        Db.TripClaims.Add(claim);
        var made = new List<ClaimLineItem>();
        for (var i = 0; i < lines; i++)
        {
            var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = Guid.NewGuid(), ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed };
            var day = DateOnly.FromDateTime(Now).AddDays(-10 - i);
            var line = new ClaimLineItem
            {
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id, SupportItemCode = ItemCode, DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = day, SupportsDeliveredTo = day, Hours = 2m, UnitPrice = 60m, TotalAmount = 120m, GSTCode = GSTCode.P2, Status = lineStatus,
            };
            Db.ParticipantBookings.Add(booking);
            Db.ClaimLineItems.Add(line);
            made.Add(line);
        }
        Db.SaveChanges();
        return (claim, made, participant);
    }

    public async Task<BatchResult<BatchDetailDto>> BuildAsync(params Guid[] lineIds) =>
        await Service.BuildAsync(TenantId, User, new BuildRequest(lineIds, [], []), default);

    public async Task<BatchResult<BatchDetailDto>> BuildClaimsAsync(params Guid[] claimIds) =>
        await Service.BuildAsync(TenantId, User, new BuildRequest([], claimIds, []), default);

    public void Dispose() => Db.Dispose();
}
