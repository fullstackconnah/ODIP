using FirebaseAdmin;
using FirebaseAdmin.Auth;

namespace Odip.Api.Services;

/// <summary>
/// What the Firebase Admin SDK's failures mean, read once so a caller can answer a person in terms that tell them what to do: an address that
/// needs correcting is the admin's to fix, anything else is not theirs and retrying is no promise.
/// </summary>
public static class FirebaseFailures
{
    /// <summary>
    /// Whether Firebase refused the ADDRESS itself as malformed (a legacy row with a typo, "jane@acme"). The .NET SDK validates nothing locally and has
    /// no AuthErrorCode for this: the backend's 400 INVALID_EMAIL comes back as a <see cref="FirebaseAuthException"/> with
    /// <see cref="ErrorCode.InvalidArgument"/> and the raw response body in the message (see FirebaseTestExceptions for the shape). Retrying cannot fix
    /// it; correcting the address can. Other 400s (a weak password) are deliberately not matched.
    /// </summary>
    public static bool IsInvalidEmail(Exception failure) =>
        failure is FirebaseAuthException { ErrorCode: ErrorCode.InvalidArgument } refused
        && refused.Message.Contains("INVALID_EMAIL", StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Whether a failure is the Admin SDK failing to PARSE the token string at all, rather than refusing a token it understood. The
/// distinction matters because the two need opposite handling at the exchange: a parsed-but-refused token arrives as
/// <see cref="FirebaseAuthException"/> and is caught by name, while a parse failure is whatever the SDK's own decoders throw and used to
/// escape the controller entirely.
/// <para>
/// Measured against FirebaseAdmin 3.5.0 across malformed shapes (every one of these reached the SDK through
/// <see cref="FirebaseIdTokenShape"/>): "aaa.bbb.ccc" and other three-segment tokens parse-fail as
/// <c>Newtonsoft.Json.JsonReaderException</c>; short segments such as "a.b.c" fail as <see cref="FormatException"/> while decoding the
/// signature; an all-dots token such as ".." fails as <see cref="NullReferenceException"/>, which is an SDK defect rather than a caller
/// error and is the reason the shape guard exists ahead of this.
/// </para>
/// <para>
/// Only these types are matched, by type, never by message. A catch-all here would swallow genuine faults (a null reference from ODIP's
/// own code, a cancellation) and answer them to a stranger as "Invalid or expired token", so anything not in this set is left to
/// propagate and be logged as the 500 it actually is.
/// </para>
/// </summary>
public static class FirebaseTokenParseFailures
{
    /// <summary>
    /// True when <paramref name="failure"/> is a token the SDK could not even decode, so no caller could have prevented it by signing in
    /// differently and retrying is pointless: the answer is the same generic refusal as any other unusable token.
    /// </summary>
    public static bool IsUndecodableToken(Exception failure) =>
        failure is Newtonsoft.Json.JsonException        // JsonReaderException/JsonSerializationException: payload is not a JSON object
        or FormatException                            // a segment is not decodable base64url
        or ArgumentException;                         // e.g. "" -> "ID token must not be null or empty."
}
