using System.Text.Json;
using Newtonsoft.Json.Linq;

namespace Odip.Api.Services;

/// <summary>
/// Which Firebase sign-in providers the exchange lets in, and how it reads the one a token came from. The exchange takes a token's verified email as
/// the whole identity, and what "verified" proves depends on the provider: for email and password it is control of the mailbox; for a federated
/// provider it is whatever that provider asserts (a Microsoft work account's email attribute can be set by its own tenant admin). The Firebase
/// project's web API key is public, so anyone can present a token from every provider enabled in the console. Adding a provider (Microsoft, Google) is
/// therefore a decision to trust its email, made in <see cref="ConfigKey"/> and not by the console switch alone.
/// </summary>
public static class SignInProviders
{
    public const string ConfigKey = "Auth:AllowedSignInProviders";

    // "password" is email and password (and the emailed sign-in link). "custom" is a token minted with the project's service-account key, which only
    // whoever already holds that key can do.
    private static readonly string[] Default = ["password", "custom"];

    private const string ClaimName = "firebase";
    private const string ProviderKey = "sign_in_provider";

    /// <summary>
    /// The providers allowed to sign in, compared without regard to case: <see cref="ConfigKey"/> as a list (appsettings, or Auth__AllowedSignInProviders__0
    /// in the environment) or as one comma-separated value; password and custom when it is not set, or set to nothing.
    /// </summary>
    public static IReadOnlySet<string> Allowed(IConfiguration? config)
    {
        var section = config?.GetSection(ConfigKey);
        var configured = (section?.GetChildren().Select(child => child.Value) ?? [])
            .Concat((section?.Value ?? string.Empty).Split(',', ';'))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!.Trim())
            .ToList();

        return new HashSet<string>(configured.Count > 0 ? configured : Default, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The token's <c>firebase.sign_in_provider</c> ("password", "google.com", "custom", ...), or null when the token carries none in a form this can
    /// read, which the exchange treats as a refusal rather than a guess.
    /// </summary>
    public static string? From(IReadOnlyDictionary<string, object> claims)
    {
        if (!claims.TryGetValue(ClaimName, out var firebase) || firebase is null)
            return null;

        // The Admin SDK decodes the payload with Newtonsoft into a Dictionary<string, object>, so the nested "firebase" object arrives as a JObject (the
        // exchange tests build their claims through that same decoding, and SignInProvidersTests pins the shape). The other arms cover a different
        // decoder, such as an SDK that moved to System.Text.Json, so that a change of that kind does not turn every sign-in into a refusal.
        object? provider = firebase switch
        {
            JObject json => json.TryGetValue(ProviderKey, out var token) && token.Type == JTokenType.String ? token.Value<string>() : null,
            JsonElement { ValueKind: JsonValueKind.Object } json =>
                json.TryGetProperty(ProviderKey, out var element) && element.ValueKind == JsonValueKind.String ? element.GetString() : null,
            IReadOnlyDictionary<string, object> map => map.TryGetValue(ProviderKey, out var value) ? value : null,
            _ => null,
        };

        return provider is string name && !string.IsNullOrWhiteSpace(name) ? name.Trim() : null;
    }
}
