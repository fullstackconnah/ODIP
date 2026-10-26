namespace Odip.Api.Services.Microsoft;

/// <summary>The three settings that switch Microsoft sign-in on. Null means off: compose passes empty strings for unset variables, so blank counts as unset.</summary>
public sealed record MicrosoftSignInConfig(string ClientId, string ClientSecret, string PublicBaseUrl)
{
    public const string CallbackPath = "/api/v1/auth/microsoft/callback";

    /// <summary>The redirect URI registered with Entra. Built from config, never from the request Host.</summary>
    public string RedirectUri => PublicBaseUrl + CallbackPath;

    public string StartUrl(string intent) => $"{PublicBaseUrl}/api/v1/auth/microsoft/start?intent={intent}";

    public static MicrosoftSignInConfig? From(IConfiguration config)
    {
        var id = config["Microsoft:ClientId"];
        var secret = config["Microsoft:ClientSecret"];
        var baseUrl = config["Microsoft:PublicBaseUrl"];
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(baseUrl)) return null;
        // Secure cookies and Entra's redirect both need https, so a plain-http or relative base cannot work and turns the feature off.
        if (!Uri.TryCreate(baseUrl.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps) return null;
        return new MicrosoftSignInConfig(id.Trim(), secret.Trim(), baseUrl.Trim().TrimEnd('/'));
    }
}
