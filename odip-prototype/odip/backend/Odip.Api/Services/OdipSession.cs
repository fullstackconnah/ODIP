using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

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

    // STUBS for the red run.
    public static bool Ended(DateTime nowUtc, DateTime signedInAtUtc, int? limitMinutes) => false;
    public static DateTime ExpiresAt(DateTime nowUtc, DateTime signedInAtUtc, int? limitMinutes) => nowUtc + TokenLife;
    public static DateTime? AuthTime(IReadOnlyDictionary<string, object> claims) => null;

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
