using FirebaseAdmin.Auth;

namespace Odip.Api.Services;

/// <summary>
/// Thin seam over the Firebase Admin SDK's static <see cref="FirebaseAuth.DefaultInstance"/>,
/// introduced so controllers that need to keep ODIP's database in sync with Firebase Auth can
/// be unit tested (via <see cref="IFirebaseUserService"/> + Moq) without a live Firebase
/// connection or a real service account.
/// </summary>
public interface IFirebaseUserService
{
    /// <summary>
    /// Creates a Firebase Auth user and returns the new user's Firebase UID.
    /// Throws <see cref="FirebaseAuthException"/> (e.g. <see cref="AuthErrorCode.EmailAlreadyExists"/>)
    /// or a lower-level transport/credential exception raised by the underlying Google.Apis auth
    /// stack (e.g. a TokenResponseException when the service account cannot be authenticated) on
    /// failure. Callers must not persist any paired local state until this call succeeds.
    /// </summary>
    Task<string> CreateUserAsync(string email, string displayName, string? password, CancellationToken ct);

    /// <summary>
    /// Resolves a Firebase Auth user by email and updates their display name / disabled state.
    /// Throws <see cref="FirebaseAuthException"/> with <see cref="AuthErrorCode.UserNotFound"/> if
    /// no Firebase account exists for that email (expected for users created before Firebase sync
    /// existed), or another exception for any other failure.
    /// </summary>
    Task UpdateUserByEmailAsync(string email, string displayName, bool disabled, CancellationToken ct);

    /// <summary>
    /// Deletes a Firebase Auth user by UID. Used as best-effort compensation to undo a Firebase
    /// create/update whose paired database write subsequently failed, so Firebase and the ODIP
    /// database never silently diverge. Swallows failures — this is cleanup, not the primary
    /// operation, and there is nothing more we can do if it also fails.
    /// </summary>
    Task DeleteUserAsync(string uid, CancellationToken ct);
}

/// <inheritdoc cref="IFirebaseUserService"/>
public class FirebaseUserService : IFirebaseUserService
{
    public async Task<string> CreateUserAsync(string email, string displayName, string? password, CancellationToken ct)
    {
        var record = await FirebaseAuth.DefaultInstance.CreateUserAsync(new UserRecordArgs
        {
            Email = email,
            DisplayName = displayName,
            Password = password,
            Disabled = false,
        }, ct);
        return record.Uid;
    }

    public async Task UpdateUserByEmailAsync(string email, string displayName, bool disabled, CancellationToken ct)
    {
        var firebaseUser = await FirebaseAuth.DefaultInstance.GetUserByEmailAsync(email, ct);
        await FirebaseAuth.DefaultInstance.UpdateUserAsync(new UserRecordArgs
        {
            Uid = firebaseUser.Uid,
            DisplayName = displayName,
            Disabled = disabled,
        }, ct);
    }

    public async Task DeleteUserAsync(string uid, CancellationToken ct)
    {
        try
        {
            await FirebaseAuth.DefaultInstance.DeleteUserAsync(uid, ct);
        }
        catch (FirebaseAuthException)
        {
            // Best-effort compensation only — nothing more we can do if this also fails.
        }
    }
}
