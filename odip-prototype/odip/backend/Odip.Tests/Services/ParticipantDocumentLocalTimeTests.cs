using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// The participant PDFs print the organisation's local time (header) and local date (file name), not UTC;
/// and a client overview only prints the header of a trip the participant is booked on.
/// </summary>
public class ParticipantDocumentLocalTimeTests
{
    // 22:30 UTC on the 12th is 09:30 on the 13th in Sydney (AEDT) and 06:30 on the 13th in Perth (AWST).
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 11, 12, 22, 30, 0, TimeSpan.Zero));

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static (OdipDbContext Db, Guid TenantId, Guid ParticipantId) Seed(string zone)
    {
        var db = TestDb.Create();
        var tenantId = Guid.NewGuid();
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test", Address = "1 Test St", State = "NSW", TimeZoneId = zone });
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Local", LastName = "Time", NdisNumber = "111222333", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return (db, tenantId, participant.Id);
    }

    [Theory]
    [InlineData("Australia/Sydney", 9, 30)]
    [InlineData("Australia/Perth", 6, 30)]
    public async Task AllThreeDownloads_PrintTheOrganisationsLocalTime(string zone, int hour, int minute)
    {
        var (db, _, participantId) = Seed(zone);
        using var _ = db;
        var service = new ParticipantDocumentService(db, Clock);

        var expected = new DateTime(2026, 11, 13, hour, minute, 0);
        Assert.Equal(expected, (await service.ComposeIntakeFormAsync(participantId, false))!.GeneratedAt);
        Assert.Equal(expected, (await service.ComposeParticipantProfileAsync(participantId, false))!.GeneratedAt);
        Assert.Equal(expected, (await service.ComposeClientOverviewAsync(participantId, null, false))!.GeneratedAt);

        Assert.EndsWith("-20261113.pdf", (await service.GenerateIntakeFormAsync(participantId, false))!.Value.FileName);
        Assert.EndsWith("-20261113.pdf", (await service.GenerateParticipantProfileAsync(participantId, false))!.Value.FileName);
        Assert.EndsWith("-20261113.pdf", (await service.GenerateClientOverviewAsync(participantId, null, false))!.Value.FileName);
    }

    [Fact]
    public async Task ClientOverview_IgnoresATripTheParticipantIsNotBookedOn()
    {
        var (db, tenantId, participantId) = Seed("Australia/Sydney");
        using var _ = db;
        var otherId = Guid.NewGuid();
        db.Participants.Add(new Participant { Id = otherId, TenantId = tenantId, FirstName = "Other", LastName = "Person", NdisNumber = "444555666", IsActive = true });
        var mine = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "My Trip", StartDate = new DateOnly(2026, 12, 1), DurationDays = 3 };
        var theirs = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Their Trip", StartDate = new DateOnly(2026, 12, 8), DurationDays = 3 };
        db.TripInstances.AddRange(mine, theirs);
        db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = mine.Id, ParticipantId = participantId, BookingDate = new DateOnly(2026, 11, 1) });
        db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = theirs.Id, ParticipantId = otherId, BookingDate = new DateOnly(2026, 11, 1) });
        db.SaveChanges();
        var service = new ParticipantDocumentService(db, Clock);

        var blank = (await service.ComposeClientOverviewAsync(participantId, null, false))!;
        var onMine = (await service.ComposeClientOverviewAsync(participantId, mine.Id, false))!;
        var onTheirs = (await service.ComposeClientOverviewAsync(participantId, theirs.Id, false))!;

        Assert.Equal("My Trip", onMine.TripName);
        Assert.Equal(blank.TripName, onTheirs.TripName);
        Assert.Equal(blank.TripDate, onTheirs.TripDate);
        Assert.Equal(blank.TripGroup, onTheirs.TripGroup);
        Assert.DoesNotContain("Their Trip", onTheirs.TripName);
    }
}
