using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportFieldsTests
{
    [Fact]
    public void AutoMatch_matches_labels_and_synonyms_whatever_their_case_spacing_and_punctuation()
    {
        string[] headers = ["Given Name", "SURNAME", "D.O.B.", "post_code", "Contact 2 Relationship", "NDIS No", "Favourite colour"];
        Assert.Equal(new string?[] { "firstName", "lastName", "dateOfBirth", "addressPostcode", "contact2Relationship", "ndisNumber", null },
            ImportFields.AutoMatch(ImportKind.Participants, headers));
    }

    [Fact]
    public void AutoMatch_gives_a_field_to_the_first_column_that_names_it() =>
        Assert.Equal(new string?[] { "phone", null }, ImportFields.AutoMatch(ImportKind.Participants, ["Phone", "Mobile"]));

    [Fact]
    public void Every_label_matches_its_own_field_so_the_template_round_trips()
    {
        foreach (var field in ImportFields.For(ImportKind.Participants))
            Assert.Equal(new string?[] { field.Key }, ImportFields.AutoMatch(ImportKind.Participants, [field.Label]));
    }

    [Fact]
    public void MappingError_names_what_is_wrong()
    {
        var kind = ImportKind.Participants;
        Assert.Null(ImportFields.MappingError(kind, ["firstName", "lastName", null], 3, requireAll: true));
        Assert.Equal("Match a column to Last name.", ImportFields.MappingError(kind, ["firstName", null, null], 3, requireAll: true));
        Assert.Null(ImportFields.MappingError(kind, ["firstName", null, null], 3, requireAll: false));
        Assert.Equal("Two columns are matched to First name. Choose one.", ImportFields.MappingError(kind, ["firstName", "firstName", "lastName"], 3, requireAll: false));
        Assert.Equal("The column matches don't fit this file. Upload it again.", ImportFields.MappingError(kind, ["firstName", "nope"], 2, requireAll: false));
        Assert.Equal("The column matches don't fit this file. Upload it again.", ImportFields.MappingError(kind, ["firstName"], 2, requireAll: false));
    }

    [Fact]
    public void Staff_headers_match_and_the_columns_ODIP_does_not_hold_are_named()
    {
        string[] headers = ["Given name", "Surname", "Email address", "Mobile", "Job title", "Driver's licence", "First aid expiry", "NWSC", "Employment type", "WWCC"];
        Assert.Equal(new string?[] { "firstName", "lastName", "email", "mobile", "position", "driversLicence", "firstAidExpiry", "workerScreeningNumber", null, null },
            ImportFields.AutoMatch(ImportKind.Staff, headers));
        Assert.Equal("Won't be imported: Employment Hero will hold employment details.", ImportFields.NotImportedNote(ImportKind.Staff, "Employment type"));
        Assert.Equal("Won't be imported: ODIP has no field for this yet.", ImportFields.NotImportedNote(ImportKind.Staff, "Police check"));
        Assert.Null(ImportFields.NotImportedNote(ImportKind.Participants, "Employment type"));
        foreach (var field in ImportFields.For(ImportKind.Staff))
            Assert.Equal(new string?[] { field.Key }, ImportFields.AutoMatch(ImportKind.Staff, [field.Label]));
    }
}
