using Odip.Domain.Entities;

namespace Odip.Application.Interfaces;

/// <summary>Puts a saved <see cref="ProblemReport"/> on the Work Board as a card. Never throws for a board problem: it returns the outcome.</summary>
public interface IProblemReportSender
{
    Task<ProblemReportSendResult> TrySendAsync(ProblemReport report, CancellationToken ct);
}

/// <param name="Sent">True once a card exists (created now, or adopted from an earlier unknown outcome).</param>
/// <param name="CardId">The card's task id when <paramref name="Sent"/>.</param>
/// <param name="Error">When not sent: a numeric status, an exception type name, <see cref="UnknownOutcome"/> or <see cref="NotConfigured"/>. Nothing else.</param>
public sealed record ProblemReportSendResult(bool Sent, long? CardId, string? Error)
{
    /// <summary>The create request was dispatched but its answer was lost, so a card may already exist; the retry searches before creating.</summary>
    public const string UnknownOutcome = "unknown-outcome";

    public const string NotConfigured = "not-configured";
}
