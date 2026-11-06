using Odip.Application.DTOs;
using Odip.Infrastructure.Integrations;
using Xunit;

namespace Odip.Tests.AddressLookup;

public class AddressComponentsParserTests
{
    private static GoogleAddressComponent C(string type, string longText, string? shortText = null) => new(longText, shortText ?? longText, new[] { type, "political" });

    private static readonly GoogleAddressComponent[] Full =
    {
        C("subpremise", "3"), C("street_number", "12"), C("route", "Example Street", "Example St"), C("locality", "Southport"),
        C("administrative_area_level_1", "Queensland", "QLD"), C("country", "Australia", "AU"), C("postal_code", "4215"),
    };

    private static (string, string, string, string) Parts(AddressDetailsDto d) => (d.Street, d.Suburb, d.State, d.Postcode);

    [Fact]
    public void UnitNumberAndRoute_MakeTheStreetWithTheLongNames() =>
        Assert.Equal(("3/12 Example Street", "Southport", "QLD", "4215"),
            Parts(AddressComponentsParser.Parse(Full, "3/12 Example St, Southport QLD 4215, Australia")));

    [Fact]
    public void WithoutASubpremise_TheStreetIsNumberAndRoute() =>
        Assert.Equal("12 Example Street", AddressComponentsParser.Parse(Full.Where(c => c.Types![0] != "subpremise"), "x").Street);

    [Fact]
    public void WithoutAStreetNumber_TheStreetIsTheRouteAlone() =>
        Assert.Equal("Example Street", AddressComponentsParser.Parse(Full.Where(c => c.Types![0] is not ("subpremise" or "street_number")), "x").Street);

    [Fact]
    public void WithoutARoute_TheStreetIsTheFormattedAddressUpToTheFirstComma() =>
        Assert.Equal("Pacific Fair Shopping Centre", AddressComponentsParser.Parse(Full.Where(c => c.Types![0] is not ("subpremise" or "street_number" or "route")),
            "Pacific Fair Shopping Centre, Hooker Blvd, Broadbeach Waters QLD 4218, Australia").Street);

    [Theory]
    [InlineData("sublocality_level_1", "Surfers Paradise")]
    [InlineData("postal_town", "Leeds")]
    public void WithoutALocality_TheSuburbFallsBack(string type, string name)
    {
        var parts = Full.Where(c => c.Types![0] != "locality").Append(C(type, name));
        Assert.Equal(name, AddressComponentsParser.Parse(parts, "x").Suburb);
    }

    [Fact]
    public void AStateOutsideTheList_IsBlank() =>
        Assert.Equal("", AddressComponentsParser.Parse(Full.Where(c => c.Types![0] != "administrative_area_level_1").Append(C("administrative_area_level_1", "Jervis Bay", "JBT")), "x").State);

    [Fact]
    public void AMissingPostcode_IsBlank_AndNoComponentsAtAllThrowsNothing()
    {
        Assert.Equal("", AddressComponentsParser.Parse(Full.Where(c => c.Types![0] != "postal_code"), "x").Postcode);
        Assert.Equal(("", "", "", ""), Parts(AddressComponentsParser.Parse(null, null)));
    }

    [Fact]
    public void TheFormattedAddress_LosesItsTrailingCountry() =>
        Assert.Equal("3/12 Example St, Southport QLD 4215", AddressComponentsParser.Parse(Full, "3/12 Example St, Southport QLD 4215, Australia").FormattedAddress);
}
