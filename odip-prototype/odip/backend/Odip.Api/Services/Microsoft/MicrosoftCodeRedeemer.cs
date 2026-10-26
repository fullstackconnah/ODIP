namespace Odip.Api.Services.Microsoft;

public interface IMicrosoftCodeRedeemer
{
    /// <summary>Exchanges the authorization code for an ID token (PKCE). Null on any non-2xx answer or a missing id_token.</summary>
    Task<string?> RedeemAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct);
}

public sealed class MicrosoftCodeRedeemer : IMicrosoftCodeRedeemer
{
    public const string TokenEndpoint = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";

    private readonly HttpClient _http;
    private readonly IConfiguration _config;

    public MicrosoftCodeRedeemer(HttpClient http, IConfiguration config)
    {
        _http = http;
        _config = config;
    }

    public async Task<string?> RedeemAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct)
    {
        var form = new Dictionary<string, string>
        {
            ["client_id"] = _config["Microsoft:ClientId"] ?? "",
            ["client_secret"] = _config["Microsoft:ClientSecret"] ?? "",
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
            ["code_verifier"] = codeVerifier,
            ["scope"] = "openid profile email",
        };
        try
        {
            using var response = await _http.PostAsync(TokenEndpoint, new FormUrlEncodedContent(form), ct);
            if (!response.IsSuccessStatusCode) return null;
            using var doc = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            return doc.RootElement.TryGetProperty("id_token", out var t) && t.ValueKind == System.Text.Json.JsonValueKind.String ? t.GetString() : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            // Entra unreachable or an unreadable body is a failed redemption, not a server fault; the caller refuses the sign-in.
            return null;
        }
    }
}
