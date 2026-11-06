using Odip.Application.DTOs;

namespace Odip.Infrastructure.Integrations;

/// <summary>One entry of Place Details' <c>addressComponents</c>.</summary>
public sealed record GoogleAddressComponent(string? LongText, string? ShortText, string[]? Types);

/// <summary>Splits a Google place into the app's street, suburb, state and postcode. Pure, so the odd shapes (no street number, a business with no route) are unit tested.</summary>
public static class AddressComponentsParser
{
    private const string Country = ", Australia";
    private static readonly HashSet<string> States = new(StringComparer.Ordinal) { "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT" };

    public static AddressDetailsDto Parse(IEnumerable<GoogleAddressComponent>? components, string? formattedAddress)
    {
        var parts = components?.ToList() ?? new List<GoogleAddressComponent>();
        string? Long(string type) => parts.FirstOrDefault(c => c.Types?.Contains(type) == true)?.LongText?.Trim() is { Length: > 0 } t ? t : null;

        var formatted = WithoutCountry(formattedAddress);
        var route = Long("route");
        var street = route is null
            ? formatted.Split(',')[0].Trim()
            : string.Join(' ', new[] { string.Join('/', new[] { Long("subpremise"), Long("street_number") }.OfType<string>()), route }.Where(s => s.Length > 0));

        var suburb = Long("locality") ?? Long("sublocality_level_1") ?? Long("postal_town") ?? "";
        var state = parts.FirstOrDefault(c => c.Types?.Contains("administrative_area_level_1") == true)?.ShortText?.Trim() ?? "";
        return new AddressDetailsDto(street, suburb, States.Contains(state) ? state : "", Long("postal_code") ?? "", formatted);
    }

    /// <summary>Google ends every Australian address with ", Australia", which the form's fields never hold.</summary>
    public static string WithoutCountry(string? text)
    {
        var t = text?.Trim() ?? "";
        return t.EndsWith(Country, StringComparison.OrdinalIgnoreCase) ? t[..^Country.Length].TrimEnd() : t;
    }
}
