using System.Security.Cryptography;
using System.Text;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Caregiver link tokens: 32 random bytes, base64url in the link, SHA-256 hex in the database.
/// The raw token exists only in the URL the admin copies; lookup is by hash only.
/// </summary>
public static class CaregiverTokenService
{
    public static string GenerateRawToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static string Hash(string rawToken)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(digest).ToLowerInvariant();
    }
}
