using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Who an agreement is from, as the PDF names them under its title: the organisation's name, ABN and NDIS registration number, each only when it has been set (one that is not is left
/// out, never replaced by a placeholder), and the time zone the PDF's dates are written in. Read from the organisation's <see cref="ProviderSettings"/>; the zone is the one the rest of the
/// app uses for the provider, from the settings' state (Sydney when there are none).
/// </summary>
public sealed record AgreementProvider(string? Name, string? Abn, string? RegistrationNumber, TimeZoneInfo Zone)
{
    /// <summary>The provider of <paramref name="settings"/>, or of no settings at all: no name, no ABN, no number, and the app's fallback zone.</summary>
    public static AgreementProvider From(ProviderSettings? settings) =>
        new(Set(settings?.OrganisationName), Set(settings?.ABN), Set(settings?.RegistrationNumber), ProviderTimeZoneResolver.FromState(settings?.State).Zone);

    /// <summary>"Oassist · ABN 12 345 678 901 · NDIS registration 4-ABC-123" with whichever of the three is set; null when none is.</summary>
    public string? Line
    {
        get
        {
            var parts = new[] { Name, Abn is null ? null : "ABN " + FormatAbn(Abn), RegistrationNumber is null ? null : "NDIS registration " + RegistrationNumber }.Where(part => part is not null).ToList();
            return parts.Count == 0 ? null : string.Join(" · ", parts);
        }
    }

    private static string? Set(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>An ABN is written in groups, "12 345 678 901". Anything that is not eleven digits (with or without spaces) is printed as it was typed.</summary>
    private static string FormatAbn(string abn)
    {
        var compact = new string(abn.Where(character => !char.IsWhiteSpace(character)).ToArray());
        return compact.Length == 11 && compact.All(char.IsAsciiDigit) ? $"{compact[..2]} {compact[2..5]} {compact[5..8]} {compact[8..]}" : abn;
    }
}
