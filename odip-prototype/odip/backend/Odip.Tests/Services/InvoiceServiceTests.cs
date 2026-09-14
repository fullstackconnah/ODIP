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
/// Nullability audit (shift-completion design spec, delivery PR 3): InvoiceService's
/// GenerateInvoiceAsync selects the line's ParticipantBooking, which is null for Kind == Shift
/// claim lines now that ParticipantBookingId is nullable. Before this fix,
/// `.FirstOrDefault(b => b.Id == bookingId)` over a sequence containing a null ParticipantBooking
/// threw a NullReferenceException instead of the intended "Booking not found" 400.
/// </summary>
public class InvoiceServiceTests
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
    public async Task GenerateInvoiceAsync_ShiftKindClaim_ThrowsBookingNotFound_NotNullReference()
    {
        using var db = CreateDb();

        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng",
            NdisNumber = "43100002222", PlanType = PlanType.SelfManaged,
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
            PeriodFrom = shift.ServiceDate, PeriodTo = shift.ServiceDate, ClaimReference = "TC-43100002222-20260907",
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

        var service = new InvoiceService(db);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.GenerateInvoiceAsync(claim.Id, Guid.NewGuid(), CancellationToken.None));
        Assert.Equal("Booking not found in this claim.", ex.Message);
    }
}
