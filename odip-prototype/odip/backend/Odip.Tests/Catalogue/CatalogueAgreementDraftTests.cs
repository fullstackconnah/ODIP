using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The service agreement draft over the real imported catalogue. Before the 2026-27 import a draft line could only be one of two codes
/// (04_104_0125_6_1 and 04_450_0125_1_1: the community access items that existed, both weekday and hourly). The import adds a thousand rows, and
/// items the classifier does not band by day are stored as Weekday, so without a scope a coordinator typing the code of a Public Holiday SIL
/// item would be quoted a "weekday" line. The draft stays scoped to the community access group: exactly the set it always accepted.
/// </summary>
public class CatalogueAgreementDraftTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly AgreementStart = new(2026, 10, 5);

    private static async Task<(OdipDbContext Db, Guid ParticipantId)> ImportedDbAsync()
    {
        var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Synthetic", LastName = "Participant", NdisNumber = "43100001234",
            DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true,
        };
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        return (db, participant.Id);
    }

    private static CreateServiceAgreementDraftDto Request(string code, DateOnly? start = null) => new()
    {
        PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
        AgreementStartDate = start ?? AgreementStart, AgreementEndDate = new DateOnly(2027, 6, 30),
        State = "VIC", ServiceTypes = ["Community access"], Representative = "Representative",
        Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "Community access", ItemCode = code, Hours = 2.5m }],
    };

    [Theory]
    [InlineData("04_104_0125_6_1", 73.58)]    // Access Community - Standard - Weekday Daytime
    [InlineData("04_450_0125_1_1", 79.60)]    // Intensive and Complex Behaviour Supports - Weekday Daytime
    public async Task The_two_codes_a_draft_has_always_quoted_are_still_quoted_at_the_2026_27_price(string code, double price)
    {
        var (db, participantId) = await ImportedDbAsync();
        await using var _ = db;

        var (draft, error) = await new ServiceAgreementDraftService(db).CreateAsync(TenantId, participantId, Request(code), "actor", CancellationToken.None);

        Assert.Null(error);
        var line = Assert.Single(draft!.Lines);
        Assert.Equal((code, (decimal)price, "2026-27"), (line.ItemCode, line.UnitPrice, line.CatalogueVersion));
    }

    [Theory]
    [InlineData("01_010_0107_1_1")]   // sleepover: Each
    [InlineData("01_250_0115_1_1")]   // STA participant accommodation: Day
    [InlineData("01_799_0107_1_1")]   // provider travel non-labour: $1 Each
    [InlineData("04_105_0125_6_1")]   // community access Saturday: a weekday draft line cannot be a Saturday rate
    [InlineData("04_210_0125_6_1")]   // Each, no price limit
    [InlineData("01_806_0115_1_1")]   // SIL Public Holiday, hourly: stored as Weekday because the map does not band it
    [InlineData("01_454_0107_1_1")]   // ICBS Public Holiday, hourly: the same
    [InlineData("01_011_0107_1_1")]   // personal care weekday daytime: a real weekday item, but of another family
    [InlineData("04_599_0136_6_1")]   // centre capital cost, hourly
    public async Task Every_other_code_is_refused_exactly_as_before_the_import(string code)
    {
        var (db, participantId) = await ImportedDbAsync();
        await using var _ = db;

        var (draft, error) = await new ServiceAgreementDraftService(db).CreateAsync(TenantId, participantId, Request(code), "actor", CancellationToken.None);

        Assert.Null(draft);
        Assert.Equal($"No active effective weekday catalogue price exists for {code}.", error);
        Assert.Empty(db.ServiceAgreementDrafts);
    }
}
