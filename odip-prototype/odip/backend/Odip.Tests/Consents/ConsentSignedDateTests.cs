using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Consents;

/// <summary>
/// H74-2: a consent's SignedDate must fall between 2000-01-01 and the provider's today. Every writer applies the one rule
/// (<see cref="ParticipantGridRules.SignedDateError"/>): the single-row PUT, the participant create and update, and the PATCH collection group.
/// </summary>
public class ConsentSignedDateTests
{
    private const string Future = "The signed date can't be in the future.";
    private const string TooOld = "The signed date must be in 2000 or later.";
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    // 12:00 UTC is evening in every Australian zone, so the provider's today is 15 June whatever the organisation's zone.
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 6, 15, 12, 0, 0, TimeSpan.Zero));
    private static readonly DateOnly Today = new(2026, 6, 15);

    private static Participant Seed(OdipDbContext db)
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static ParticipantsController Participants(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db), clock: Clock);

    private static List<CreateParticipantConsentDto> Consent(DateOnly? signed) =>
        new() { new() { ConsentType = ConsentType.Privacy, Granted = true, SignedByName = "Guardian", SignedDate = signed } };

    [Theory]
    [InlineData(null, null)]
    [InlineData("2026-06-15", null)]
    [InlineData("2026-06-16", Future)]
    [InlineData("2000-01-01", null)]
    [InlineData("1999-12-31", TooOld)]
    public async Task Upsert_RangeChecksTheSignedDate(string? signed, string? refusal)
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db);
        var dto = new UpsertParticipantConsentDto { Granted = true, SignedByName = "Guardian", SignedDate = signed is null ? null : DateOnly.Parse(signed) };

        var result = await new ParticipantConsentsController(db, Clock).Upsert(p.Id, nameof(ConsentType.Privacy), dto, CancellationToken.None);

        if (refusal is null)
        {
            Assert.IsType<OkObjectResult>(result.Result);
            Assert.Equal(1, await db.ParticipantConsents.CountAsync());
            return;
        }
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(refusal, Assert.IsType<ApiResponse<ParticipantConsentDto>>(bad.Value).Errors.Single());
        Assert.Equal(0, await db.ParticipantConsents.CountAsync()); // Granted and SignedByName saved nothing either
    }

    [Fact]
    public async Task Upsert_RefusedDateLeavesTheStoredRowAsItWas()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db);
        var controller = new ParticipantConsentsController(db, Clock);
        await controller.Upsert(p.Id, nameof(ConsentType.Privacy), new UpsertParticipantConsentDto { Granted = true, SignedByName = "First", SignedDate = Today }, CancellationToken.None);

        var result = await controller.Upsert(p.Id, nameof(ConsentType.Privacy), new UpsertParticipantConsentDto { Granted = false, SignedByName = "Second", SignedDate = Today.AddDays(1) }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var row = await db.ParticipantConsents.SingleAsync();
        Assert.True(row.Granted);
        Assert.Equal("First", row.SignedByName);
        Assert.Equal(Today, row.SignedDate);
    }

    [Fact]
    public async Task Create_RefusesAFutureSignedDate_AndSavesNoParticipant()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var dto = new CreateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = PlanType.SelfManaged, OvernightSupport = OvernightSupportType.None,
            OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne, Consents = Consent(Today.AddDays(1)),
        };

        var result = await Participants(db).Create(dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(Future, Assert.IsType<ApiResponse<ParticipantDetailDto>>(bad.Value).Errors.Single());
        Assert.Equal(0, await db.Participants.CountAsync());
    }

    [Fact]
    public async Task Update_RefusesATooOldSignedDate()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db);
        var dto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", IsActive = true, PlanType = PlanType.SelfManaged,
            OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
            Consents = Consent(new DateOnly(1, 1, 1)),
        };

        var result = await Participants(db).Update(p.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(TooOld, Assert.IsType<ApiResponse<ParticipantDetailDto>>(bad.Value).Errors.Single());
        Assert.Equal(0, await db.ParticipantConsents.CountAsync());
    }

    [Fact]
    public async Task Patch_RefusesAFutureSignedDate()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db);
        var dto = new PatchParticipantDto { Consents = Consent(Today.AddDays(1)) };

        var result = await Participants(db).Patch(p.Id, dto, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(Future, Assert.IsType<ApiResponse<ParticipantDetailDto>>(bad.Value).Errors.Single());
        Assert.Equal(0, await db.ParticipantConsents.CountAsync());
    }

    [Fact]
    public async Task Patch_AcceptsTodayAndTheFirstDayOf2000()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db);

        Assert.IsType<OkObjectResult>((await Participants(db).Patch(p.Id, new PatchParticipantDto { Consents = Consent(Today) }, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await Participants(db).Patch(p.Id, new PatchParticipantDto { Consents = Consent(new DateOnly(2000, 1, 1)) }, CancellationToken.None)).Result);
        Assert.Equal(new DateOnly(2000, 1, 1), (await db.ParticipantConsents.SingleAsync()).SignedDate);
    }
}
