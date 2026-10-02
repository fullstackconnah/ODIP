using System.Collections.Immutable;
using System.Reflection;
using System.Text;
using System.Text.Json;
using FirebaseAdmin.Auth;

namespace Odip.Tests.Controllers;

/// <summary>
/// The claims the Firebase Admin SDK hands back for a verified ID token, built by the SDK's own (internal) decoding so a test sees the exact shape
/// production does. That shape is not what a hand-made dictionary suggests: <c>FirebaseTokenVerifier.VerifyTokenAsync</c> decodes the payload with
/// Newtonsoft into a <c>Dictionary&lt;string, object&gt;</c>, drops the standard claims (iss, aud, exp, iat, sub, uid) and keeps the rest as an
/// immutable dictionary, so a nested object such as "firebase" arrives as a Newtonsoft <c>JObject</c> and has to be read as one. A fake that returned
/// a plain dictionary there would pass on a shape production never produces.
/// </summary>
internal static class FirebaseTestClaims
{
    private const BindingFlags All = BindingFlags.Static | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

    /// <summary>The claims for a token whose payload is <paramref name="payloadJson"/>: the steps the SDK takes once it has checked the signature.</summary>
    public static IReadOnlyDictionary<string, object> FromPayload(string payloadJson)
    {
        var sdk = typeof(FirebaseToken).Assembly;
        var decode = sdk.GetType("FirebaseAdmin.Auth.Jwt.JwtUtils")!.GetMethod("Decode", All)!.MakeGenericMethod(typeof(Dictionary<string, object>));
        var standardClaims = (IEnumerable<string>)sdk.GetType("FirebaseAdmin.Auth.Jwt.FirebaseTokenVerifier")!.GetField("StandardClaims", All)!.GetValue(null)!;

        var claims = (Dictionary<string, object>)decode.Invoke(null, [Base64Url(payloadJson)])!;
        foreach (var claim in standardClaims)
            claims.Remove(claim);
        return claims.ToImmutableDictionary();
    }

    /// <summary>
    /// What a person who signed in with <paramref name="signInProvider"/> presents: their email, whether it is verified, and the "firebase" claim a real
    /// token carries. A null provider leaves the "firebase" claim out altogether.
    /// </summary>
    public static IReadOnlyDictionary<string, object> For(string email, bool emailVerified = true, string? signInProvider = "password")
    {
        var payload = new Dictionary<string, object>
        {
            ["iss"] = "https://securetoken.google.com/odip-test", ["aud"] = "odip-test", ["sub"] = "uid-1", ["iat"] = 1, ["exp"] = 2, ["user_id"] = "uid-1",
            ["email"] = email, ["email_verified"] = emailVerified,
        };
        if (signInProvider is not null)
        {
            payload["firebase"] = new Dictionary<string, object>
            {
                ["identities"] = new Dictionary<string, object> { ["email"] = new[] { email } },
                ["sign_in_provider"] = signInProvider,
            };
        }

        return FromPayload(JsonSerializer.Serialize(payload));
    }

    private static string Base64Url(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
