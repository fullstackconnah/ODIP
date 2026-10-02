namespace Odip.Application.DTOs;

/// <summary>
/// What became of a person's Firebase sign-in account, so the screen can say something true about the set-password email it is
/// about to send. <see cref="FirebaseAccount"/> is one of <see cref="FirebaseAccountStatus"/>'s values, lower-case on the wire.
/// </summary>
public record SignInAccountDto(string FirebaseAccount);

/// <summary>The values of <see cref="SignInAccountDto.FirebaseAccount"/>, and of the same field on a create response.</summary>
public static class FirebaseAccountStatus
{
    /// <summary>ODIP created the account just now: verified, no password, so only the mailbox owner can set one.</summary>
    public const string Created = "created";

    /// <summary>An account for this address already existed and was left exactly as it was.</summary>
    public const string Existing = "existing";

    /// <summary>The user exists in ODIP but its sign-in account could not be set up (tenant first user only).</summary>
    public const string Failed = "failed";
}
