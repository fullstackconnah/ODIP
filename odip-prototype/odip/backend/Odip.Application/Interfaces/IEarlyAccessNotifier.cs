namespace Odip.Application.Interfaces;

/// <summary>What the operator is told about a first-time early-access request.</summary>
public sealed record EarlyAccessNotification(string Name, string Organisation, string Email, DateTime RequestedAtUtc);

/// <summary>
/// Tells the operator that a NEW address asked for early access. Fire-and-forget by contract: the
/// call returns immediately, never throws, and never lets a mail problem reach the visitor. That is
/// what keeps the public endpoint's status and response time identical whether the address was new
/// (mail attempted) or already known (nothing sent) — it must not become an "is this email
/// registered?" oracle.
/// </summary>
public interface IEarlyAccessNotifier
{
    void NotifyNewRequest(EarlyAccessNotification notification);
}
