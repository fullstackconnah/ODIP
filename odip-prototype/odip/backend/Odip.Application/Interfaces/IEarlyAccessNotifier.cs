namespace Odip.Application.Interfaces;

/// <summary>Why the operator is being told. None of them carries the visitor's message text.</summary>
public enum EarlyAccessNoticeKind
{
    /// <summary>A new address asked for early access.</summary>
    NewRequest,

    /// <summary>A known address sent the form again with different answers; they are stored for the SuperAdmin to read.</summary>
    SentAgain,

    /// <summary>As <see cref="SentAgain"/>, and this was the last one that will be kept for the address.</summary>
    SentAgainLastKept,

    /// <summary>A known address sent the form again with different answers after the limit: nothing was stored.</summary>
    SentAgainOverLimit,
}

/// <summary>What the operator is told about an early-access request (the visitor's name and address, never the message).</summary>
public sealed record EarlyAccessNotification(
    string Name, string Organisation, string Email, DateTime RequestedAtUtc, EarlyAccessNoticeKind Kind = EarlyAccessNoticeKind.NewRequest);

/// <summary>
/// Tells the operator that a NEW address asked for early access, or that a known one sent the form again with
/// different answers (an identical repeat tells no one). Fire-and-forget by contract: the call returns
/// immediately, never throws, and never lets a mail problem reach the visitor. That is what keeps the public
/// endpoint's status and response time identical whether the address was new, known, or past the limit — it must
/// not become an "is this email registered?" oracle.
/// </summary>
public interface IEarlyAccessNotifier
{
    void NotifyNewRequest(EarlyAccessNotification notification);
}
