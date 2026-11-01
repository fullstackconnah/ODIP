namespace Odip.Api.Services;

/// <summary>
/// Why <c>AuthController.Exchange</c> refused a sign-in, as a machine-readable code on the response (<c>ApiResponse.Code</c>), so the sign-in page can
/// tell the person what to do instead of "login failed". The status never changes (a refusal is always 401; the 429 the sign-in page words as
/// <see cref="LockedOut"/> is the "login" flood limiter's); only the body says more.
///
/// Why each code is safe to say. The exchange decides in a fixed order, and that order is what keeps this from being an account-enumeration channel:
/// <list type="number">
/// <item>The token must verify with Firebase, carry an email and say how the person signed in, or it is <see cref="InvalidToken"/>: deliberately
/// generic, because it says nothing the person can act on and a fault with the token (or the SDK) must not pose as one of the others.</item>
/// <item>The email must be verified, or it is <see cref="EmailNotVerified"/>. Firebase lets ANYONE sign up with ANY address and hold a token for it,
/// so a valid token proves nothing about the mailbox, and this is decided from the token alone: it answers the same for an address ODIP knows and one it
/// does not.</item>
/// <item>The provider must be one ODIP trusts, or it is <see cref="ProviderNotAllowed"/>, again from the token alone.</item>
/// <item>Only then does the exchange look at ODIP's own rows: <see cref="NoOdipAccount"/>, <see cref="Ambiguous"/>, <see cref="TenantInactive"/>, <see cref="AddressUnconfirmed"/>.
/// A token that got this far proves control of the mailbox, so these are shown only to the owner of the address, and only about their own address.</item>
/// </list>
/// <see cref="LockedOut"/> is no longer sent by the exchange (the failure counter was removed); the sign-in page still words it for any 429, which is now only the flood limiter.
/// </summary>
public static class ExchangeRefusal
{
    /// <summary>The token did not verify, or lacks what the exchange needs (an email, a readable provider). Generic on purpose.</summary>
    public const string InvalidToken = "InvalidToken";

    /// <summary>The token is genuine but its email is not verified: an account Firebase created without the owner proving the mailbox.</summary>
    public const string EmailNotVerified = "EmailNotVerified";

    /// <summary>The token's sign-in provider is not one of <see cref="SignInProviders"/>'s.</summary>
    public const string ProviderNotAllowed = "ProviderNotAllowed";

    /// <summary>A verified address that no active ODIP user (or SuperAdmin) holds.</summary>
    public const string NoOdipAccount = "NoOdipAccount";

    /// <summary>
    /// The address is held by more than one active user, so nobody is signed in rather than guessing which. The words say no more than to ask the administrator:
    /// that the address is shared, and by whom, is for the log (both user ids) and the runbook.
    /// </summary>
    public const string Ambiguous = "Ambiguous";

    /// <summary>The user's organisation is inactive (or missing).</summary>
    public const string TenantInactive = "TenantInactive";

    /// <summary>The user's address came from the Employment Hero sync and waits for an Admin to confirm it (<c>User.SignInAddressUnconfirmed</c>).</summary>
    public const string AddressUnconfirmed = "AddressUnconfirmed";

    /// <summary>The organisation limits how long a sign-in lasts and this one has used it up: the person signs in again. Decided only after the address is verified.</summary>
    public const string SessionLengthReached = "SessionLengthReached";

    /// <summary>Too many sign-in requests from this client: the "login" flood limiter, 60 per 5 minutes (a 429 with a Retry-After header).</summary>
    public const string LockedOut = "LockedOut";

    /// <summary>The plain sentence that goes in <c>errors[0]</c>. The sign-in page words its own, from the code.</summary>
    public static string MessageFor(string code) => code switch
    {
        EmailNotVerified => "The email address on this sign-in has not been verified.",
        ProviderNotAllowed => "This sign-in method is not enabled for Bunya Support.",
        NoOdipAccount => "No active Bunya Support account uses this email address.",
        Ambiguous => "We can't sign you in with this email address yet. Ask your administrator to check your account.",
        TenantInactive => "The organisation this account belongs to is inactive.",
        AddressUnconfirmed => "Your organisation needs to confirm this email address before you can sign in to Bunya Support.",
        SessionLengthReached => "Sign in again.",
        LockedOut => "Too many failed sign-in attempts. Try again shortly.",
        _ => "Invalid or expired token",
    };
}
