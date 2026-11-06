namespace Odip.Application.DTOs;

/// <summary>One address suggestion: the place id the details call needs, and the two lines the list shows.</summary>
public sealed record AddressSuggestionDto(string PlaceId, string MainText, string SecondaryText);

/// <summary>A picked place split into the app's four address fields. A part the place lacks is empty; State is one of NSW VIC QLD WA SA TAS ACT NT or empty.</summary>
public sealed record AddressDetailsDto(string Street, string Suburb, string State, string Postcode, string FormattedAddress);

/// <summary>The suggest body. The typed text travels here, never in a URL, so no proxy in front of the app can log it.</summary>
public sealed record AddressSuggestRequest(string? Q, string? Session);
