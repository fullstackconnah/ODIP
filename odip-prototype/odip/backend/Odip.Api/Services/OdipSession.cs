using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>The ODIP session JWT and its cookie, shared by every sign-in path (Firebase exchange, Microsoft).</summary>
public static class OdipSession
{
    public const string CookieName = "odip_jwt";

    public static void SetCookie(HttpResponse response, string token)
    {
        response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Expires = DateTimeOffset.UtcNow.AddDays(7),
            Path = "/api"
        });
    }

    public static readonly TimeSpan TokenLife = TimeSpan.FromMinutes(30);

    // The limit counts from sign-in, not from the last request. Null = no limit, which is every organisation until an Admin chooses one.
    // A sign-in time in the future (clock skew) counts as now.
    public static bool Ended(DateTime nowUtc, DateTime signedInAtUtc, int? limitMinutes) =>
        limitMinutes is { } m && nowUtc >= Earlier(signedInAtUtc, nowUtc).AddMinutes(m);

    /// <summary>Every token lasts 30 minutes, or until the sign-in limit if that comes first.</summary>
    public static DateTime ExpiresAt(DateTime nowUtc, DateTime signedInAtUtc, int? limitMinutes)
    {
        var expiry = nowUtc + TokenLife;
        return limitMinutes is { } m ? Earlier(expiry, Earlier(signedInAtUtc, nowUtc).AddMinutes(m)) : expiry;
    }

    private static DateTime Earlier(DateTime a, DateTime b) => a <= b ? a : b;

    /// <summary>
    /// When the person signed in, from the Firebase token's auth_time (epoch seconds). Firebase carries auth_time unchanged across silent token
    /// refreshes (getIdToken(true)); it moves only when the person signs in again. The SDK's runtime type is not pinned by the fixture, so read it
    /// as a long, int, double or numeric string; anything else is unreadable (null).
    /// </summary>
    public static DateTime? AuthTime(IReadOnlyDictionary<string, object> claims)
    {
        if (!claims.TryGetValue("auth_time", out var raw)) return null;
        long? seconds = raw switch
        {
            long l => l,
            int i => i,
            double d when double.IsFinite(d) => (long)d,
            string s when long.TryParse(s, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null,
        };
        return seconds is { } v && v is > 0 and < 253402300799 ? DateTimeOffset.FromUnixTimeSeconds(v).UtcDateTime : null;
    }

    /// <summary>The organisation's session length in minutes; null = none. Explicit tenant: the exchange runs anonymous, so the query filter admits nothing.</summary>
    public static Task<int?> SessionLengthFor(OdipDbContext db, Guid tenantId, CancellationToken ct) =>
        db.AppSettings.IgnoreQueryFilters([TenantFilter.Name]).Where(s => s.TenantId == tenantId).OrderBy(s => s.Id)
            .Select(s => s.SessionLengthMinutes).FirstOrDefaultAsync(ct);

    public static string Token(Domain.Entities.User user, Guid tenantId, IConfiguration config, DateTime expiresAtUtc)
    {
        var creds = new SigningCredentials(SigningKey(config), SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim("fullName", user.FullName),
            new Claim("tenant_id", tenantId.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: "Odip",
            audience: "Odip",
            claims: claims,
            expires: expiresAtUtc,
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public static SymmetricSecurityKey SigningKey(IConfiguration config)
    {
        var secret = config["Jwt:Secret"];
        if (string.IsNullOrEmpty(secret))
            secret = Environment.GetEnvironmentVariable("JWT_SECRET");
        if (string.IsNullOrEmpty(secret))
            throw new InvalidOperationException("JWT_SECRET must be configured.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    }
}
