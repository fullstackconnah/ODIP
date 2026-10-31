using System.Security.Claims;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
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

    public Guid TenantId { get; }
    public Guid OtherTenantId { get; } = Guid.NewGuid();
    public OdipDbContext Db { get; }
    public FixedClock Clock { get; } = new(Now);
    public ClaimBatchService Service { get; }
    public ClaimsPrincipal User { get; } = new(new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Pat Planner")], "test"));

    private int _counter;

    /// <summary>On InMemory by default; pass a Postgres context (and the tenant it is scoped to) for the [PG] facts.</summary>
    public BatchFixture(OdipDbContext? db = null, Guid? tenantId = null)
    {
        Db = db ?? TestDb.Create();
        TenantId = tenantId ?? Guid.NewGuid();
        Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "4050012345", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "VIC" });
        if (!Db.SupportCatalogueItems.Any(i => i.ItemNumber == ItemCode))
        {
            // The catalogue is global, and Postgres wants the activity group row the item points at.
            var group = Db.SupportActivityGroups.FirstOrDefault(g => g.GroupCode == "BATCH_TEST") ?? Db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "BATCH_TEST", DisplayName = "Batch test", SupportCategory = 4 }).Entity;
            Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = ItemCode, Description = "Community access", Unit = "H", PriceNational = 70m, PriceLimit_VIC = 70m,
            IsActive = true, EffectiveFrom = new DateOnly(2020, 1, 1),
            });
        }
        Db.SaveChanges();
        Service = new ClaimBatchService(Db, new BprCsvService(Db), new InvoiceService(Db), Clock);
    }

    /// <summary>A claim of one participant with <paramref name="lines"/> draft lines, each on its own day ten days back or more.</summary>
    public (TripClaim Claim, List<ClaimLineItem> Lines, Participant Participant) AddClaim(
        int lines = 1, PlanType plan = PlanType.AgencyManaged, TripClaimStatus status = TripClaimStatus.Draft, ClaimLineItemStatus lineStatus = ClaimLineItemStatus.Draft,
        Guid? tenant = null, string? ndis = null, bool shiftLines = false)
    {
        var n = ++_counter;
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? TenantId, FirstName = "Amy" + n, LastName = "Ng", NdisNumber = ndis ?? $"43{n:D7}", PlanType = plan, IsActive = true,
        };
        var claim = new TripClaim { TenantId = participant.TenantId, Id = Guid.NewGuid(), ParticipantId = participant.Id, ClaimReference = $"TC-{n:D3}-{Guid.NewGuid():N}"[..20], Kind = shiftLines ? ClaimKind.Shift : ClaimKind.Trip, Status = status, TotalAmount = 120m * lines };
        Db.Participants.Add(participant);
        Db.TripClaims.Add(claim);
        var made = new List<ClaimLineItem>();
        for (var i = 0; i < lines; i++)
        {
            var day = DateOnly.FromDateTime(Now).AddDays(-10 - i);
            // Postgres enforces the foreign keys, so a shift (which needs only a participant) stands in for a booking there.
            var shift = shiftLines ? new Shift { Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(11, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed } : null;
            var booking = shiftLines ? null : new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = Guid.NewGuid(), ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed };
            var line = new ClaimLineItem
            {
                TenantId = claim.TenantId,
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking?.Id, ShiftId = shift?.Id, SupportItemCode = ItemCode, DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = day, SupportsDeliveredTo = day, Hours = 2m, UnitPrice = 60m, TotalAmount = 120m, GSTCode = GSTCode.P2, Status = lineStatus,
            };
            if (booking != null) Db.ParticipantBookings.Add(booking);
            if (shift != null) Db.Shifts.Add(shift);
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
