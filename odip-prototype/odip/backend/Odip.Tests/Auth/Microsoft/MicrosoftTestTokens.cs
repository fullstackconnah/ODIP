using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Odip.Api.Services.Microsoft;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>Real-crypto Entra-shaped ID tokens signed with a test RSA key, and a validator wired to publish that key.</summary>
public static class MicrosoftTestTokens
{
    public const string ClientId = "11111111-2222-3333-4444-555555555555";
    public static readonly Guid OrgTid = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    public static readonly Guid OtherTid = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");
    public static readonly Guid Consumer = Guid.Parse(MicrosoftIdTokenValidator.ConsumerTenantId);

    public static readonly RsaSecurityKey Key = new(RSA.Create(2048)) { KeyId = "test-kid" };

    /// <summary>Publishes <see cref="Keys"/> and counts RequestRefresh, so a test can prove the one key-rollover retry.</summary>
    public sealed class CountingMetadata : IConfigurationManager<OpenIdConnectConfiguration>
    {
        public List<SecurityKey> Keys { get; } = new() { Key };
        public int Refreshes { get; private set; }

        /// <summary>Runs on RequestRefresh: lets a test publish a new key only after the refresh.</summary>
        public Action? OnRefresh { get; set; }

        public Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancel)
        {
            var cfg = new OpenIdConnectConfiguration();
            foreach (var k in Keys) cfg.SigningKeys.Add(k);
            return Task.FromResult(cfg);
        }

        public void RequestRefresh()
        {
            Refreshes++;
            OnRefresh?.Invoke();
        }
    }

    public static MicrosoftIdTokenValidator Validator(CountingMetadata? metadata = null) => new(
        metadata ?? new CountingMetadata(),
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Microsoft:ClientId"] = ClientId }).Build());

    public static string Mint(Guid? tid = null, Guid? oid = null, string? nonce = "n1", string aud = ClientId, string? iss = null,
        string? email = "pat@contoso.example", string? upn = null, IDictionary<string, object>? extra = null, DateTime? expires = null,
        SecurityKey? key = null, string alg = SecurityAlgorithms.RsaSha256, bool omitTid = false, bool omitOid = false)
    {
        var t = tid ?? OrgTid;
        var claims = new Dictionary<string, object>();
        if (!omitTid) claims["tid"] = t.ToString();
        if (!omitOid) claims["oid"] = (oid ?? Guid.Parse("cccccccc-0000-0000-0000-000000000003")).ToString();
        if (nonce is not null) claims["nonce"] = nonce;
        if (email is not null) claims["email"] = email;
        if (upn is not null) claims["preferred_username"] = upn;
        if (extra is not null) foreach (var kv in extra) claims[kv.Key] = kv.Value;
        var exp = expires ?? DateTime.UtcNow.AddMinutes(30);
        var desc = new SecurityTokenDescriptor
        {
            Issuer = iss ?? $"https://login.microsoftonline.com/{t}/v2.0",
            Audience = aud,
            Claims = claims,
            NotBefore = exp.AddHours(-1) < DateTime.UtcNow ? exp.AddHours(-1) : DateTime.UtcNow.AddMinutes(-1),
            Expires = exp,
            SigningCredentials = new SigningCredentials(key ?? Key, alg),
        };
        return new JsonWebTokenHandler().CreateToken(desc);
    }
}
