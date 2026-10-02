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

    /// <summary>
    /// Makes sure a Firebase sign-in account exists for this address, so a set-password email can be sent to it. When there is none it
    /// creates one (verified, no password: only the mailbox owner can set one from the emailed link). When there is one it is left
    /// EXACTLY as it is: not marked verified and its password untouched, because an account that already exists may be someone's own
    /// sign-up for an address they do not own. Throws on any other failure, as <see cref="CreateUserAsync"/> does.
    /// </summary>
    Task<SignInAccountResult> EnsureSignInAccountAsync(string email, string displayName, CancellationToken ct);
}

/// <summary>What <see cref="IFirebaseUserService.EnsureSignInAccountAsync"/> found or did.</summary>
public enum SignInAccountResult
{
    /// <summary>There was no account; one was created.</summary>
    Created,

    /// <summary>An account already existed and was left as it was.</summary>
    Existing,
}

/// <inheritdoc cref="IFirebaseUserService"/>
public class FirebaseUserService : IFirebaseUserService
{
    public async Task<string> CreateUserAsync(string email, string displayName, string? password, CancellationToken ct)
    {
        var record = await FirebaseAuth.DefaultInstance.CreateUserAsync(BuildCreateUserArgs(email, displayName, password), ct);
        return record.Uid;
    }

    public async Task<SignInAccountResult> EnsureSignInAccountAsync(string email, string displayName, CancellationToken ct)
    {
        try
        {
            await FirebaseAuth.DefaultInstance.GetUserByEmailAsync(email, ct);
            return SignInAccountResult.Existing;
        }
        catch (FirebaseAuthException ex) when (ex.AuthErrorCode == AuthErrorCode.UserNotFound)
        {
            // No account yet: fall through and create one.
        }

        try
        {
            await FirebaseAuth.DefaultInstance.CreateUserAsync(BuildCreateUserArgs(email, displayName, password: null), ct);
            return SignInAccountResult.Created;
        }
        catch (FirebaseAuthException ex) when (ex.AuthErrorCode == AuthErrorCode.EmailAlreadyExists)
        {
            // Someone created it between the lookup and the create. Still not ours to change.
            return SignInAccountResult.Existing;
        }
    }

    /// <summary>
    /// The Firebase create-user spec for every account the app provisions on someone's behalf: an admin
    /// creating a user, the first user of a new tenant, and <see cref="EnsureSignInAccountAsync"/>. Public and
    /// static so it can be unit tested without a live Firebase connection — FirebaseAuth.DefaultInstance
    /// cannot run offline.
    /// </summary>
    public static UserRecordArgs BuildCreateUserArgs(string email, string displayName, string? password) => new()
    {
        Email = email,
        DisplayName = displayName,
        Password = password,
        Disabled = false,
        // AuthController.Exchange refuses unverified emails and nothing ever sends an app-created user a
        // verification link, so without this the account could never sign in. The admin vouches for the
        // address, and Firebase allows only one email/password account per address, so nobody else can
        // register it afterwards. With no password the account stays unusable until its owner follows the
        // emailed set-password link, which proves they control the mailbox. Creation only: never set this in
        // UpdateUserByEmailAsync, whose account may pre-date the app or be someone else's own sign-up.
        EmailVerified = true,
    };

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
