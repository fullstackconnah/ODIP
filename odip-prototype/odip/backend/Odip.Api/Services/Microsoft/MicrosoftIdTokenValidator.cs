using System.Globalization;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Odip.Api.Services.Microsoft;

/// <summary>Who Microsoft says signed in. <see cref="EmailDomainVerified"/> is the xms_edov claim: only then may a row be created from <see cref="Email"/>.</summary>
public sealed record MicrosoftIdentity(Guid TenantId, Guid ObjectId, string? Email, bool EmailDomainVerified,
    string? GivenName = null, string? FamilyName = null, string? DisplayName = null);

/// <summary>Either an identity or a <see cref="MicrosoftRefusal"/> code.</summary>
public sealed record MicrosoftIdTokenResult(MicrosoftIdentity? Identity, string? Refusal)
{
    public static MicrosoftIdTokenResult Refused(string code) => new(null, code);
}

public interface IMicrosoftIdTokenValidator
{
    Task<MicrosoftIdTokenResult> ValidateAsync(string idToken, string expectedNonce, CancellationToken ct);
}

public sealed class MicrosoftIdTokenValidator : IMicrosoftIdTokenValidator
{
    public const string ConsumerTenantId = "9188040d-6c67-4c5b-b112-36a304b66dad";

    private readonly IConfigurationManager<OpenIdConnectConfiguration> _metadata;
    private readonly string _clientId;

    public MicrosoftIdTokenValidator(IConfigurationManager<OpenIdConnectConfiguration> metadata, IConfiguration config)
    {
        _metadata = metadata;
        _clientId = config["Microsoft:ClientId"] ?? "";
    }

    public async Task<MicrosoftIdTokenResult> ValidateAsync(string idToken, string expectedNonce, CancellationToken ct)
    {
        var result = await ValidateOnceAsync(idToken, ct);
        // Key rollover: Microsoft publishes the new key before it signs with it, but our cached copy may be older. One refresh, one retry.
        if (!result.IsValid && result.Exception is SecurityTokenSignatureKeyNotFoundException)
        {
            _metadata.RequestRefresh();
            result = await ValidateOnceAsync(idToken, ct);
        }
        if (!result.IsValid || result.SecurityToken is not JsonWebToken jwt) return MicrosoftIdTokenResult.Refused(MicrosoftRefusal.InvalidToken);

        string? Claim(string type) => jwt.Claims.FirstOrDefault(c => c.Type == type)?.Value;

        if (string.IsNullOrEmpty(expectedNonce) || Claim("nonce") != expectedNonce) return MicrosoftIdTokenResult.Refused(MicrosoftRefusal.InvalidToken);
        if (!Guid.TryParse(Claim("tid"), out var tid)) return MicrosoftIdTokenResult.Refused(MicrosoftRefusal.InvalidToken);
        if (tid == Guid.Parse(ConsumerTenantId)) return MicrosoftIdTokenResult.Refused(MicrosoftRefusal.MicrosoftPersonalAccount);
        var idp = Claim("idp");
        var acct = Claim("acct");
        if ((idp is not null && idp != jwt.Issuer) || (acct is not null && acct != "0")) return MicrosoftIdTokenResult.Refused(MicrosoftRefusal.MicrosoftGuest);
        if (!Guid.TryParse(Claim("oid"), out var oid)) return MicrosoftIdTokenResult.Refused(MicrosoftRefusal.InvalidToken);

        var email = Claim("email");
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@')) email = Claim("preferred_username");
        if (email is not null && !email.Contains('@')) email = null;
        var edov = Claim("xms_edov");
        var verified = string.Equals(edov, "true", StringComparison.OrdinalIgnoreCase) || edov == "1";
        return new MicrosoftIdTokenResult(new MicrosoftIdentity(tid, oid, email?.Trim(), verified, Claim("given_name"), Claim("family_name"), Claim("name")), null);
    }

    private async Task<TokenValidationResult> ValidateOnceAsync(string idToken, CancellationToken ct)
    {
        var cfg = await _metadata.GetConfigurationAsync(ct);
        var parameters = new TokenValidationParameters
        {
            ValidAudience = _clientId,
            // shortcut: exact-match issuer instead of AadIssuerValidator (no Validators package, no network); revisit if sovereign clouds are ever needed.
            IssuerValidator = (issuer, token, _) =>
            {
                var tid = (token as JsonWebToken)?.Claims.FirstOrDefault(c => c.Type == "tid")?.Value;
                if (!Guid.TryParse(tid, out var g) || issuer != $"https://login.microsoftonline.com/{g.ToString("D", CultureInfo.InvariantCulture)}/v2.0")
                    throw new SecurityTokenInvalidIssuerException("issuer does not match tid") { InvalidIssuer = issuer };
                return issuer;
            },
            IssuerSigningKeys = cfg.SigningKeys,
            ValidAlgorithms = new[] { SecurityAlgorithms.RsaSha256 },
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2),
        };
        return await new JsonWebTokenHandler().ValidateTokenAsync(idToken, parameters);
    }
}
