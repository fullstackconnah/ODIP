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
