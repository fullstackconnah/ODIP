using System.Text;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// Nullability audit (shift-completion design spec, delivery PR 3): BprCsvService's agency-
/// managed filter dereferenced `l.ParticipantBooking.PlanTypeOverride` directly, which NREs for
/// Kind == Shift claim lines now that ParticipantBookingId/ParticipantBooking are nullable. A
/// shift-kind line must be excluded from the BPR CSV (export for shift claims is out of scope
/// for this PR — see the design spec's Open questions), not NRE the whole request.
/// </summary>
public class BprCsvServiceTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public async Task GenerateBprCsvAsync_ShiftKindClaim_ExcludesShiftLines_DoesNotThrow()
    {
        using var db = CreateDb();

        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng",
            NdisNumber = "43100003333", PlanType = PlanType.AgencyManaged,
        };
        db.Participants.Add(participant);

        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id,
            ServiceDate = new DateOnly(2026, 9, 7), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(shift);

        var claim = new TripClaim
        {
            Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id,
            PeriodFrom = shift.ServiceDate, PeriodTo = shift.ServiceDate, ClaimReference = "TC-43100003333-20260907",
        };
        db.TripClaims.Add(claim);

        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, ParticipantBookingId = null,
            SupportItemCode = "04_SHIFT", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = shift.ServiceDate, SupportsDeliveredTo = shift.ServiceDate,
            Hours = 8m, UnitPrice = 40m, TotalAmount = 320m,
        });

        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "PR1", ABN = "1",
            OrganisationName = "Org", Address = "1 St", State = "VIC",
        });
        await db.SaveChangesAsync();

        var service = new BprCsvService(db);

        var (bytes, fileName) = await service.GenerateBprCsvAsync(claim.Id, CancellationToken.None);

        var csv = Encoding.UTF8.GetString(bytes);
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        Assert.Single(lines); // header row only — the shift-kind line was excluded, not NRE'd
        Assert.StartsWith("RegistrationNumber,NDISNumber,", lines[0]);
        Assert.Contains(claim.ClaimReference, fileName);
    }
}
