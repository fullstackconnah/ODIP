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

    // Round 3, L4 (the residue of review N13): the hand-typed path writes free text to the same columns and onto the same PDF as the representative, and queries the catalogue with the item code. The
    // representative was filtered for control characters; these were not, so a NUL in one of them met the same PostgreSQL refusal as a block id did (a 500). ServiceTypes also had no limit at all, and
    // the column that holds it is varchar(4000).
    public static IEnumerable<object[]> FreeTextWithAControlCharacter()
    {
        foreach (var bad in new[] { "Com\0munity", "Com\nmunity", "Com\tmunity" })
            foreach (var field in new[] { "ServiceTypes", "ServiceType", "ItemCode" })
                yield return new object[] { field, bad };
    }

    [Theory]
    [MemberData(nameof(FreeTextWithAControlCharacter))]
    public async Task Free_text_with_a_control_character_is_refused_in_words_and_nothing_is_saved_whichever_field_it_is_in(string field, string text)
    {
        var (db, participantId) = await ImportedDbAsync();
        await using var _ = db;
        var request = Request("04_104_0125_6_1");
        request = field switch
        {
            "ServiceTypes" => request with { ServiceTypes = [text] },
            "ServiceType" => request with { Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = text, ItemCode = "04_104_0125_6_1", Hours = 2.5m }] },
            _ => request with { Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "Community access", ItemCode = text, Hours = 2.5m }] },
        };

        var result = await new ServiceAgreementDraftService(db).SaveAsync(TenantId, participantId, request, "actor", CancellationToken.None);

        Assert.Null(result.Draft);
        var error = Assert.Single(result.Errors);
        Assert.Contains("control character", error);
        Assert.DoesNotContain(error, c => char.IsControl(c)); // and the character is not repeated in the message that says so
        Assert.Empty(db.ServiceAgreementDrafts);
    }

    [Fact]
    public async Task The_service_types_have_a_limit_in_number_and_in_length_and_in_what_the_column_holds()
    {
        var (db, participantId) = await ImportedDbAsync();
        await using var _ = db;
        var service = new ServiceAgreementDraftService(db);
        async Task<string> Refusal(List<string> types) => Assert.Single((await service.SaveAsync(TenantId, participantId, Request("04_104_0125_6_1") with { ServiceTypes = types }, "actor", CancellationToken.None)).Errors);

        Assert.Equal("A draft has at most 20 service types.", await Refusal(Enumerable.Range(0, 21).Select(i => $"Type {i}").ToList()));
        Assert.Equal("A service type is at most 100 characters.", await Refusal([new string('x', 101)]));
        Assert.Equal("A service type cannot be empty.", await Refusal(["Community access", "  "]));
        // Twenty labels of a hundred characters outside ASCII: each is twelve characters of JSON once it is written, and the column holds 4000.
        Assert.Equal("The service types are too long to save.", await Refusal(Enumerable.Range(0, 20).Select(_ => string.Concat(Enumerable.Repeat("\U0001F600", 50))).ToList()));
        Assert.Empty(db.ServiceAgreementDrafts);
    }

    [Fact]
    public async Task Twenty_ordinary_service_types_and_a_line_with_ordinary_text_still_save()
    {
        var (db, participantId) = await ImportedDbAsync();
        await using var _ = db;

        var result = await new ServiceAgreementDraftService(db).SaveAsync(TenantId, participantId, Request("04_104_0125_6_1") with { ServiceTypes = Enumerable.Range(0, 20).Select(i => new string((char)('a' + i), 100)).ToList() }, "actor", CancellationToken.None);

        Assert.Empty(result.Errors);
        Assert.Equal(20, System.Text.Json.JsonSerializer.Deserialize<List<string>>(Assert.IsType<ServiceAgreementDraft>(result.Draft).ServiceTypesJson)!.Count);
    }
}
