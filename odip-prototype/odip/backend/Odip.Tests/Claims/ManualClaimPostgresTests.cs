using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// The manual claim on a real PostgreSQL, where the check constraint exists (InMemory ignores it) and the reader queries must translate. Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class ManualClaimPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Day = new(2026, 10, 1);

    private readonly PostgresFixture _pg;
    public ManualClaimPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private async Task<(LedgerKit Kit, Participant Person, TripClaim Claim)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("VIC").TimeZoneId = "Australia/Sydney";
        var item = kit.SeedItem("15_MANUAL", 15, price: 100m);
        item.PriceNational = 100m;
        kit.Db.SaveChanges();
        var person = kit.SeedParticipant(addressState: "NSW");
        var made = await new ManualClaimService(kit.Db, kit.Ledger, kit.Clock).MakeAsync(kit.TenantId, new ManualClaimRequestDto
        {
            ParticipantId = person.Id, Lines = [new ManualClaimLineRequestDto { SupportItemCode = "15_MANUAL", ServiceDate = Day, Quantity = 1m, UnitPrice = 50m }],
        }, Ct);
        return (kit, person, made.Claim);
    }

    [SkippableFact(DisplayName = "Postgres: a manual line saves, and a line with both a shift and a booking is refused by CK_ClaimLineItem_AtMostOneParent")]
    public async Task P1_AManualLineSaves_AndALineWithBothParentsIsRefusedByTheCheckConstraint()
    {
        RequirePostgres();
        var (kit, person, claim) = await SeedAsync();
        using var _ = kit;
        Assert.Equal(1, await kit.Db.ClaimLineItems.CountAsync(l => l.TripClaimId == claim.Id && l.ShiftId == null && l.ParticipantBookingId == null, Ct));

        var shift = kit.SeedShift(person, Day, ShiftStatus.Completed);
        var booking = kit.SeedBooking(kit.SeedTrip(Day, 1), person);
        kit.Db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TenantId = kit.TenantId, TripClaimId = claim.Id, ShiftId = shift.Id, ParticipantBookingId = booking.Id, SupportItemCode = "15_MANUAL", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = Day, SupportsDeliveredTo = Day, Hours = 1m, UnitPrice = 50m, TotalAmount = 50m, Status = ClaimLineItemStatus.Draft,
        });

        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => kit.Db.SaveChangesAsync(Ct));
        Assert.Contains("CK_ClaimLineItem_AtMostOneParent", ex.InnerException?.Message ?? ex.Message);
    }

    [SkippableFact(DisplayName = "Postgres: the rejection, ledger and BPR readers translate with the manual branch and find the manual line")]
    public async Task P2_TheReaderQueriesTranslate_AndFindTheManualLine()
    {
        RequirePostgres();
        var (kit, person, claim) = await SeedAsync();
        using var _ = kit;
        // Read before the claim is rejected: a rejected claim stops counting, so the manual branch is only seen while it is open.
        kit.SeedPlan(person, LedgerKit.Core(PlanType.AgencyManaged, LedgerKit.Q(2, 5000m)));
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, [person.Id], Ct);
        var budget = await kit.Ledger.ForClaimAsync(kit.TenantId, claim.Id, Ct);
        await kit.Db.TripClaims.Where(c => c.Id == claim.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, TripClaimStatus.Rejected).SetProperty(c => c.RejectionCode, "V17").SetProperty(c => c.RejectedDate, DateTime.UtcNow), Ct);
        var lineId = await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).Select(l => l.Id).SingleAsync(Ct);

        var rejected = await new NdiaRejectionReader(kit.Db, kit.Clock).RejectedLinesQuery(kit.TenantId, [person.Id]).ToListAsync(Ct);
        var rows = await new BprCsvService(kit.Db).LoadRowsAsync(kit.TenantId, [lineId], Ct);

        Assert.Equal(person.Id, Assert.Single(rejected).ParticipantId);
        Assert.Contains(all[person.Id].Items, i => i.ClaimId == claim.Id && i.Amount == 50m);
        Assert.NotNull(budget);
        var row = Assert.Single(rows);
        Assert.Equal(person.NdisNumber, row.Participant?.NdisNumber);
        Assert.Equal("NSW", row.State);   // the participant's state, not the organisation's VIC
    }
}
