using FirebaseAdmin.Auth;

namespace Odip.Api.Services;

/// <summary>
/// Thin seam over the Firebase Admin SDK's static <see cref="FirebaseAuth.DefaultInstance"/> token check, so the sign-in
/// exchange (<c>AuthController.Exchange</c>) can run in a unit test without a live Firebase connection.
/// </summary>
public interface IFirebaseTokenVerifier
{
    /// <summary>
    /// Verifies a Firebase ID token and returns its claims. Throws <see cref="FirebaseAuthException"/> for a token that
    /// does not verify (malformed, expired, wrong project). The claims are the SDK's own: every claim in the payload except iss, aud, exp, iat, sub and uid
    /// (so "email", "email_verified" and "firebase" are among them), and a nested object such as "firebase" is a Newtonsoft JObject
    /// (see <see cref="SignInProviders"/>).
    /// </summary>
    Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct);
}

/// <inheritdoc cref="IFirebaseTokenVerifier"/>
public class FirebaseTokenVerifier : IFirebaseTokenVerifier
{
    public async Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct)
    {
        var decoded = await FirebaseAuth.DefaultInstance.VerifyIdTokenAsync(idToken, ct);
        return decoded.Claims;
    }
}

/// <summary>
/// Whether <paramref name="idToken"/> has the shape of a Firebase ID token at all: three dot-separated segments, each non-empty and
/// wholly in the base64url alphabet. It is a SHAPE test, not a validity test — a forged but well-formed token passes it and is still
/// refused by signature verification.
/// <para>
/// It exists because the Admin SDK's own parse of a malformed token does not fail in one defined way. Measured against FirebaseAdmin
/// 3.5.0, a three-segment token whose segments are not a JWT reaches the payload decoder and throws
/// <c>Newtonsoft.Json.JsonReaderException</c> (which derives from JsonException, so no ArgumentException catch sees it); short segments
/// throw <see cref="FormatException"/>; and an all-dots token such as <c>".."</c> makes the SDK throw
/// <see cref="NullReferenceException"/>. Left alone those escape the exchange as an unhandled 500. This predicate stops the shapes
/// that are not three base64url segments before the SDK is asked, so they are refused the same way as any other bad token.
/// </para>
/// <para>
/// It is deliberately not sufficient on its own and is not relied on to be: "aaa.bbb.ccc" IS three legal base64url segments, so the
/// SDK is still asked to parse it and still throws — which <c>AuthController.Exchange</c> catches (see
/// <see cref="FirebaseTokenParseFailures"/>). Do not "tighten" this into a validator and delete that catch.
/// </para>
/// </summary>
public static class FirebaseIdTokenShape
{
    /// <summary>
    /// True when <paramref name="idToken"/> could be an ID token: non-empty, exactly three <c>.</c>-separated segments, each non-empty
    /// and made only of base64url characters (A–Z, a–z, 0–9, <c>-</c>, <c>_</c>). Padding (<c>=</c>) is excluded because the SDK issues
    /// unpadded base64url, so a padded segment is not one of its tokens.
    /// </summary>
    public static bool LooksLikeAnIdToken(string? idToken)
    {
        if (string.IsNullOrEmpty(idToken))
            return false;

        var segments = idToken.Split('.');
        if (segments.Length != 3)
            return false;

        return segments.All(IsBase64UrlSegment);
    }

    private static bool IsBase64UrlSegment(string segment)
    {
        if (segment.Length == 0)
            return false;

        foreach (var c in segment)
        {
            var allowed = c is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-' or '_';
            if (!allowed)
                return false;
        }

        return true;
    }
}
