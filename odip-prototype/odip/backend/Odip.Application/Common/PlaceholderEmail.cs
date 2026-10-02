namespace Odip.Application.Common;

/// <summary>
/// Addresses the app itself invented for a row that had none, which no mailbox can receive. The staff/user unification migration
/// (20260830130230_StaffUserUnification) gave every staff row with no usable email <c>{username}@placeholder.local</c> so the row could exist.
/// Nothing sent there is ever delivered, so no sign-in account is made for one and no link is "sent" to one: an admin has to give the person
/// a real address first.
/// </summary>
public static class PlaceholderEmail
{
    /// <summary>The domains the app itself generates addresses on. Add to this list if another migration or seeder invents one.</summary>
    private static readonly string[] Domains = ["placeholder.local"];

    /// <summary>Whether a NORMALISED address (see <see cref="EmailIdentity.Normalise"/>) is one the app invented.</summary>
    public static bool Covers(string normalisedEmail) =>
        Domains.Any(domain => normalisedEmail.EndsWith("@" + domain, StringComparison.Ordinal));

    /// <summary>What to tell the admin about a person whose only address is an invented one.</summary>
    public static string Message(string fullName) => $"{fullName} has no real email address yet. Add one first.";
}
