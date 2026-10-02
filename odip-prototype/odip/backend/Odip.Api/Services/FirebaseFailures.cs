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
