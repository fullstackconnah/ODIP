using System.Security.Claims;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;

namespace Odip.Api.Services;

/// <summary>What making sure of one staff member's sign-in account came to: the account, or the refusal (BadGateway: Firebase failed, not the row).</summary>
public sealed record SignInAccountOutcome(SignInAccountDto? Account, string? Error, bool BadGateway);

/// <summary>
/// POST staff/{id}/sign-in-account's step for one staff member, shared with the onboarding import's invites: the same guards, then a verified,
/// passwordless Firebase account when there is none. The browser sends the set-password email afterwards.
/// </summary>
public static class SignInAccounts
{
    public static async Task<SignInAccountOutcome> EnsureAsync(User s, ClaimsPrincipal? caller, IConfiguration? config, IFirebaseUserService firebase,
        ILogger? logger, CancellationToken ct)
    {
        var isSuperAdmin = caller?.IsInRole("SuperAdmin") ?? false;
        // The same §4.1 guardrail as every other staff write: only a SuperAdmin touches a SuperAdmin account.
        if (s.Role == UserRole.SuperAdmin && !isSuperAdmin) return new(null, "Cannot edit a SuperAdmin account.", false);
        if (!s.IsActive) return new(null, "This staff member is inactive, so they cannot be given a sign-in account.", false);
        if (string.IsNullOrWhiteSpace(s.Email)) return new(null, "This staff member has no email address.", false);

        var email = EmailIdentity.Normalise(s.Email);
        // An address the app invented for a row that had none (see PlaceholderEmail) can never receive the link, so no account is made for it.
        if (PlaceholderEmail.Covers(email)) return new(null, PlaceholderEmail.Message(s.FullName), false);
        var domain = SuperAdminDomain.From(config);
        if (!isSuperAdmin && SuperAdminDomain.Covers(email, domain)) return new(null, SuperAdminDomain.ReservedMessage(domain), false);

        try
        {
            var result = await firebase.EnsureSignInAccountAsync(email, s.FullName, ct);
            var account = result == SignInAccountResult.Created ? FirebaseAccountStatus.Created : FirebaseAccountStatus.Existing;
            // No audit record exists for this (the email itself goes from the browser to Firebase), so this line is the only trace of who asked.
            logger?.LogInformation("Sign-in account for user {TargetUserId} was {Account}, as asked by {ActorUserId}", s.Id, account,
                caller?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown");
            return new(new SignInAccountDto(account), null, false);
        }
        catch (Exception ex) when (FirebaseFailures.IsInvalidEmail(ex))
        {
            // Firebase refused the address itself: correcting it can fix that and retrying cannot, so it is the admin's to act on (400).
            logger?.LogWarning("Firebase refused the address of staff member {UserId} as invalid", s.Id);
            return new(null, "That doesn't look like a valid email address. Correct it first.", false);
        }
        catch (Exception ex)
        {
            // Deliberately broad, as in AdminUsersController.Create: an unusable service account is not a FirebaseAuthException, and the same call
            // with no Firebase app configured fails the same way. The address is not logged (the onboarding import logs no row values); the user
            // id finds it.
            logger?.LogError("Failed to ensure a Firebase sign-in account for user {UserId} ({ExceptionType})", s.Id, ex.GetType().Name);
            return new(null, "Unable to set up the staff member's sign-in account. If it keeps happening, ask whoever runs the Firebase project.", true);
        }
    }
}
