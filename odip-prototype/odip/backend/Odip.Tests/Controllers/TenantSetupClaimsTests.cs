using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Setup now always makes the provider row, with the registration number and ABN blank until Organisation profile is filled in. A blank row is not a
/// configured provider: claims, the BPR CSV and invoices must still be refused for it, and the check reads the claim's OWN organisation's row, not whichever row
/// a SuperAdmin's unfiltered query returns first (organisation B's complete row is stored first in every test, so an unkeyed read would find it).
/// </summary>
public class TenantSetupClaimsTests
{
    private const string NotConfigured = "Provider settings are not configured";

    private sealed record Seeded(Guid TenantId, Participant Participant, TripInstance Trip, ParticipantBooking Booking, TripClaim Claim);

    private static OdipDbContext SuperAdminDb()
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns((Guid?)null);
        current.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options;
        return new OdipDbContext(options, current.Object);
    }

    /// <summary>Organisation B has a complete profile (stored first); organisation A is made by the setup endpoint with no provider fields, and owns a trip, a claim and a shift.</summary>
    private static async Task<(OdipDbContext Db, Seeded A)> Setup()
    {
        var db = SuperAdminDb();
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Org B", Address = "1 B St", State = "VIC",
        });
        db.SaveChanges();

        var firebase = new Mock<IFirebaseUserService>();
        await new TenantsController(db, firebase.Object).CreateWithSetup(
            new CreateTenantWithSetupDto("Org A", "a.example.com", new TenantSetupProviderDto { State = "VIC" }, null), CancellationToken.None);
        var tenantId = (await db.Tenants.SingleAsync()).Id;

        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = "43188882222", PlanType = PlanType.SelfManaged };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 2, 1), DurationDays = 1 };
        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed,
            BookingDate = new DateOnly(2026, 1, 1), ClaimStatus = ClaimStatus.InClaim,
        };
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = TripClaimStatus.Draft, ClaimReference = "TC-TRIP", TotalAmount = 480m };
        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id, SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1), Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
        };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, ServiceDate = new DateOnly(2026, 9, 7), StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        // A catalogue row, so the shift engine gets as far as reading the provider settings.
        var group = new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Community Access", SupportCategory = 4 };
        var item = new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = "04_Weekday_STD", Description = "Test item", DayType = ClaimDayType.Weekday, PriceLimit_VIC = 40m, PriceLimit_Remote = 40m,
            PriceLimit_VeryRemote = 40m, CatalogueVersion = "2024-25", EffectiveFrom = new DateOnly(2024, 7, 1), IsActive = true,
        };
        db.AddRange(participant, trip, booking, claim, line, shift, group, item);
        db.SaveChanges();
        return (db, new Seeded(tenantId, participant, trip, booking, claim));
    }

    [Fact]
    public async Task A_new_organisation_with_no_provider_fields_cannot_generate_claims()
    {
        var (db, a) = await Setup();
        using var _ = db;

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => new ClaimGenerationService(db).PreviewClaimAsync(a.Trip.Id, null));
        Assert.Contains(NotConfigured, ex.Message);
    }

    [Fact]
    public async Task A_new_organisation_with_no_provider_fields_cannot_generate_shift_claims()
    {
        var (db, a) = await Setup();
        using var _ = db;

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => new ShiftClaimGenerationService(db).GenerateAsync(a.Participant.Id, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30)));
        Assert.Contains(NotConfigured, ex.Message);
    }

    [Fact]
    public async Task A_new_organisation_with_no_provider_fields_cannot_make_a_BPR_CSV()
    {
        var (db, a) = await Setup();
        using var _ = db;

        a.Participant.PlanType = PlanType.AgencyManaged;
        await db.SaveChangesAsync();

        var result = await new ClaimBatchService(db, new BprCsvService(db), new InvoiceService(db), TimeProvider.System)
            .DownloadForClaimAsync(a.TenantId, new System.Security.Claims.ClaimsPrincipal(), a.Claim.Id, CancellationToken.None);
        Assert.Equal(400, result.Status);
        Assert.Contains(((BuildRefusalDto)result.Data!).Problems, p => p.Rule == "RegistrationNumber");
    }

    [Fact]
    public async Task A_new_organisation_with_no_provider_fields_cannot_make_an_invoice()
    {
        var (db, a) = await Setup();
        using var _ = db;

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => new InvoiceService(db).GenerateInvoiceAsync(a.Claim.Id, a.Booking.Id));
        Assert.Contains(NotConfigured, ex.Message);
    }

    // The "fill in Organisation profile first" hint on the claims task reads the trip's own organisation (a SuperAdmin's unfiltered query would find organisation B's ABN).
    [Theory]
    [InlineData("", "", true)]
    [InlineData("12345678901", "", true)]
    [InlineData("", "PR001", true)]
    [InlineData("12345678901", "PR001", false)]
    public async Task The_claims_task_asks_for_the_organisation_profile_until_the_ABN_and_registration_number_are_in(string abn, string registrationNumber, bool asks)
    {
        var (db, a) = await Setup();
        using var _ = db;
        var row = await db.ProviderSettings.SingleAsync(s => s.TenantId == a.TenantId);
        row.ABN = abn;
        row.RegistrationNumber = registrationNumber;
        a.Trip.Status = TripStatus.InProgress;
        db.SaveChanges();

        await new TripsController(db, NullLogger<TripsController>.Instance).Patch(a.Trip.Id, new PatchTripDto { Status = TripStatus.Completed }, CancellationToken.None);

        var task = await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.GenerateNdisClaims);
        Assert.Equal(asks, task.Title.Contains("fill in Settings", StringComparison.Ordinal));
    }
}
